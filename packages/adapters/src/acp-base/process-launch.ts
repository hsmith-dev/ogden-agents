/**
 * Launching and tracking the agent's ACP process, local or remote (CAP-24,
 * story 19.5; renamed from `remote-launch.ts` and widened in story 19.7's
 * refactor sweep once a single "process launch" module read better than a
 * remote-only one -- `acp-agent.ts` was back over this repo's 600-line
 * convention, `quirks.ts`'s own header). Zero behavior change: every
 * function here is the exact code `acp-agent.ts` ran before, only
 * parameterized instead of closing over that module's locals.
 *
 * `AcpProcess` is the one small shape `startOnChild` needs from a spawned
 * process (its three streams, `once('error'|'exit', …)`, `kill()`): nothing
 * else in the ACP connection wiring or the permission-card/event code needs
 * to know whether it is really a local `child_process` or a wrapped SSH
 * channel. `localProcessOf` wraps a real local child; `remoteProcessOf`
 * wraps a `RemoteHostChannel` into the same shape, settling its one
 * `'exit'` emission from the channel's `exitCode` -- on a clean exit
 * (resolved) or a dropped connection (rejected) alike -- and never emits
 * `'error'`: a channel close, clean or dropped, maps onto the exact same
 * `'exit'` path a local crash already takes, so the session/event log layer
 * never has to learn a new state. `spawnAcpProcess` picks between the two
 * (`remote` given, or not) from the one `AcpLaunch` the quirk returns either
 * way -- the quirk never knows which. `trackAcpProcess` is the small
 * kill/exit plumbing every spawned process needs either way: its stderr
 * (counted and tailed, masked, never logged), its `'error'`/`'exit'`
 * handling (mapping a dropped remote connection's own sentinel,
 * `signal === 'connection_lost'`, onto `AgentErrorCode` `'connection_lost'`),
 * and `kill()` (stdin end, a grace period, then the whole process tree).
 *
 * `buildRemoteCommand` turns the same `AcpLaunch` (`command`/`args`/`cwd`) a
 * local spawn already gets from the per-agent quirk into one shell command
 * line, every segment shell-quoted even though none of it is
 * attacker-controlled free text (defense in depth, matching
 * `remote-worktree-sync.ts`'s own posture). Env vars (secrets included, AD-16)
 * never appear in that line: they travel only through `RemoteHostConnection.exec`'s
 * own `env` option (SSH's protocol-level env passthrough), passed by the
 * caller, never built in here.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { AgentError, type AgentErrorCode, type AgentStaticModels, type RemoteHostChannel, type RemoteHostConnection } from '@ogden-agents/core';
import { killProcessTree } from '../process-tree.js';
import { maskSecrets, secretValues } from './mask.js';
import type { Diagnostic } from './permission-request.js';
import type { AcpAgentQuirks, AcpLaunch, AcpLaunchInput } from './quirks.js';

/**
 * The one thing `acp-agent.ts`'s `startOnChild` needs from a spawned agent
 * process, real (local `child_process`) or remote (a wrapped SSH channel).
 */
export interface AcpProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Never `'error'` for a remote process (see module doc): a channel close or drop is always reported as `'exit'`. */
  once(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  /** Stops the process: a local process's whole tree, or the remote channel's own signal and close. */
  kill(): void;
}

/** `value` wrapped in POSIX single quotes, safe to splice into a shell command (defense in depth, matching `remote-worktree-sync.ts`'s own `shellQuote`). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * One remote shell command line that `cd`s into `cwd` then `exec`s `command`
 * with `args` -- the same three fields the per-agent quirk's `AcpLaunch`
 * already returns for a local spawn, no quirk changes needed. `exec` (not a
 * sub-shell) means the agent's own process replaces the launching shell, so
 * `RemoteHostChannel.kill()` (a signal to the one process `exec` started)
 * normally has nothing left over to reap. Every segment is shell-quoted,
 * even though `cwd`/`command`/`args` are never attacker-controlled free
 * text here.
 */
export function buildRemoteCommand({ cwd, command, args }: { cwd: string; command: string; args: readonly string[] }): string {
  const parts = [shellQuote(command), ...args.map(shellQuote)].join(' ');
  return `cd ${shellQuote(cwd)} && exec ${parts}`;
}

/**
 * Wraps one `RemoteHostChannel` as an {@link AcpProcess}: its streams pass
 * straight through, `kill()` calls the channel's own `kill()`, and the
 * channel's `exitCode` -- settling on a clean exit or rejecting on a dropped
 * connection alike -- becomes the one `'exit'` emission `startOnChild`
 * already knows how to handle (never a distinct `'error'`, so a dropped SSH
 * connection is never shown to the UI as something other than the same
 * fatal state a local crash would report).
 *
 * The `'exit'` emission's `signal` parameter is otherwise always `null` for
 * a remote process (ssh2 channels never report a POSIX signal there the way
 * a local child does), so a dropped connection reuses that unused slot as a
 * sentinel: `signal === 'connection_lost'` (CAP-24, epic 19 story 19.6).
 * `startOnChild` special-cases exactly that one string; every other value
 * (a local child's real `'SIGKILL'`, `'SIGTERM'`, …) is untouched.
 */
export function remoteProcessOf(channel: RemoteHostChannel): AcpProcess {
  let exitListener: ((code: number | null, signal: string | null) => void) | undefined;
  let settledWith: { code: number | null; signal: string | null } | undefined;
  const settle = (code: number | null, signal: string | null) => {
    if (settledWith !== undefined) return;
    settledWith = { code, signal };
    exitListener?.(code, signal);
  };
  channel.exitCode.then(
    (code) => settle(code, null),
    // The connection dropped mid-command (`RemoteHostError('connection_lost', …)`): mapped onto the same
    // `'exit'` path a local process's abrupt death takes, never a second, "remote" failure shape -- but
    // carrying the one sentinel `startOnChild` reads back out of the otherwise-unused `signal` slot.
    () => settle(null, 'connection_lost'),
  );
  function once(event: 'error', listener: (error: Error) => void): void;
  function once(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the standard overload-implementation idiom: only the two signatures above are ever exposed to a caller.
  function once(event: 'error' | 'exit', listener: (...args: any[]) => void): void {
    if (event !== 'exit') return;
    exitListener = listener;
    if (settledWith !== undefined) listener(settledWith.code, settledWith.signal);
  }
  return {
    stdin: channel.stdin,
    stdout: channel.stdout,
    stderr: channel.stderr,
    once,
    kill() {
      channel.kill();
    },
  };
}

/**
 * Wraps a real local child process as an {@link AcpProcess}: its streams and
 * `once('error'|'exit', …)` pass straight through (the same structural shape
 * they already are), and `kill()` is today's `killProcessTree(child.pid)` --
 * its whole process group on POSIX, its tree on Windows.
 */
export function localProcessOf(child: ChildProcessWithoutNullStreams): AcpProcess {
  function once(event: 'error', listener: (error: Error) => void): void;
  function once(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the standard overload-implementation idiom: only the two signatures above are ever exposed to a caller.
  function once(event: 'error' | 'exit', listener: (...args: any[]) => void): void {
    child.once(event, listener);
  }
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    once,
    kill: () => killProcessTree(child.pid),
  };
}

/**
 * Spawns the agent in `cwd` with core's environment (AD-16): locally, in its
 * own process group, or (`remote` given, CAP-24 story 19.5) over an
 * already-open SSH connection, from the exact same `AcpLaunch` the quirk
 * returns either way -- the quirk never knows which (moved out of
 * `acp-agent.ts` unchanged, story 19.7's refactor sweep: its deps are
 * parameters here instead of `createAcpAgent`'s own closure).
 */
export async function spawnAcpProcess(
  launchInput: AcpLaunchInput,
  model: string | undefined,
  buildEnv: Readonly<Record<string, string>>,
  remote: RemoteHostConnection | undefined,
  {
    quirks,
    displayName,
    couldNotStart,
    models,
    diagnostic,
  }: {
    quirks: Pick<AcpAgentQuirks, 'launch'>;
    /** The agent's product name (its descriptor's), for the start diagnostic only. */
    displayName: string;
    couldNotStart: string;
    models: AgentStaticModels | undefined;
    diagnostic: Diagnostic;
  },
): Promise<{ child: AcpProcess; secrets: readonly string[] }> {
  const { env } = launchInput;
  let launch: AcpLaunch;
  try {
    launch = quirks.launch(launchInput);
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('agent_unavailable', couldNotStart, { details: { reason: maskSecrets(String(error), secretValues(env)) }, cause: error });
  }
  // A linked command's own working directory (epic 12 entry 12) wins over the chat's own `cwd`.
  const cwd = launch.cwd ?? launchInput.cwd;
  // Exactly core's environment, plus what the launch adds (AD-16).
  // An unattended build start's own variables (epic 17) win over core's: nothing else sets the agent's mode.
  const childEnv: Record<string, string> = { ...launch.addEnv, ...env, ...buildEnv };
  // A static-list agent takes the chat's model at start (story 11): only a model it lists.
  const args = [...launch.args];
  if (models !== undefined && model !== undefined && models.list.some((each) => each.id === model)) {
    if (models.apply.kind === 'env') childEnv[models.apply.name] = model;
    else args.push(models.apply.flag, model);
  }
  diagnostic(`starting the ${displayName} adapter`, launch.logFields);

  if (remote !== undefined) {
    const command = buildRemoteCommand({ cwd, command: launch.command, args });
    try {
      // `childEnv` (secrets included) travels only through `exec`'s own `env` option, never in `command` itself (AD-16).
      const channel = await remote.exec(command, { env: childEnv });
      return { child: remoteProcessOf(channel), secrets: secretValues(childEnv) };
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError('agent_unavailable', couldNotStart, { details: { reason: maskSecrets(String(error), secretValues(childEnv)) }, cause: error });
    }
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(launch.command, args, {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Its own process group, so the whole tree can be stopped (see `localProcessOf`'s `kill`).
      detached: process.platform !== 'win32',
    });
  } catch (error) {
    throw new AgentError('agent_unavailable', couldNotStart, { details: { reason: String(error) }, cause: error });
  }
  return { child: localProcessOf(child), secrets: secretValues(childEnv) };
}

/** The most of the agent's stderr kept in memory (masked) for a failure shown to the user. */
const OUTPUT_TAIL_CHARS = 2_000;

/**
 * The small kill/exit plumbing every spawned {@link AcpProcess} needs,
 * local or remote alike (moved out of `startOnChild`, story 19.7's refactor
 * sweep; zero behavior change -- `exited`/`kill`/`output` are the exact same
 * logic, read back through this factory's return instead of `acp-agent.ts`'s
 * own locals). Its stderr is never logged, only counted and (masked) tailed
 * for a failure shown to the user; its `'error'`/`'exit'` handling settles
 * `hooks.rejectGone` and calls `hooks.reportGone`/`hooks.closeConnection`
 * exactly as `startOnChild` did inline, including the remote exit path's own
 * sentinel (`signal === 'connection_lost'`, CAP-24, epic 19 story 19.6).
 */
export function trackAcpProcess(
  child: AcpProcess,
  reasons: { couldNotStart: string; stopped: string; connectionLost: string },
  hooks: {
    diagnostic: Diagnostic;
    mask: (text: string) => string;
    rejectGone: (error: AgentError) => void;
    reportGone: (reason: string, code?: AgentErrorCode) => void;
    closeConnection: (error: Error) => void;
    isClosing: () => boolean;
  },
  exitGraceMs: number,
): { kill: () => Promise<void>; output: () => string | undefined; readonly exited: boolean } {
  let exited = false;
  // The agent's stderr is its own log and may echo anything: it is never
  // logged, only counted, and a short masked tail is kept for the user.
  let stderrBytes = 0;
  let stderrTail = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-OUTPUT_TAIL_CHARS * 2);
  });
  const output = () => {
    const tail = hooks.mask(stderrTail).slice(-OUTPUT_TAIL_CHARS);
    return tail === '' ? undefined : tail;
  };
  const noteStderr = () => {
    if (stderrBytes > 0) hooks.diagnostic('the agent wrote to stderr', { bytes: stderrBytes });
  };
  const exitedPromise = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      hooks.diagnostic('the agent process failed', { reason: hooks.mask(String(error)) });
      exited = true;
      hooks.rejectGone(new AgentError('agent_unavailable', reasons.couldNotStart, { details: { reason: hooks.mask(String(error)) }, cause: error, output: output() }));
      hooks.closeConnection(error);
      hooks.reportGone(reasons.couldNotStart);
      resolve();
    });
    child.once('exit', (code, signal) => {
      exited = true;
      // The remote exit path's own sentinel (CAP-24, epic 19 story 19.6; this module's own doc comment): a real
      // local child's signal is never this exact string, so only a dropped SSH connection takes this branch.
      const connectionLost = signal === 'connection_lost';
      if (!hooks.isClosing()) {
        hooks.diagnostic('the agent process exited', { code, signal });
        noteStderr();
        // Anything it started goes with it.
        child.kill();
      }
      hooks.rejectGone(new AgentError(connectionLost ? 'connection_lost' : 'agent_failed', connectionLost ? reasons.connectionLost : reasons.stopped, { details: { code, signal }, output: output() }));
      hooks.closeConnection(new Error('the agent process exited'));
      hooks.reportGone(connectionLost ? reasons.connectionLost : reasons.stopped, connectionLost ? 'connection_lost' : undefined);
      resolve();
    });
  });
  /** Ends stdin, gives the agent `exitGraceMs` to exit, then stops its whole tree. */
  const kill = async () => {
    if (!exited) {
      child.stdin.end();
      await Promise.race([exitedPromise, new Promise((resolve) => setTimeout(resolve, exitGraceMs))]);
    }
    child.kill();
    if (!exited) await Promise.race([exitedPromise, new Promise((resolve) => setTimeout(resolve, exitGraceMs))]);
    noteStderr();
  };
  return {
    kill,
    output,
    get exited() {
      return exited;
    },
  };
}
