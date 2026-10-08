/**
 * `remote-worktree-sync` (CAP-24, epic 19 story 19.4; `openRemoteConnection`
 * added by story 19.6): push/pull/remove, the I/O matrix from the story's
 * plan. Core depends on no adapter, even in a test (`remote-machines.test.ts`'s
 * own convention), so this file keeps one small fake of its own rather than
 * importing `@ogden-agents/adapters`:
 *
 * - `realVcs()`: `bundleRef`/`importBundle` over the real `git` binary,
 *   through plain commands (the same technique `vcs-git`'s own tests use),
 *   so a binary blob's bytes and a real fast-forward are genuinely
 *   exercised, not merely asserted.
 *
 * `createFakeRemoteHost()`, `createFakeMachines()` and `memorySecrets()` now
 * live in `remote-test-fakes.ts` (CAP-24, epic 19 story 19.6), shared with
 * the build-level remote tests, which reuse these rather than inventing a
 * second fake transport.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteWorktreeSync, newId, openRemoteConnection, remoteMachineSshSecretName, RemoteHostError, ValidationError } from '../src/index.js';
import { createFakeMachines, createFakeRemoteHost, memorySecrets } from './remote-test-fakes.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** Plain git for the test's own setup and assertions: a local identity, no hook concerns (not this story's own test target). */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) as string;

/** The same, but the raw bytes (a bundle is binary). */
const gitBinary = (cwd: string, ...args: string[]): Buffer =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }) as Buffer;

const tryGit = (cwd: string, ...args: string[]): string | undefined => {
  try {
    const out = git(cwd, ...args).trim();
    return out === '' ? undefined : out;
  } catch {
    return undefined;
  }
};

/** A repo on `main` with one commit. */
function setupRepo(): { repo: string; head: string } {
  const repo = temp('ogden-agents-rws-repo-');
  git(repo, 'init', '-q', '--initial-branch=main');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  return { repo, head: git(repo, 'rev-parse', 'HEAD').trim() };
}

/**
 * `bundleRef`/`importBundle` over the real `git` binary, the minimal shape
 * `remote-worktree-sync.ts` depends on (`SyncVcs`): never imported from
 * `vcs-git` (see the file comment), and without that adapter's extra
 * hardening (hooks folders, pinned-worktree checks) — this is testing
 * `remote-worktree-sync`'s own orchestration, not `vcs-git`'s invariants
 * (covered on their own in `packages/adapters/test/vcs-git.test.ts`).
 */
function realVcs() {
  return {
    async bundleRef(repoPath: string, ref: string): Promise<Buffer> {
      return gitBinary(repoPath, 'bundle', 'create', '-', `refs/heads/${ref}`);
    },
    async importBundle(repoPath: string, worktreePath: string, branch: string, _base: string, bundle: Buffer): Promise<'imported' | 'nothing' | 'refused'> {
      if (bundle.length === 0) return 'nothing';
      const before = tryGit(repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
      const scratch = 'refs/ogden-agents-test/import';
      const file = join(temp('ogden-agents-rws-bundle-'), 'b.bundle');
      writeFileSync(file, bundle);
      try {
        execFileSync('git', ['fetch', '--quiet', file, `${branch}:${scratch}`], { cwd: repoPath, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        return 'refused';
      }
      const after = tryGit(repoPath, 'rev-parse', '--verify', '--quiet', `${scratch}^{commit}`);
      try {
        execFileSync('git', ['update-ref', '-d', scratch], { cwd: repoPath });
      } catch {
        /* best-effort cleanup */
      }
      if (after === undefined) return 'refused';
      if (after === before) return 'nothing';
      try {
        execFileSync('git', ['update-ref', `refs/heads/${branch}`, after, ...(before !== undefined ? [before] : [])], { cwd: repoPath });
        git(worktreePath, 'reset', '--hard', '--quiet', after);
      } catch {
        return 'refused';
      }
      return 'imported';
    },
  };
}

const BRANCH = 'ogden/abcdefgh/1.1-x';

/** A fresh repo, worktree-on-branch, fake remote host, fake machines (one confirmed machine) and the sync use-case under test. */
async function setup() {
  const { repo, head } = setupRepo();
  const worktree = temp('ogden-agents-rws-worktree-');
  rmSync(worktree, { recursive: true, force: true });
  git(repo, 'worktree', 'add', '-q', '-b', BRANCH, worktree, head);
  const hosts = createFakeRemoteHost(temp);
  const machines = createFakeMachines();
  const secrets = memorySecrets();
  const machineId = machines.add({ host: 'remote-1', port: 22, username: 'ogden' });
  await secrets.set(remoteMachineSshSecretName(machineId), 'fake-private-key-pem'); // secret-scan:allow: an obviously-fake test double
  const sync = createRemoteWorktreeSync({ vcs: realVcs(), hosts, secrets, machines });
  return { repo, head, worktree, hosts, machines, secrets, machineId, sync };
}

describe('remote-worktree-sync: push', () => {
  it('ships a binary file byte-identical to a fresh remote directory', async () => {
    const { repo, worktree, hosts, machineId, sync } = await setup();
    const binary = Buffer.from([0, 1, 2, 3, 255, 254, 0, 10, 13, 9]);
    writeFileSync(join(worktree, 'blob.bin'), binary);
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'binary');
    const runId = newId('run');

    const { remotePath } = await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    expect(remotePath).toBe(`.ogden-agents/remote-runs/${runId}`);

    const remoteDir = join(hosts.homeDirFor('remote-1', 22), remotePath);
    expect(existsSync(remoteDir)).toBe(true);
    expect(readFileSync(join(remoteDir, 'blob.bin'))).toEqual(binary);
    expect(git(remoteDir, 'rev-parse', BRANCH).trim()).toBe(git(repo, 'rev-parse', BRANCH).trim());
  });

  it('gives two runs on the same machine distinct remote directories, never colliding', async () => {
    const { repo, hosts, machineId, sync } = await setup();
    const runId1 = newId('run');
    const runId2 = newId('run');
    const { remotePath: path1 } = await sync.push({ repoPath: repo, branch: BRANCH, runId: runId1, machineId });
    const { remotePath: path2 } = await sync.push({ repoPath: repo, branch: BRANCH, runId: runId2, machineId });
    expect(path1).not.toBe(path2);
    const home = hosts.homeDirFor('remote-1', 22);
    expect(existsSync(join(home, path1))).toBe(true);
    expect(existsSync(join(home, path2))).toBe(true);
    expect(hosts.calls.filter((call) => call.startsWith('exec')).length).toBe(2);
  });

  it('throws before building any command or opening a connection, for an invalid runId or branch', async () => {
    const { repo, hosts, machineId, sync } = await setup();
    await expect(sync.push({ repoPath: repo, branch: BRANCH, runId: 'not-a-run-id', machineId })).rejects.toBeInstanceOf(ValidationError);
    await expect(sync.push({ repoPath: repo, branch: 'not-a-build-branch', runId: newId('run'), machineId })).rejects.toBeInstanceOf(ValidationError);
    expect(hosts.calls).toEqual([]);
  });

  it('refuses before any connection when the machine was never confirmed, or its host key changed since', async () => {
    const { repo, hosts, machines, sync } = await setup();
    const unconfirmed = machines.add({ host: 'remote-2', port: 22, username: 'ogden', confirmed: false });
    await expect(sync.push({ repoPath: repo, branch: BRANCH, runId: newId('run'), machineId: unconfirmed })).rejects.toBeInstanceOf(RemoteHostError);

    const changed = machines.add({ host: 'remote-3', port: 22, username: 'ogden' });
    machines.setHostKeyChanged(changed);
    await expect(sync.push({ repoPath: repo, branch: BRANCH, runId: newId('run'), machineId: changed })).rejects.toBeInstanceOf(RemoteHostError);

    expect(hosts.calls.some((call) => call.startsWith('connect') || call.startsWith('exec'))).toBe(false);
  });

  it('refuses with host_key_changed when the real connection sees a different key than the one pinned, even though verifyPinnedHostKey (a separate, earlier probe) saw a match -- never trusting that probe alone', async () => {
    const { repo, hosts, machineId, sync } = await setup();
    // An on-path attacker who lets `verifyPinnedHostKey`'s own probe through untouched, then intercepts only the
    // connection `connect` actually uses for the exec channel: the fake's `verifyPinnedHostKey` (a different,
    // independent fake) still reports a match; only `connect` itself can catch this one.
    hosts.setConnectFingerprint('remote-1', 22, 'attacker-controlled-fingerprint');
    const failure = await sync.push({ repoPath: repo, branch: BRANCH, runId: newId('run'), machineId }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RemoteHostError);
    expect((failure as RemoteHostError).code).toBe('host_key_changed');
    expect(hosts.calls.some((call) => call.startsWith('exec'))).toBe(false);
  });
});

describe('remote-worktree-sync: pull', () => {
  it("returns 'nothing' and leaves the worktree unchanged when the remote is still at base", async () => {
    const { repo, head, worktree, machineId, sync } = await setup();
    const runId = newId('run');
    await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    const result = await sync.pull({ repoPath: repo, worktreePath: worktree, branch: BRANCH, base: head, runId, machineId });
    expect(result).toBe('nothing');
    expect(existsSync(join(worktree, 'new.txt'))).toBe(false);
  });

  it("fast-forwards and resets the worktree when the remote has moved on, returning 'imported'", async () => {
    const { repo, head, worktree, hosts, machineId, sync } = await setup();
    const runId = newId('run');
    const { remotePath } = await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    const remoteDir = join(hosts.homeDirFor('remote-1', 22), remotePath);
    writeFileSync(join(remoteDir, 'new.txt'), 'hi\n');
    git(remoteDir, 'add', '-A');
    git(remoteDir, 'commit', '-q', '-m', 'agent change');

    const result = await sync.pull({ repoPath: repo, worktreePath: worktree, branch: BRANCH, base: head, runId, machineId });
    expect(result).toBe('imported');
    expect(readFileSync(join(worktree, 'new.txt'), 'utf8')).toBe('hi\n');
    expect(git(repo, 'rev-parse', BRANCH).trim()).toBe(git(remoteDir, 'rev-parse', BRANCH).trim());
  });

  it('rejects with connection_lost when the connection drops mid-exec, with nothing assumed imported', async () => {
    const { repo, head, worktree, hosts, machineId, sync } = await setup();
    const runId = newId('run');
    await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    const before = git(repo, 'rev-parse', BRANCH).trim();

    hosts.setConnectionLost('remote-1', 22);
    const failure = await sync.pull({ repoPath: repo, worktreePath: worktree, branch: BRANCH, base: head, runId, machineId }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RemoteHostError);
    expect((failure as RemoteHostError).code).toBe('connection_lost');
    expect(git(repo, 'rev-parse', BRANCH).trim()).toBe(before);
    expect(existsSync(join(worktree, 'new.txt'))).toBe(false);
  });
});

describe('remote-worktree-sync: remove', () => {
  it('deletes the remote directory; a second remove is a no-op', async () => {
    const { repo, hosts, machineId, sync } = await setup();
    const runId = newId('run');
    const { remotePath } = await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    const home = hosts.homeDirFor('remote-1', 22);
    expect(existsSync(join(home, remotePath))).toBe(true);

    await sync.remove({ runId, machineId });
    expect(existsSync(join(home, remotePath))).toBe(false);
    await expect(sync.remove({ runId, machineId })).resolves.toBeUndefined();
  });

  it('a retry (push again for the same runId after remove) gets a fresh directory, never hot-patched', async () => {
    const { repo, hosts, machineId, sync } = await setup();
    const runId = newId('run');
    const { remotePath } = await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    const remoteDir = join(hosts.homeDirFor('remote-1', 22), remotePath);
    writeFileSync(join(remoteDir, 'new.txt'), 'hi\n');
    git(remoteDir, 'add', '-A');
    git(remoteDir, 'commit', '-q', '-m', 'agent change');
    expect(git(remoteDir, 'log', '--oneline', BRANCH).trim().split('\n').length).toBe(2);

    await sync.remove({ runId, machineId });
    await sync.push({ repoPath: repo, branch: BRANCH, runId, machineId });
    expect(git(remoteDir, 'log', '--oneline', BRANCH).trim().split('\n').length).toBe(1);
  });
});

describe('openRemoteConnection (CAP-24, epic 19 story 19.6)', () => {
  it('opens the same verified connection withConnection uses internally, for a caller (build-start.ts) that holds it open itself', async () => {
    const { hosts, machines, secrets, machineId } = await setup();
    const connection = await openRemoteConnection(machineId, { hosts, secrets, machines });
    expect(hosts.calls).toEqual(['connect remote-1:22']);
    // The caller owns closing it: a second use over the same connection works with no further `connect`.
    const { code } = await connection.exec('true').then((channel) => channel.exitCode.then((exitCode) => ({ code: exitCode })));
    expect(code).toBe(0);
    expect(hosts.calls).toEqual(['connect remote-1:22', 'exec remote-1:22 true']);
    await connection.close();
  });

  it('refuses before connecting when the machine was never confirmed, or its host key changed since (same checks as push/pull/remove)', async () => {
    const { hosts, machines, secrets } = await setup();
    const unconfirmed = machines.add({ host: 'remote-2', port: 22, username: 'ogden', confirmed: false });
    await expect(openRemoteConnection(unconfirmed, { hosts, secrets, machines })).rejects.toBeInstanceOf(RemoteHostError);
    expect(hosts.calls).toEqual([]);
  });
});
