/**
 * Running the agent's ACP process on a remote machine over SSH (CAP-24,
 * story 19.5), kept out of `acp-agent.ts` to respect its own existing
 * "moved out to keep it under budget" convention (`quirks.ts`'s header).
 *
 * `AcpProcess` is the one small shape `startOnChild` needs from a spawned
 * process (its three streams, `once('error'|'exit', …)`, `kill()`): nothing
 * else in the ACP connection wiring or the permission-card/event code needs
 * to know whether it is really a local `child_process` or a wrapped SSH
 * channel. `remoteProcessOf` wraps a `RemoteHostChannel` into that shape,
 * settling its one `'exit'` emission from the channel's `exitCode` -- on a
 * clean exit (resolved) or a dropped connection (rejected) alike -- and
 * never emits `'error'`: a channel close, clean or dropped, maps onto the
 * exact same `'exit'` path a local crash already takes, so the session/event
 * log layer never has to learn a new state.
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
import type { Readable, Writable } from 'node:stream';
import type { RemoteHostChannel } from '@ogden-agents/core';

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
    // `'exit'` path a local process's abrupt death takes, never a second, "remote" failure shape.
    () => settle(null, null),
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
