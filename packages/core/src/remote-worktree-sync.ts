/**
 * Worktree streaming over SSH (CAP-24, epic 19 story 19.4; AD-24): push a
 * run's worktree to a fresh remote directory before the run starts, and
 * pull its resulting commits back afterward, both over the one SSH exec
 * channel `remote-host-port.ts`'s `connect` gives (`RemoteHostPort`),
 * never a second transport (SFTP, rsync) and never an origin-remote
 * credential.
 *
 * `push` always ships a full-history bundle of the run's branch
 * (`VcsPort.bundleRef`): at push time the branch has no commits past
 * `base` yet (the worktree was just created), and a remote clone shares no
 * objects with the real repo, so only a full bundle lets it reconstruct
 * anything. `pull` is the cheap, incremental half: it asks the remote for
 * `base..branch` (the remote's commits are built with the exact same
 * parent `base`), fetched locally with a non-forced `branch:branch`
 * refspec (`VcsPort.importBundle`), which only ever succeeds as a
 * fast-forward — never resuming or rewriting a prior remote state.
 *
 * Every remote command is one fixed shell-command template, built only
 * from `runId` (validated against `RunId`'s schema) and `branch`
 * (validated with `isBuildBranch`) before either is interpolated — never
 * free text — and every interpolated value is shell-quoted even after
 * that validation (defense in depth). The remote directory is always
 * `.ogden-agents/remote-runs/<runId>`, relative to the SSH session's own
 * login directory: namespaced by `runId` alone, so two runs on the same
 * machine never collide, and a retry after `remove` always gets a fresh
 * directory (the script `rm -rf`s it first), never a hot-patch of one
 * left behind.
 *
 * Each of `push`/`pull`/`remove` opens and closes its own connection
 * (`RemoteHostConnection`) rather than holding one open across a whole
 * run; `verifyPinnedHostKey` runs first, so a machine that was never
 * confirmed, or whose host key changed since, is refused before any
 * connection is even attempted. `connect` itself is then given the same
 * pinned fingerprint and re-checks it again on that exact connection
 * (`RemoteHostPort.connect`'s own doc comment): `verifyPinnedHostKey`'s
 * probe and the real work connection are two separate TCP connections, so
 * only re-checking on the one actually used closes the gap an on-path
 * attacker could otherwise exploit by leaving the probe untouched and
 * intercepting only the second connection. The connection is closed on
 * every path — success, refusal, or an exec failure — never left open.
 *
 * A POSIX shell (`sh`) and `git` on the remote's `PATH` are assumed (the
 * same assumption the agent CLI itself needs there); a remote whose
 * default shell is not POSIX-compatible is out of this story's automated
 * tests, same posture as story 19.2's untested Windows keychain fallback.
 */
import { type RemoteMachineId, type RunId } from '@ogden-agents/shared';
import { checkedRunId, isBuildBranch } from './build-names.js';
import { ValidationError } from './errors.js';
import { remoteMachineSshSecretName, type RemoteMachines } from './remote-machines.js';
import { RemoteHostError, type RemoteHostChannel, type RemoteHostConnection, type RemoteHostCredential, type RemoteHostTarget } from './remote-host-port.js';
import type { SecretStorePort } from './secret-store-port.js';
import { VcsError, type VcsPort } from './vcs-port.js';

/** The one fixed base path every run's remote directory lives under (never a run's own choice). */
const REMOTE_RUNS_BASE = '.ogden-agents/remote-runs';

/** The most bytes `pull` reads back as one incremental bundle. Generous (matches the repo's own object-import bound) but still a bound: a runaway remote command is killed, never buffered without limit. */
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

/** The most bytes any other remote command's stdout is kept (a revision line, `git`'s quiet chatter); past this it is killed, never buffered without limit. */
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;

export interface RemoteWorktreeSync {
  /**
   * Streams `branch`'s full history to a fresh directory on `machineId`,
   * namespaced by `runId`. Throws before building any command or opening
   * any connection if `runId` or `branch` fails its schema (a
   * {@link ValidationError}). Returns the remote directory, relative to
   * the machine's own login directory (story 19.5's own concern is what it
   * does with that path).
   */
  push(input: { repoPath: string; branch: string; runId: string; machineId: RemoteMachineId }): Promise<{ remotePath: string }>;
  /**
   * Asks the remote for its run directory's commits since `base` and
   * imports them into `repoPath`'s `branch`, resetting `worktreePath` to
   * match. `'nothing'` when the remote is still at `base`; `'imported'`
   * when it had moved on and the worktree now reflects that. Safe to call
   * more than once for the same run (each call re-asks the remote fresh).
   */
  pull(input: { repoPath: string; worktreePath: string; branch: string; base: string; runId: string; machineId: RemoteMachineId }): Promise<'imported' | 'nothing'>;
  /** Deletes the remote directory for `runId` on `machineId`. Nothing there (never pushed, or already removed) is a no-op, not a refusal. */
  remove(input: { runId: string; machineId: RemoteMachineId }): Promise<void>;
}

/** Only the `VcsPort` methods `push`/`pull` need (interface segregation): a smaller surface to depend on and to fake in a test. */
type SyncVcs = Pick<VcsPort, 'bundleRef' | 'importBundle'>;

/** Only the `RemoteHostPort` method `push`/`pull`/`remove` need: the real adapter's `checkHostKey`/`generateKeypair` are `RemoteMachines`' own concern (story 19.2), never this module's. */
interface SyncHosts {
  connect(target: RemoteHostTarget, credential: RemoteHostCredential, expectedFingerprint: string, options?: { timeoutMs?: number }): Promise<RemoteHostConnection>;
}

/** Only the `RemoteMachines` methods needed to address a machine and confirm it is still safe to use. */
type SyncMachines = Pick<RemoteMachines, 'get' | 'verifyPinnedHostKey'>;

export interface RemoteWorktreeSyncOptions {
  vcs: SyncVcs;
  hosts: SyncHosts;
  secrets: SecretStorePort;
  machines: SyncMachines;
  now?: () => Date;
}

/** `value` wrapped in POSIX single quotes, safe to splice into a shell command (defense in depth: every interpolated value is quoted, even one already validated). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The run's own remote directory, relative to the machine's login directory: always under {@link REMOTE_RUNS_BASE}, namespaced by `runId` alone. */
function remoteRunDir(runId: RunId): string {
  return `${REMOTE_RUNS_BASE}/${runId}`;
}

/** `branch` as a {@link ValidationError}-throwing check (core's own `isBuildBranch` is a boolean test, not a throwing one). */
function checkedBuildBranch(branch: unknown): string {
  if (typeof branch !== 'string' || !isBuildBranch(branch)) {
    throw new ValidationError('That is not a branch Ogden Agents can use.', [{ path: ['branch'], message: 'invalid branch' }]);
  }
  return branch;
}

/** Runs `command` over `connection`, writing `input` (if any) to its stdin, and collects its stdout up to `maxBytes` (killing the remote command, never buffering past that). Never inspects stderr: its content is the remote's own (possibly file names), never surfaced. */
async function execCollect(connection: RemoteHostConnection, command: string, options: { input?: Buffer; maxBytes: number }): Promise<{ code: number; stdout: Buffer }> {
  const channel: RemoteHostChannel = await connection.exec(command);
  const chunks: Buffer[] = [];
  let size = 0;
  let overflowed = false;
  channel.stdout.on('data', (chunk: Buffer) => {
    if (overflowed) return;
    size += chunk.length;
    if (size > options.maxBytes) {
      overflowed = true;
      channel.kill();
      return;
    }
    chunks.push(chunk);
  });
  // Drained, never stored: stderr's content is the remote's own and is never surfaced (vcs-git's own convention).
  channel.stderr.resume();
  if (options.input !== undefined) channel.stdin.write(options.input);
  channel.stdin.end();
  const code = await channel.exitCode;
  if (overflowed) throw new RemoteHostError('The remote command returned too much data.', {}, 'remote_command_failed');
  return { code, stdout: Buffer.concat(chunks) };
}

/**
 * The shell script `push` sends: rebuilds the run's directory fresh every
 * time (never hot-patched), from the bundle piped in on stdin. The bundle
 * is staged to `` `mktemp` ``'s own (always-absolute) path, never a path
 * under the run's own directory: `` `git -C <dir> fetch <path> …` `` runs
 * as if it had first `cd`'d into `<dir>`, so any other path it is given
 * must already be absolute, or it resolves against the wrong directory.
 */
function pushScript(dir: string, branch: string): string {
  const dirQ = shellQuote(dir);
  const baseQ = shellQuote(REMOTE_RUNS_BASE);
  const refspecQ = shellQuote(`${branch}:${branch}`);
  const branchQ = shellQuote(branch);
  return [`mkdir -p ${baseQ}`, `rm -rf -- ${dirQ}`, 'tmp=$(mktemp)', 'cat > "$tmp"', `git init --quiet ${dirQ}`, `git -C ${dirQ} fetch --quiet "$tmp" ${refspecQ}`, `git -C ${dirQ} checkout --quiet ${branchQ}`, 'rm -f "$tmp"'].join(' && ');
}

/**
 * Opens an authenticated connection to `machineId` (host key pinned and
 * verified first, never skipped): the connection-opening half of
 * {@link createRemoteWorktreeSync}'s own `withConnection`, factored out (CAP-24,
 * epic 19 story 19.6) so `build-start.ts` can open a *long-lived* connection
 * for the chat layer the same verified way `push`/`pull`/`remove` already do.
 * The caller owns closing it (never done here): each caller's own posture
 * (`withConnection`'s own `finally`, or a build's own release) decides when.
 */
export async function openRemoteConnection(
  machineId: RemoteMachineId,
  { hosts, secrets, machines }: Pick<RemoteWorktreeSyncOptions, 'hosts' | 'secrets' | 'machines'>,
): Promise<RemoteHostConnection> {
  await machines.verifyPinnedHostKey(machineId);
  const machine = machines.get(machineId);
  const privateKey = await secrets.get(remoteMachineSshSecretName(machineId));
  if (privateKey === undefined) {
    throw new RemoteHostError(`No SSH key is stored for ${machine.host}. Remove and re-add the machine.`, { host: machine.host }, 'auth_failed');
  }
  // `verifyPinnedHostKey` just proved the key was fine on its own short-lived probe; `connect` itself re-checks it
  // again, on this exact connection, against the same pinned fingerprint (never confirmed, never null here).
  if (machine.hostKeyFingerprint === null) {
    throw new RemoteHostError(`Confirm ${machine.host}'s host key before using it.`, { host: machine.host }, 'host_key_not_confirmed');
  }
  return hosts.connect({ host: machine.host, port: machine.port, username: machine.username }, { privateKey }, machine.hostKeyFingerprint);
}

export function createRemoteWorktreeSync({ vcs, hosts, secrets, machines }: RemoteWorktreeSyncOptions): RemoteWorktreeSync {
  /** Opens a connection to `machineId` the verified way ({@link openRemoteConnection}), runs `work`, and closes it on every path. */
  const withConnection = async <T>(machineId: RemoteMachineId, work: (connection: RemoteHostConnection) => Promise<T>): Promise<T> => {
    const connection = await openRemoteConnection(machineId, { hosts, secrets, machines });
    try {
      return await work(connection);
    } finally {
      await connection.close().catch(() => undefined);
    }
  };

  return {
    async push({ repoPath, branch: rawBranch, runId: rawRunId, machineId }) {
      const runId = checkedRunId(rawRunId);
      const branch = checkedBuildBranch(rawBranch);
      const remotePath = remoteRunDir(runId);
      await withConnection(machineId, async (connection) => {
        const bundle = await vcs.bundleRef(repoPath, branch);
        const { code } = await execCollect(connection, pushScript(remotePath, branch), { input: bundle, maxBytes: MAX_COMMAND_OUTPUT_BYTES });
        if (code !== 0) throw new RemoteHostError('The remote machine could not set up the run.', {}, 'remote_command_failed');
      });
      return { remotePath };
    },

    async pull({ repoPath, worktreePath, branch: rawBranch, base, runId: rawRunId, machineId }) {
      const runId = checkedRunId(rawRunId);
      const branch = checkedBuildBranch(rawBranch);
      const dir = remoteRunDir(runId);
      return withConnection(machineId, async (connection) => {
        const revision = await execCollect(connection, `git -C ${shellQuote(dir)} rev-parse --verify --quiet ${shellQuote(`${branch}^{commit}`)}`, { maxBytes: MAX_COMMAND_OUTPUT_BYTES });
        if (revision.code !== 0) throw new RemoteHostError("The remote run's directory has no such branch.", {}, 'remote_command_failed');
        const remoteRevision = revision.stdout.toString('utf8').trim();
        if (remoteRevision === base) return 'nothing';

        const bundled = await execCollect(connection, `git -C ${shellQuote(dir)} bundle create - ${shellQuote(`${base}..${branch}`)}`, { maxBytes: MAX_BUNDLE_BYTES });
        if (bundled.code !== 0) throw new RemoteHostError('The remote machine could not prepare the update.', {}, 'remote_command_failed');

        const outcome = await vcs.importBundle(repoPath, worktreePath, branch, base, bundled.stdout);
        if (outcome === 'refused') throw new VcsError('The remote update could not be applied.', { step: 'pull' });
        return outcome;
      });
    },

    async remove({ runId: rawRunId, machineId }) {
      const runId = checkedRunId(rawRunId);
      const dir = remoteRunDir(runId);
      await withConnection(machineId, async (connection) => {
        const { code } = await execCollect(connection, `rm -rf -- ${shellQuote(dir)}`, { maxBytes: MAX_COMMAND_OUTPUT_BYTES });
        if (code !== 0) throw new RemoteHostError('The remote directory could not be removed.', {}, 'remote_command_failed');
      });
    },
  };
}
