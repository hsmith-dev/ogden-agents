/**
 * The shared ACP client (epic 6 entry 4, E6-R3; moved out of
 * `acp-claude-code`, story 2.2): implements core's `AgentPort` for any agent
 * that speaks ACP over stdio, from its `AgentDescriptor` (6.3) and a few
 * quirks of its own. It names no agent.
 *
 * - The agent's environment is exactly what core passes (AD-16) plus what
 *   its launch quirk adds; none of it is logged, and the values of its
 *   secret-looking variables are masked in everything the agent prints
 *   before it becomes an event. Its stderr is never logged, only counted.
 * - The agent runs in its own process group (POSIX), so `close` stops the
 *   whole tree through `process-tree.ts` (`taskkill /T` on Windows).
 * - Agent signals map to AD-4 states: `working` while `session/prompt`
 *   runs, `idle` when it returns, `error` when it fails or the process exits.
 * - Reopening a session (E2-R2) initializes once, then uses `session/resume`
 *   when the agent advertises it, else (or when the resume is refused)
 *   `session/load` (the history it replays is swallowed, not reported
 *   again), else `session/new`.
 * - `initialize` advertises `clientCapabilities.auth.terminal`, so the agent
 *   lists its terminal-type sign-in methods (agent-matrix, CAP-16).
 *
 * Permission requests go to core's `onPermissionRequest`; without one they
 * are declined, so nothing the agent asks to run, runs without a person.
 * Core is only ever told "once": always-allow rules live in core. Only
 * `allow_once` and `reject_once` options are ever selected, never an
 * `allow_always` or session-wide one (agent-matrix "Permission cards"); a
 * request that offers neither is cancelled and logged without asking (6.4).
 *
 * Permission modes: the descriptor names the agent's own session mode for
 * each Ogden mode it declares. Core sets the chat's mode with
 * `session/set_mode` on every start and reopen, and each
 * `current_mode_update` is reported as a `permission_mode` event.
 *
 * The per-project trust gate (story 4.2) is core's: a chat with an agent
 * whose descriptor `needsProjectTrust` is refused by core
 * (`ChatOptions.projectTrusted`) before this client is asked to start it.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import {
  AgentError,
  declaredModes,
  type AgentAuthMethod,
  type AgentDescriptor,
  type AgentErrorCode,
  type AgentEvent,
  type AgentEventListener,
  type AgentPort,
  type AgentRestored,
  type AgentSession,
  type AgentToolCallDiff,
  type ProtectedPaths,
} from '@ogden-agents/core';
import type { PermissionMode } from '@ogden-agents/shared';
import { killProcessTree } from '../process-tree.js';
import { withTimeout } from '../with-timeout.js';
import { createStreamMasker, maskSecrets, secretValues } from './mask.js';
import { answerPermissionRequest, type Diagnostic, type PermissionCallback } from './permission-request.js';
import { acpAsksLessThanAsk, acpModeOf, acpReasons, type AcpAgentOptions, type AcpAgentQuirks, type AcpLaunch } from './quirks.js';

export { acpAsksLessThanAsk, acpModeOf, acpReasons, slashSkillInvocation, type AcpAgentOptions, type AcpAgentQuirks, type AcpLaunch } from './quirks.js';

/** How long the agent may take to start and answer `initialize` and `session/new`. */
export const START_TIMEOUT_MS = 60_000;
/** How long `close` waits, after ending the agent's stdin, for it to exit before killing its process tree. */
export const EXIT_GRACE_MS = 2_000;
/** How much of the agent's stderr is kept in memory (masked) for a failure shown to the user. */
const OUTPUT_TAIL_CHARS = 2_000;

/** ACP's `-32000`: the agent needs the user to sign in again (9.4). */
function isAuthRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === -32000;
}

/** An `AgentPort` for the ACP agent `descriptor` describes. */
export function createAcpAgent(descriptor: AgentDescriptor, quirks: AcpAgentQuirks, options: AcpAgentOptions = {}): AgentPort {
  const diagnostic: Diagnostic = (message, fields) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging must never break a session.
    }
  };
  const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
  const reasons = acpReasons(descriptor.displayName);

  /** Spawns the agent in `cwd` with core's environment (AD-16), in its own process group. */
  const spawnAgent = (cwd: string, env: Readonly<Record<string, string>>) => {
    let launch: AcpLaunch;
    try {
      launch = quirks.launch({ cwd, env });
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError('agent_unavailable', reasons.couldNotStart, { details: { reason: maskSecrets(String(error), secretValues(env)) }, cause: error });
    }
    // Exactly core's environment, plus what the launch adds (AD-16).
    const childEnv: Record<string, string> = { ...launch.addEnv, ...env };
    diagnostic(`starting the ${descriptor.displayName} adapter`, launch.logFields);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.command, [...launch.args], {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Its own process group, so the whole tree can be stopped (see `killTree`).
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      throw new AgentError('agent_unavailable', reasons.couldNotStart, { details: { reason: String(error) }, cause: error });
    }
    return { child, secrets: secretValues(childEnv) };
  };

  const open = async (
    input: { cwd: string; env: Readonly<Record<string, string>>; onPermissionRequest?: PermissionCallback | undefined; protectedPaths?: ProtectedPaths | undefined },
    opening: Opening,
  ) => {
    const { child, secrets } = spawnAgent(input.cwd, input.env);
    return startOnChild(
      child,
      {
        descriptor,
        quirks,
        reasons,
        cwd: input.cwd,
        env: input.env,
        secrets,
        diagnostic,
        startTimeoutMs,
        onPermissionRequest: input.onPermissionRequest,
        protectedPaths: input.protectedPaths,
      },
      opening,
    );
  };

  return {
    displayName: descriptor.displayName,
    permissionModes: declaredModes(descriptor),

    async startSession(input) {
      const opened = await open(input, { kind: 'new' });
      return opened.session!;
    },

    async reopenSession(input) {
      const opened = await open(input, { kind: 'reopen', agentSessionId: input.agentSessionId });
      return { session: opened.session!, restored: opened.restored };
    },

    async listAuthMethods({ env }) {
      // Any folder will do: only `initialize` runs.
      const opened = await open({ cwd: homedir(), env }, { kind: 'probe' });
      return (opened.init.authMethods ?? []).map((method): AgentAuthMethod => {
        const description = method.description ?? undefined;
        if ((method as { type?: unknown }).type === 'terminal') {
          const terminal = method as acp.AuthMethodTerminal;
          return { id: terminal.id, name: terminal.name, description, kind: 'terminal', args: terminal.args, env: terminal.env };
        }
        return { id: method.id, name: method.name, description, kind: 'agent' };
      });
    },

    skillInvocation: quirks.skillInvocation,
    ...(quirks.terminalResume === undefined ? {} : { terminalResume: quirks.terminalResume }),
  };
}

/** What the agent is started for: a new session, a session it had before, or only to ask what it offers (`initialize`). */
type Opening = { kind: 'new' } | { kind: 'reopen'; agentSessionId: string } | { kind: 'probe' };

interface StartContext {
  descriptor: AgentDescriptor;
  quirks: AcpAgentQuirks;
  reasons: ReturnType<typeof acpReasons>;
  cwd: string;
  /** Core's environment for the agent, for the `authMethod` quirk only. */
  env: Readonly<Record<string, string>>;
  secrets: readonly string[];
  diagnostic: Diagnostic;
  startTimeoutMs: number;
  onPermissionRequest: PermissionCallback | undefined;
  /** Kept guarded for the session's life, through the agent's `sessionMeta` quirk (Auto only). */
  protectedPaths: ProtectedPaths | undefined;
}

/** Stops `child` and everything it started: its process group on POSIX, its tree on Windows. */
function killTree(child: ChildProcessWithoutNullStreams): void {
  killProcessTree(child.pid);
}

async function startOnChild(
  child: ChildProcessWithoutNullStreams,
  { descriptor, quirks, reasons, cwd, env, secrets, diagnostic, startTimeoutMs, onPermissionRequest, protectedPaths }: StartContext,
  opening: Opening,
): Promise<{ init: acp.InitializeResponse; session: AgentSession | undefined; restored: AgentRestored }> {
  const { couldNotStart: COULD_NOT_START, stopped: STOPPED, failed: FAILED } = reasons;
  const modeIds = descriptor.permissionModes;
  /** A plain reason for a failed ACP request, for the UI; the raw error goes to the log. */
  const plainReason = (error: unknown, fallback: string) => (isAuthRequired(error) ? reasons.signIn : fallback);
  const listeners = new Set<AgentEventListener>();
  // The agent's own way to keep the protected paths guarded; it can't be changed later.
  const guards = protectedPaths === undefined || quirks.sessionMeta === undefined ? undefined : quirks.sessionMeta(protectedPaths);
  const sessionMeta = guards === undefined ? {} : { _meta: guards };
  /** While `session/load` replays history the chat already has: those updates are swallowed. */
  let replaying = false;
  let state: 'idle' | 'working' | 'error' = 'idle';
  let closing = false;
  let exited = false;
  let fatalReported = false;
  let agentSessionId: string | undefined;
  /** The session's modes as the agent last said (`session/new`, `resume`, `load`, then `current_mode_update`); `undefined` when it lists none. */
  let modes: acp.SessionModeState | undefined;
  /** Bumped by each `current_mode_update`, so a `session/set_mode` answered after one doesn't overwrite it. */
  let modeUpdates = 0;
  /** `session/set_mode` requests not answered yet: while any is, the current mode is not known. */
  let modeSetsInFlight = 0;
  /** A `session/set_mode` failed (or is still unanswered): the current mode is not known until one succeeds or the agent reports it. */
  let modeUnknown = false;
  const mask = (text: string) => maskSecrets(text, secrets);
  let reply = createStreamMasker(secrets);
  /** A tool call's file changes, secrets masked; `undefined` when it reports none. */
  const diffsOf = (content: acp.ToolCallContent[] | null | undefined): AgentToolCallDiff[] | undefined => {
    const diffs = (content ?? []).flatMap((item) =>
      item.type === 'diff' ? [{ path: mask(item.path), oldText: item.oldText == null ? null : mask(item.oldText), newText: mask(item.newText) }] : [],
    );
    return diffs.length === 0 ? undefined : diffs;
  };

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
  const setState = (next: 'idle' | 'working' | 'error', reason?: string, code?: AgentErrorCode) => {
    if (next !== 'working') flushReply();
    if (state === next) return;
    state = next;
    emit(
      next === 'error'
        ? { type: 'state', state: 'error', reason: reason ?? FAILED, ...(code === undefined ? {} : { code }) }
        : { type: 'state', state: next },
    );
  };
  /** The process is gone: one `fatal` error, even after a non-fatal one for the same failure. */
  const reportGone = (reason: string) => {
    if (closing || fatalReported) return;
    fatalReported = true;
    flushReply();
    state = 'error';
    emit({ type: 'state', state: 'error', reason, fatal: true });
  };

  // The agent's stderr is its own log and may echo anything: it is never
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
      if (replaying) return;
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
          emit({
            type: 'tool_call',
            toolCallId: update.toolCallId,
            title: mask(update.title),
            kind: update.kind ?? undefined,
            status: update.status ?? undefined,
            diffs: diffsOf(update.content),
          });
          break;
        case 'tool_call_update':
          emit({
            type: 'tool_call_update',
            toolCallId: update.toolCallId,
            title: update.title == null ? undefined : mask(update.title),
            kind: update.kind ?? undefined,
            status: update.status ?? undefined,
            diffs: diffsOf(update.content),
          });
          break;
        case 'current_mode_update': {
          modeUpdates++;
          if (modes !== undefined) modes = { ...modes, currentModeId: update.currentModeId };
          if (modeSetsInFlight === 0) modeUnknown = false;
          const label = modes?.availableModes.find((mode) => mode.id === update.currentModeId)?.name;
          emit({
            type: 'permission_mode',
            mode: acpModeOf(modeIds, update.currentModeId),
            asksLess: acpAsksLessThanAsk(quirks.askingModeIds, update.currentModeId),
            ...(label === undefined ? {} : { label: mask(label) }),
          });
          break;
        }
        default:
          break;
      }
    })
    .onRequest('session/request_permission', ({ params }) => answerPermissionRequest(params, { cwd, quirks, mask, diagnostic, onPermissionRequest }))
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

  /** Ends stdin, gives the agent {@link EXIT_GRACE_MS} to exit, then stops its whole tree. */
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
  let restored: AgentRestored = 'new';
  try {
    /**
     * Resumes, else loads, the agent's session; `undefined` when it can do
     * neither, for a new one. A resume the agent refused falls back to a load
     * when it offers one (2.3 review F3). An expired sign-in (`-32000`) is not
     * "session gone": it fails the start. The log gets the method and error
     * code only, never the agent's message (it may quote the transcript).
     */
    const reopen = async (initialized: acp.InitializeResponse, sessionId: string): Promise<AgentRestored | undefined> => {
      const capabilities = initialized.agentCapabilities;
      const attempt = async (method: 'session/resume' | 'session/load', request: () => Promise<{ modes?: acp.SessionModeState | null }>): Promise<boolean> => {
        try {
          modes = (await request()).modes ?? undefined;
          return true;
        } catch (error) {
          if (!(error instanceof acp.RequestError) || error.code === -32000) throw error;
          diagnostic('the agent could not reopen its session', { method, code: error.code });
          return false;
        }
      };
      if (
        capabilities?.sessionCapabilities?.resume != null &&
        (await attempt('session/resume', () => connection.agent.request('session/resume', { sessionId, cwd, mcpServers: [], ...sessionMeta })))
      ) {
        return 'resumed';
      }
      if (capabilities?.loadSession === true) {
        replaying = true;
        try {
          if (await attempt('session/load', () => connection.agent.request('session/load', { sessionId, cwd, mcpServers: [], ...sessionMeta }))) return 'loaded';
        } finally {
          replaying = false;
        }
      }
      // The agent no longer has the session: a new one, primed by core from the transcript (2.7).
      return undefined;
    };
    const started = (async () => {
      const initialized = await connection.agent.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        // Terminal-type sign-in methods (agent-matrix, CAP-16) are run by the server in a hidden PTY.
        clientCapabilities: { auth: { terminal: true } },
        clientInfo: { name: 'ogden-agents', version: '0' },
      });
      if (opening.kind === 'probe') return { initialized, sessionId: undefined, restored: 'new' as const };
      // The agent's own sign-in step before any session (6.5): a refusal (`-32000`) fails the start as auth_required.
      const methodId = quirks.authMethod?.({ env, initialized });
      if (methodId !== undefined) {
        await connection.agent.request('authenticate', { methodId });
        diagnostic('authenticated with the agent', { methodId });
      }
      if (opening.kind === 'reopen') {
        const reopened = await reopen(initialized, opening.agentSessionId);
        if (reopened !== undefined) return { initialized, sessionId: opening.agentSessionId, restored: reopened };
      }
      const created = await connection.agent.request('session/new', { cwd, mcpServers: [], ...sessionMeta });
      modes = created.modes ?? undefined;
      return { initialized, sessionId: created.sessionId, restored: 'new' as const };
    })();
    const result = await withTimeout(
      Promise.race([started, gone]),
      startTimeoutMs,
      () => new AgentError('agent_unavailable', COULD_NOT_START, { details: { reason: 'timed out starting' } }),
    );
    init = result.initialized;
    agentSessionId = result.sessionId;
    restored = result.restored;
  } catch (error) {
    closing = true;
    connection.close();
    await kill();
    if (error instanceof AgentError) throw error;
    throw new AgentError(isAuthRequired(error) ? 'auth_required' : 'agent_unavailable', plainReason(error, COULD_NOT_START), {
      details: { reason: mask(error instanceof Error ? error.message : String(error)) },
      cause: error,
      output: output(),
    });
  }
  if (opening.kind === 'probe' || agentSessionId === undefined) {
    // Only `initialize` was wanted: stop the agent again.
    closing = true;
    connection.close();
    await kill();
    return { init, session: undefined, restored };
  }
  const sessionId = agentSessionId;
  diagnostic('agent session started', { protocolVersion: init.protocolVersion, restored });

  let closed: Promise<void> | undefined;
  const session: AgentSession = {
    agentSessionId: sessionId,
    protectsPaths: guards !== undefined,

    get permissionModes(): PermissionMode[] {
      // A session that lists no modes runs as it is: Ask only.
      if (modes === undefined) return ['ask'];
      const listed = new Set(modes.availableModes.map((mode) => mode.id));
      return declaredModes(descriptor).filter((mode) => mode === 'ask' || listed.has(modeIds[mode]!));
    },

    async setPermissionMode(mode) {
      if (exited || closing) throw new AgentError('agent_failed', STOPPED);
      if (modes === undefined) {
        if (mode === 'ask') return;
        throw new AgentError('agent_failed', reasons.noSuchMode);
      }
      const modeId = modeIds[mode];
      if (modeId === undefined) throw new AgentError('agent_failed', reasons.noSuchMode);
      // Skipped only when the mode is known: never while a set_mode is unanswered or after one failed.
      if (modes.currentModeId === modeId && modeSetsInFlight === 0 && !modeUnknown) return;
      if (!modes.availableModes.some((candidate) => candidate.id === modeId)) {
        throw new AgentError('agent_failed', reasons.noSuchMode);
      }
      const before = modeUpdates;
      modeSetsInFlight++;
      modeUnknown = true;
      try {
        await Promise.race([connection.agent.request('session/set_mode', { sessionId, modeId }), gone]);
      } catch (error) {
        modeSetsInFlight--;
        diagnostic('session/set_mode failed', { mode, code: error instanceof acp.RequestError ? error.code : null });
        throw error instanceof AgentError ? error : new AgentError('agent_failed', reasons.couldNotSwitchMode, { cause: error });
      }
      modeSetsInFlight--;
      // A mode the agent reported meanwhile (a fallback) stands: it was reported to core as it came.
      if (modeUpdates === before && modes !== undefined) modes = { ...modes, currentModeId: modeId };
      if (modeSetsInFlight === 0) modeUnknown = false;
    },

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
            : new AgentError(!processGone && isAuthRequired(error) ? 'auth_required' : 'agent_failed', processGone ? STOPPED : plainReason(error, FAILED), {
                details: { reason: mask(error instanceof Error ? error.message : String(error)) },
                cause: error,
                output: output(),
              });
        if (processGone) reportGone(failure.message);
        else setState('error', failure.message, failure.code === 'auth_required' ? failure.code : undefined);
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
  return { init, session, restored };
}
