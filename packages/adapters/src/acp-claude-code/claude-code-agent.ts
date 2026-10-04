/**
 * `acp-claude-code` (story 2.2): implements core's `AgentPort` for Claude
 * Code through the Claude Agent ACP adapter (`@agentclientprotocol/claude-agent-acp`),
 * spawned as a child process and spoken to over stdio with the ACP SDK
 * (`@agentclientprotocol/sdk`).
 *
 * - The adapter is not a dependency of the published package (about 230 MB
 *   with its bundled CLI); it is found at a configurable path, by default
 *   resolved from `node_modules` where a dev install has it. Onboarding
 *   (story 9.3) installs it on demand into the data folder; the server then
 *   passes a function that finds it at each start.
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
 * `allow_once` and `reject_once` options are ever selected, so a card never
 * picks an option that changes the agent's mode (the plan-exit card's
 * mode-raising options are `allow_always`).
 *
 * Permission modes: the ACP session modes the adapter lists (`default`,
 * `acceptEdits`, `plan`, `auto`, `bypassPermissions`) map to Ogden's Ask,
 * Auto and Skip all (`default`, `auto`, `bypassPermissions`). Core sets the
 * chat's mode with `session/set_mode` on every start and reopen, and each
 * `current_mode_update` is reported as a `permission_mode` event. The adapter
 * is started with skipping permitted (its default), so a chat can move to
 * Skip all without a restart: Ogden's server is the gate.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import {
  AgentError,
  type AgentAuthMethod,
  type AgentEvent,
  type AgentErrorCode,
  type AgentEventListener,
  type AgentPermissionDecision,
  type AgentPermissionRequest,
  type AgentPort,
  type AgentRestored,
  type AgentSession,
  type AgentToolCallDiff,
  type ProtectedPaths,
} from '@ogden-agents/core';
import type { PermissionMode } from '@ogden-agents/shared';
import { killProcessTree } from '../process-tree.js';
import { findClaudeExecutable } from './detect.js';
import { claudeGuardSettings } from './claude-guards.js';
import { claudeTerminalCommand, locateClaudeTerminal } from './terminal-command.js';
import { createStreamMasker, maskSecrets, secretValues } from './mask.js';
import { readClaudeTranscript } from './transcript.js';

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
   * any script that speaks ACP over stdio (the tests' fake agent), or a
   * function read at each start (so an adapter installed while the server
   * runs is used without a restart, story 9.3). Default: resolved from
   * `node_modules` ({@link resolveClaudeAgentAcp}).
   */
  adapterPath?: string | (() => string | undefined) | undefined;
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

/** The ACP session mode each Ogden permission mode is (claude-agent-acp 0.84). */
export const ACP_MODE_IDS: Readonly<Record<PermissionMode, string>> = { ask: 'default', auto: 'auto', skip_all: 'bypassPermissions' };

/** The Ogden mode an ACP session mode is, or `other` (planning, accepting edits, anything else). */
export function ogdenModeOf(modeId: string): PermissionMode | 'other' {
  const entry = (Object.entries(ACP_MODE_IDS) as Array<[PermissionMode, string]>).find(([, id]) => id === modeId);
  return entry === undefined ? 'other' : entry[0];
}

/** ACP session modes that ask as much as Ask does (or more); any other, known or not, asks less. */
const ASKING_MODE_IDS: ReadonlySet<string> = new Set(['default', 'plan', 'dontAsk']);

/** Whether an ACP session mode asks less than Ask (so core tells the agent Ask). An unknown one does, to be safe. */
export function asksLessThanAsk(modeId: string): boolean {
  return !ASKING_MODE_IDS.has(modeId);
}

/** A plain reason for a failed ACP request, for the UI; the raw error goes to the log. */
function plainReason(error: unknown, fallback: string): string {
  if (isAuthRequired(error)) return SIGN_IN;
  return fallback;
}

/** ACP's `-32000`: the agent needs the user to sign in again (9.4). */
function isAuthRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === -32000;
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
  const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;

  /** The adapter's entry script as things stand now (a function is asked each time; 9.3). */
  const currentAdapterPath = () => {
    const given = typeof options.adapterPath === 'function' ? options.adapterPath() : options.adapterPath;
    return typeof options.adapterPath === 'function' ? given : (given ?? resolveClaudeAgentAcp());
  };

  /** Spawns the adapter in `cwd` with core's environment (AD-16), in its own process group. */
  const spawnAdapter = (cwd: string, env: Readonly<Record<string, string>>) => {
    const adapterPath = currentAdapterPath();
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
    return { child, secrets: secretValues(childEnv) };
  };

  const open = async (
    input: { cwd: string; env: Readonly<Record<string, string>>; onPermissionRequest?: PermissionCallback | undefined; protectedPaths?: ProtectedPaths | undefined },
    opening: Opening,
  ) => {
    const { child, secrets } = spawnAdapter(input.cwd, input.env);
    return startOnChild(
      child,
      { cwd: input.cwd, secrets, diagnostic, startTimeoutMs, onPermissionRequest: input.onPermissionRequest, protectedPaths: input.protectedPaths },
      opening,
    );
  };

  return {
    displayName: CLAUDE_CODE,
    permissionModes: ['ask', 'auto', 'skip_all'],

    // Claude Code's ACP adapter hands the text to the SDK, which runs `/name` as
    // the installed skill; it loads the repo's own skills from the session's cwd
    // (`settingSources` includes `project`). Story 4.1.
    // Claude Code runs an installed skill as a slash command; the idea follows as its argument (story 4.2).
    skillInvocation: (skill, idea) => (idea === undefined ? `/${skill}` : `/${skill} ${idea}`),

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

    // `claude --resume <id>` (CAP-5), and its record read back (story 3.3).
    terminalResume: {
      transcript: readClaudeTranscript,
      command: async (agentSessionId, env, terminal) =>
        claudeTerminalCommand(agentSessionId, env, { ...options, adapterPath: currentAdapterPath(), permissionMode: terminal?.permissionMode ?? 'ask', protectedPaths: terminal?.protectedPaths }),
      locate: async (env) => locateClaudeTerminal(env, { ...options, adapterPath: currentAdapterPath() }),
    },
  };
}

type PermissionCallback = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

/** What the adapter is started for: a new session, a session it had before, or only to ask what it offers (`initialize`). */
type Opening = { kind: 'new' } | { kind: 'reopen'; agentSessionId: string } | { kind: 'probe' };

interface StartContext {
  cwd: string;
  secrets: readonly string[];
  diagnostic: Diagnostic;
  startTimeoutMs: number;
  onPermissionRequest: PermissionCallback | undefined;
  /** Kept guarded for the session's life, as ask rules in its flag settings (Auto only). */
  protectedPaths: ProtectedPaths | undefined;
}

/** The command a shell tool call would run, when the agent put one in its raw input. */
function commandOf(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null) return undefined;
  const command = (rawInput as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

/** Input fields that name a file or folder, in the tools Claude Code reports. */
const PATH_FIELDS = ['file_path', 'notebook_path', 'path'] as const;

/** Input fields of a search (Glob's `pattern`, Grep's `glob` and `pattern`) that can reach past its folder (story 2.8 review F2). */
const PATTERN_FIELDS = ['pattern', 'glob'] as const;

/**
 * Every path a tool call names: its locations, its diffs, and the path
 * fields of its raw input. Core lets a file-kind rule match only when all
 * of them lie inside the workspace, so naming more paths only narrows it.
 *
 * A search pattern is a path too when it can reach elsewhere: an absolute
 * one or one starting with `~` as given (core can't resolve `~`, so it
 * asks), and one with a `..` segment resolved against the search folder
 * (its `path`, else `cwd`). A search that names no folder searches `cwd`,
 * which is named for it.
 */
export function pathsOf(toolCall: acp.ToolCallUpdate, cwd: string): string[] {
  const paths = new Set<string>();
  for (const location of toolCall.locations ?? []) if (typeof location.path === 'string') paths.add(location.path);
  for (const item of toolCall.content ?? []) if (item.type === 'diff' && typeof item.path === 'string') paths.add(item.path);
  const raw = toolCall.rawInput;
  if (typeof raw === 'object' && raw !== null) {
    for (const field of PATH_FIELDS) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value === 'string' && value !== '') paths.add(value);
    }
    const folder = (raw as Record<string, unknown>).path;
    const root = typeof folder === 'string' && folder !== '' ? folder : undefined;
    let patterned = false;
    for (const field of PATTERN_FIELDS) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value === '') continue;
      patterned = true;
      if (value.startsWith('~') || isAbsolute(value)) paths.add(value);
      else if (value.split(/[\\/]/).includes('..')) {
        // Under a `~` folder the folder itself is already named, and core asks for it.
        if (root === undefined || !root.startsWith('~')) paths.add(join(root ?? cwd, value));
      }
    }
    if (patterned && root === undefined) paths.add(cwd);
  }
  return [...paths];
}

type Diagnostic = (message: string, fields?: Record<string, unknown>) => void;

/** Stops `child` and everything it started: its process group on POSIX, its tree on Windows. */
function killTree(child: ChildProcessWithoutNullStreams): void {
  killProcessTree(child.pid);
}

async function startOnChild(
  child: ChildProcessWithoutNullStreams,
  { cwd, secrets, diagnostic, startTimeoutMs, onPermissionRequest, protectedPaths }: StartContext,
  opening: Opening,
): Promise<{ init: acp.InitializeResponse; session: AgentSession | undefined; restored: AgentRestored }> {
  const listeners = new Set<AgentEventListener>();
  // claude-agent-acp 0.84 passes `_meta.claudeCode.options.settings` to the CLI as its flag settings; it can't be changed later.
  const sessionMeta = protectedPaths === undefined ? {} : { _meta: { claudeCode: { options: { settings: claudeGuardSettings(protectedPaths) } } } };
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
            mode: ogdenModeOf(update.currentModeId),
            asksLess: asksLessThanAsk(update.currentModeId),
            ...(label === undefined ? {} : { label: mask(label) }),
          });
          break;
        }
        default:
          break;
      }
    })
    .onRequest('session/request_permission', async ({ params }): Promise<acp.RequestPermissionResponse> => {
      const option = (kind: acp.PermissionOptionKind) => params.options.find((candidate) => candidate.kind === kind);
      const select = (kind: acp.PermissionOptionKind): acp.RequestPermissionResponse => {
        const chosen = option(kind);
        if (chosen === undefined) {
          diagnostic('the agent offered no option for the decision; cancelling the request', { option: kind });
          return { outcome: { outcome: 'cancelled' } };
        }
        return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
      };
      if (onPermissionRequest === undefined) {
        diagnostic('declined a permission request (no one to ask)', { toolKind: params.toolCall.kind ?? null });
        return select('reject_once');
      }
      try {
        const command = commandOf(params.toolCall.rawInput);
        const decision: AgentPermissionDecision | null | undefined = await onPermissionRequest({
          toolCallId: params.toolCall.toolCallId,
          title: mask(params.toolCall.title ?? ''),
          kind: params.toolCall.kind ?? undefined,
          command: command === undefined ? undefined : mask(command),
          paths: pathsOf(params.toolCall, cwd).map(mask),
        });
        switch (decision?.outcome) {
          case 'allow_once':
            return select('allow_once');
          case 'deny':
            return select('reject_once');
          case 'cancelled':
            return { outcome: { outcome: 'cancelled' } };
          default:
            // A missing or unknown decision never lets the tool call run.
            diagnostic('the permission request got no known decision; declining it', { outcome: String((decision as { outcome?: unknown } | null | undefined)?.outcome ?? null) });
            return select('reject_once');
        }
      } catch (error) {
        diagnostic('the permission request could not be decided; declining it', { reason: mask(String(error)) });
        return select('reject_once');
      }
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
    protectsPaths: protectedPaths !== undefined,

    get permissionModes(): PermissionMode[] {
      // A session that lists no modes runs as it is: Ask only.
      if (modes === undefined) return ['ask'];
      const listed = new Set(modes.availableModes.map((mode) => mode.id));
      return (Object.keys(ACP_MODE_IDS) as PermissionMode[]).filter((mode) => mode === 'ask' || listed.has(ACP_MODE_IDS[mode]));
    },

    async setPermissionMode(mode) {
      if (exited || closing) throw new AgentError('agent_failed', STOPPED);
      if (modes === undefined) {
        if (mode === 'ask') return;
        throw new AgentError('agent_failed', `${CLAUDE_CODE} doesn't offer that permission mode here.`);
      }
      const modeId = ACP_MODE_IDS[mode];
      // Skipped only when the mode is known: never while a set_mode is unanswered or after one failed.
      if (modes.currentModeId === modeId && modeSetsInFlight === 0 && !modeUnknown) return;
      if (!modes.availableModes.some((candidate) => candidate.id === modeId)) {
        throw new AgentError('agent_failed', `${CLAUDE_CODE} doesn't offer that permission mode here.`);
      }
      const before = modeUpdates;
      modeSetsInFlight++;
      modeUnknown = true;
      try {
        await Promise.race([connection.agent.request('session/set_mode', { sessionId, modeId }), gone]);
      } catch (error) {
        modeSetsInFlight--;
        diagnostic('session/set_mode failed', { mode, code: error instanceof acp.RequestError ? error.code : null });
        throw error instanceof AgentError ? error : new AgentError('agent_failed', `${CLAUDE_CODE} couldn't switch its permission mode.`, { cause: error });
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
