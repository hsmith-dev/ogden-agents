/**
 * `acp-claude-code` (story 2.2): implements core's `AgentPort` for Claude
 * Code through the Claude Agent ACP adapter (`@agentclientprotocol/claude-agent-acp`),
 * spawned as a child process and spoken to over stdio with the ACP SDK
 * (`@agentclientprotocol/sdk`).
 *
 * - The adapter is not a dependency of the published package (about 230 MB
 *   with its bundled CLI); it is found at a configurable path, by default
 *   resolved from `node_modules` where a dev install has it. Installing it on
 *   demand is onboarding story 9.3.
 * - The adapter runs the user's own `claude` when one is found, through
 *   `CLAUDE_CODE_EXECUTABLE`, so their login and version are used; otherwise
 *   it falls back to the Agent SDK's bundled binary.
 * - The child's environment is exactly what core passes (AD-16) plus
 *   `CLAUDE_CODE_EXECUTABLE`; none of it is logged, and the values of its
 *   secret-looking variables are masked in everything the agent prints
 *   before it becomes an event. Its stderr is never logged, only counted.
 * - The adapter runs in its own process group (POSIX), so `close` stops the
 *   whole tree, the `claude` CLI it runs included.
 * - Adapter signals map to AD-4 states: `working` while `session/prompt`
 *   runs, `idle` when it returns, `error` when it fails or the process exits.
 *
 * Permission requests are declined until permission cards ship (story 2.6):
 * nothing the agent asks to run, runs without a person.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { AgentError, type AgentEvent, type AgentEventListener, type AgentPort, type AgentSession } from '@ogden-agents/core';
import { findClaudeExecutable } from './detect.js';
import { createStreamMasker, maskSecrets, secretValues } from './mask.js';

/** The product name the UI shows (EXPERIENCE.md Voice: the agent by its product name). */
export const CLAUDE_CODE = 'Claude Code';

/** The adapter's npm package; a dev dependency only, never a runtime one. */
export const CLAUDE_AGENT_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp';

/** How long the adapter may take to start and answer `initialize` and `session/new`. */
export const START_TIMEOUT_MS = 60_000;
/** How long `close` waits, after ending the adapter's stdin, for it to exit before killing its process tree. */
export const EXIT_GRACE_MS = 2_000;
/** How much of the adapter's stderr is kept in memory (masked) for a failure shown to the user. */
const OUTPUT_TAIL_CHARS = 2_000;

const NOT_SET_UP = `${CLAUDE_CODE} isn't set up for Ogden Agents on this computer yet.`;
const COULD_NOT_START = `${CLAUDE_CODE} couldn't start. Try again.`;
const STOPPED = `${CLAUDE_CODE} stopped unexpectedly. Send your message again to restart it.`;
const SIGN_IN = `${CLAUDE_CODE} needs you to sign in again.`;
const FAILED = `${CLAUDE_CODE} stopped with an error. Try again.`;

export interface ClaudeCodeAgentOptions {
  /**
   * The adapter's entry script (`claude-agent-acp`'s `dist/index.js`), or
   * any script that speaks ACP over stdio (the tests' fake agent). Default:
   * resolved from `node_modules` ({@link resolveClaudeAgentAcp}).
   */
  adapterPath?: string | undefined;
  /**
   * The `claude` CLI the adapter runs. Default: one found on `PATH` or at
   * Claude Code's install locations ({@link findClaudeExecutable}); `null`
   * lets the adapter use its bundled binary. A `CLAUDE_CODE_EXECUTABLE` in
   * the environment core passes wins over both.
   */
  claudeExecutable?: string | null | undefined;
  /** The Node that runs the adapter. Default: this one. */
  nodePath?: string;
  /** Called with the adapter's stderr lines and protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
  /** Default {@link START_TIMEOUT_MS}. */
  startTimeoutMs?: number;
}

/** The adapter's entry script in `node_modules`, or `undefined` when it isn't installed. */
export function resolveClaudeAgentAcp(from: string | URL = import.meta.url): string | undefined {
  try {
    const manifest = createRequire(from).resolve(`${CLAUDE_AGENT_ACP_PACKAGE}/package.json`);
    const entry = join(dirname(manifest), 'dist', 'index.js');
    return existsSync(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** A plain reason for a failed ACP request, for the UI; the raw error goes to the log. */
function plainReason(error: unknown, fallback: string): string {
  if (error instanceof acp.RequestError && error.code === -32000) return SIGN_IN;
  return fallback;
}

/** `promise`, or a rejection with `error` after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(error()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createClaudeCodeAgent(options: ClaudeCodeAgentOptions = {}): AgentPort {
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging must never break a session.
    }
  };

  return {
    displayName: CLAUDE_CODE,

    async startSession({ cwd, env }) {
      const adapterPath = options.adapterPath ?? resolveClaudeAgentAcp();
      if (adapterPath === undefined || !existsSync(adapterPath)) {
        throw new AgentError('agent_unavailable', NOT_SET_UP, { details: { adapterPath: adapterPath ?? null } });
      }
      const childEnv: Record<string, string> = { ...env };
      if (childEnv.CLAUDE_CODE_EXECUTABLE === undefined) {
        const claude = options.claudeExecutable === undefined ? findClaudeExecutable(childEnv) : options.claudeExecutable;
        if (claude !== null && claude !== undefined) childEnv.CLAUDE_CODE_EXECUTABLE = claude;
      }
      diagnostic('starting the Claude Code adapter', {
        adapterPath,
        claudeExecutable: childEnv.CLAUDE_CODE_EXECUTABLE ?? 'bundled',
      });

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(options.nodePath ?? process.execPath, [adapterPath], {
          cwd,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          // Its own process group, so the whole tree can be stopped (see `killTree`).
          detached: process.platform !== 'win32',
        });
      } catch (error) {
        throw new AgentError('agent_unavailable', COULD_NOT_START, { details: { reason: String(error) }, cause: error });
      }
      return startOnChild(child, cwd, secretValues(childEnv), diagnostic, options.startTimeoutMs ?? START_TIMEOUT_MS);
    },
  };
}

type Diagnostic = (message: string, fields?: Record<string, unknown>) => void;

/** Stops `child` and everything it started: its process group on POSIX, its tree on Windows. */
function killTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is already gone.
  }
}

async function startOnChild(
  child: ChildProcessWithoutNullStreams,
  cwd: string,
  secrets: readonly string[],
  diagnostic: Diagnostic,
  startTimeoutMs: number,
): Promise<AgentSession> {
  const listeners = new Set<AgentEventListener>();
  let state: 'idle' | 'working' | 'error' = 'idle';
  let closing = false;
  let exited = false;
  let fatalReported = false;
  let agentSessionId: string | undefined;
  const mask = (text: string) => maskSecrets(text, secrets);
  let reply = createStreamMasker(secrets);

  const emit = (event: AgentEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        diagnostic('an agent event listener failed', { reason: String(error) });
      }
    }
  };
  /** Sends what the reply masker still holds back, at the end of a turn. */
  const flushReply = () => {
    const rest = reply.flush();
    reply = createStreamMasker(secrets);
    if (rest !== '') emit({ type: 'message_chunk', text: rest });
  };
  /** Reports a state only when it changes, so a failed prompt is one `error`, not two. */
  const setState = (next: 'idle' | 'working' | 'error', reason?: string) => {
    if (next !== 'working') flushReply();
    if (state === next) return;
    state = next;
    emit(next === 'error' ? { type: 'state', state: 'error', reason: reason ?? FAILED } : { type: 'state', state: next });
  };
  /** The process is gone: one `fatal` error, even after a non-fatal one for the same failure. */
  const reportGone = (reason: string) => {
    if (closing || fatalReported) return;
    fatalReported = true;
    flushReply();
    state = 'error';
    emit({ type: 'state', state: 'error', reason, fatal: true });
  };

  // The adapter's stderr is its own log and may echo anything: it is never
  // logged, only counted, and a short masked tail is kept for the user.
  let stderrBytes = 0;
  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-OUTPUT_TAIL_CHARS * 2);
  });
  const output = () => {
    const tail = mask(stderrTail).slice(-OUTPUT_TAIL_CHARS);
    return tail === '' ? undefined : tail;
  };
  const noteStderr = () => {
    if (stderrBytes > 0) diagnostic('the agent wrote to stderr', { bytes: stderrBytes });
  };

  let rejectGone!: (error: AgentError) => void;
  /** Rejects when the process fails to spawn or exits; used to fail a start that would otherwise wait. */
  const gone = new Promise<never>((_, reject) => (rejectGone = reject));
  gone.catch(() => undefined);

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );
  const connection = acp
    .client({ name: 'ogden-agents' })
    .onNotification('session/update', ({ params }) => {
      if (agentSessionId !== undefined && params.sessionId !== agentSessionId) return;
      const update = params.update;
      switch (update.sessionUpdate) {
        case 'agent_message_chunk':
          if (update.content.type === 'text') {
            const text = reply.push(update.content.text);
            if (text !== '') emit({ type: 'message_chunk', text });
          }
          break;
        case 'tool_call':
          emit({ type: 'tool_call', toolCallId: update.toolCallId, title: mask(update.title), kind: update.kind ?? undefined, status: update.status ?? undefined });
          break;
        case 'tool_call_update':
          emit({
            type: 'tool_call_update',
            toolCallId: update.toolCallId,
            title: update.title == null ? undefined : mask(update.title),
            status: update.status ?? undefined,
          });
          break;
        default:
          break;
      }
    })
    .onRequest('session/request_permission', ({ params }) => {
      // Permission cards arrive in story 2.6; until then nothing runs without a person.
      const reject = params.options.find((option) => option.kind === 'reject_once');
      diagnostic('declined a permission request (permission cards are not built yet)', { toolKind: params.toolCall.kind ?? null });
      return reject === undefined
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: reject.optionId } };
    })
    .connect(stream);

  const exitedPromise = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      diagnostic('the agent process failed', { reason: mask(String(error)) });
      exited = true;
      rejectGone(new AgentError('agent_unavailable', COULD_NOT_START, { details: { reason: mask(String(error)) }, cause: error, output: output() }));
      connection.close(error);
      reportGone(COULD_NOT_START);
      resolve();
    });
    child.once('exit', (code, signal) => {
      exited = true;
      if (!closing) {
        diagnostic('the agent process exited', { code, signal });
        noteStderr();
        // Anything it started goes with it.
        killTree(child);
      }
      rejectGone(new AgentError('agent_failed', STOPPED, { details: { code, signal }, output: output() }));
      connection.close(new Error('the agent process exited'));
      reportGone(STOPPED);
      resolve();
    });
  });

  /** Ends stdin, gives the adapter {@link EXIT_GRACE_MS} to exit, then stops its whole tree. */
  const kill = async () => {
    if (!exited) {
      child.stdin.end();
      await Promise.race([exitedPromise, new Promise((resolve) => setTimeout(resolve, EXIT_GRACE_MS))]);
    }
    killTree(child);
    if (!exited) await Promise.race([exitedPromise, new Promise((resolve) => setTimeout(resolve, EXIT_GRACE_MS))]);
    noteStderr();
  };

  let init: acp.InitializeResponse;
  try {
    const started = (async () => {
      const initialized = await connection.agent.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'ogden-agents', version: '0' },
      });
      const created = await connection.agent.request('session/new', { cwd, mcpServers: [] });
      return { initialized, created };
    })();
    const result = await withTimeout(
      Promise.race([started, gone]),
      startTimeoutMs,
      () => new AgentError('agent_unavailable', COULD_NOT_START, { details: { reason: 'timed out starting' } }),
    );
    init = result.initialized;
    agentSessionId = result.created.sessionId;
  } catch (error) {
    closing = true;
    connection.close();
    await kill();
    if (error instanceof AgentError) throw error;
    throw new AgentError('agent_unavailable', plainReason(error, COULD_NOT_START), {
      details: { reason: mask(error instanceof Error ? error.message : String(error)) },
      cause: error,
      output: output(),
    });
  }
  const sessionId = agentSessionId;
  diagnostic('agent session started', { protocolVersion: init.protocolVersion });

  let closed: Promise<void> | undefined;
  return {
    agentSessionId: sessionId,

    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async prompt(text) {
      if (exited || closing) throw new AgentError('agent_failed', STOPPED);
      setState('working');
      try {
        const response = await Promise.race([
          connection.agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }),
          gone,
        ]);
        setState('idle');
        return { stopReason: response.stopReason };
      } catch (error) {
        // A closed connection means the process went away (its stdout can end before its exit event).
        const processGone = exited || connection.signal.aborted;
        const failure =
          error instanceof AgentError
            ? error
            : new AgentError('agent_failed', processGone ? STOPPED : plainReason(error, FAILED), {
                details: { reason: mask(error instanceof Error ? error.message : String(error)) },
                cause: error,
                output: output(),
              });
        if (processGone) reportGone(failure.message);
        else setState('error', failure.message);
        throw failure;
      }
    },

    async cancel() {
      if (exited || closing) return;
      await connection.agent.notify('session/cancel', { sessionId });
    },

    close() {
      closed ??= (async () => {
        closing = true;
        listeners.clear();
        if (!exited && init.agentCapabilities?.sessionCapabilities?.close != null) {
          try {
            await withTimeout(connection.agent.request('session/close', { sessionId }), EXIT_GRACE_MS, () => new Error('session/close timed out'));
          } catch (error) {
            diagnostic('session/close failed', { reason: mask(String(error)) });
          }
        }
        connection.close();
        await kill();
      })();
      return closed;
    },
  };
}
