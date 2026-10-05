/**
 * `vcs-git` story 5.6 against temp repos (real git, no network, no sandbox):
 * a run's own object store. The agent's git writes its objects to the store
 * (as the sandboxed agent's environment says), so the repo's own objects
 * never change; reading the run's branch finds them through the store as an
 * alternate; approve's import brings them in through git's strict unpacking
 * and refuses damaged or forged ones, importing nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitVcs } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

const baseEnv = (top: string, config: string) => ({ PATH: process.env.PATH ?? '', HOME: top, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });

/** Plain git for the test's own setup, with extra environment (the agent's object variables). */
const gitWith = (env: Record<string, string>, cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.longpaths=true', '-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const git = (cwd: string, ...args: string[]) => gitWith({}, cwd, ...args);

/** Every file under a folder, relative, sorted (an object folder's listing). */
function listing(dir: string): string[] {
  const out: string[] = [];
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(folder, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

const RUN = 'abcdefgh';
const BRANCH = `ogden/${RUN}/1.1-thing`;

function setup() {
  const repo = temp('ogden-agents-os-repo-');
  const data = temp('ogden-agents-os-data-');
  const config = join(data, 'empty-gitconfig');
  writeFileSync(config, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  const worktreesRoot = join(data, 'w');
  const runsRoot = join(data, 'r');
  mkdirSync(worktreesRoot);
  mkdirSync(join(runsRoot, RUN), { recursive: true });
  const store = join(runsRoot, RUN, 'objects');
  mkdirSync(store);
  const vcs = createGitVcs({ hooksDir: join(data, 'tools', 'git-hooks-none'), worktreesRoot, runsRoot, env: () => baseEnv(data, config) });
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  const worktree = join(worktreesRoot, RUN);
  const objects = join(repo, '.git', 'objects');
  /** The sandboxed agent's environment (core's `objectStoreEnv`). */
  const agentEnv = { GIT_OBJECT_DIRECTORY: store, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
  const work = (files: Record<string, string>, message = 'work') => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(worktree, name, '..'), { recursive: true });
      writeFileSync(join(worktree, name), text);
    }
    gitWith(agentEnv, worktree, 'add', '-A');
    gitWith(agentEnv, worktree, 'commit', '-q', '--no-verify', '-m', message);
    return gitWith(agentEnv, worktree, 'rev-parse', 'HEAD').trim();
  };
  return { repo, data, vcs, base, worktree, objects, store, runsRoot, agentEnv, work, config };
}

async function withRun() {
  const s = setup();
  await s.vcs.addWorktree(s.repo, { path: s.worktree, branch: BRANCH, base: s.base });
  return s;
}

const hasObject = (repo: string, id: string) => {
  try {
    execFileSync('git', ['cat-file', '-e', id], { cwd: repo, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('a run object store (story 5.6)', () => {
  it("keeps the agent's objects out of the repo, and reads and diffs the branch through the store", async () => {
    const s = await withRun();
    const before = listing(s.objects);
    const commit = s.work({ 'src/a.ts': 'export const a = 1;\n' });
    // The repo's own objects are exactly as they were; the store holds the new ones.
    expect(listing(s.objects)).toEqual(before);
    expect(listing(s.store).length).toBeGreaterThan(0);
    expect(hasObject(s.repo, commit)).toBe(false);
    // Ogden Agents reads the run's branch with the store as an alternate.
    expect(await s.vcs.branchRevision(s.repo, BRANCH)).toBe(commit);
    const changes = await s.vcs.diff(s.repo, s.base, BRANCH);
    expect(changes.files).toEqual(['src/a.ts']);
    expect(changes.diff).toContain('+export const a = 1;');
    expect(await s.vcs.diffStats(s.repo, s.base, BRANCH)).toEqual({ files: 1, insertions: 1, deletions: 0 });
    expect(await s.vcs.isMerged(s.repo, BRANCH)).toBe(false);
    // Reading never wrote into the repo either.
    expect(listing(s.objects)).toEqual(before);
  });

  it('imports the branch objects through git, then the merge works and the repo is sound', async () => {
    const s = await withRun();
    const commit = s.work({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
    expect(await s.vcs.importObjects(s.repo, BRANCH, s.base)).toBe('imported');
    expect(hasObject(s.repo, commit)).toBe(true);
    expect(await s.vcs.merge(s.repo, commit)).toBe('merged');
    git(s.repo, 'commit', '-q', '--no-verify', '--no-edit', '-m', 'merge');
    expect(readFileSync(join(s.repo, 'src', 'b.ts'), 'utf8')).toContain('b = 2');
    // Nothing is damaged: a strict check of the whole repo passes.
    expect(() => git(s.repo, 'fsck', '--strict', '--no-dangling')).not.toThrow();
    // Importing again has nothing new to bring.
    expect(['imported', 'nothing']).toContain(await s.vcs.importObjects(s.repo, BRANCH, s.base));
  });

  it('refuses damaged objects and imports nothing', async () => {
    const s = await withRun();
    const commit = s.work({ 'src/a.ts': 'export const a = 1;\n' });
    const before = listing(s.objects);
    // Damage the blob the commit added: not even zlib any more.
    const blob = gitWith(s.agentEnv, s.worktree, 'rev-parse', 'HEAD:src/a.ts').trim();
    const file = join(s.store, blob.slice(0, 2), blob.slice(2));
    expect(existsSync(file)).toBe(true);
    rmSync(file, { force: true });
    writeFileSync(file, 'this is not an object');
    expect(await s.vcs.importObjects(s.repo, BRANCH, s.base)).toBe('refused');
    expect(listing(s.objects)).toEqual(before);
    expect(hasObject(s.repo, commit)).toBe(false);
  });

  it('refuses a forged object (valid, but another file under this name) and imports nothing usable', async () => {
    const s = await withRun();
    const commit = s.work({ 'src/a.ts': 'export const a = 1;\n', 'src/other.ts': 'export const other = 99;\n' });
    const before = listing(s.objects);
    const blob = gitWith(s.agentEnv, s.worktree, 'rev-parse', 'HEAD:src/a.ts').trim();
    const other = gitWith(s.agentEnv, s.worktree, 'rev-parse', 'HEAD:src/other.ts').trim();
    // The other blob's valid compressed bytes under the first blob's name.
    const target = join(s.store, blob.slice(0, 2), blob.slice(2));
    rmSync(target, { force: true });
    writeFileSync(target, readFileSync(join(s.store, other.slice(0, 2), other.slice(2))));
    expect(await s.vcs.importObjects(s.repo, BRANCH, s.base)).toBe('refused');
    // git's strict unpacking may have kept a whole valid object that nothing refers to; the forged name and the commit never arrived.
    expect(listing(s.objects).filter((name) => !before.includes(name))).not.toContain(`${blob.slice(0, 2)}/${blob.slice(2)}`);
    expect(hasObject(s.repo, blob)).toBe(false);
    expect(hasObject(s.repo, commit)).toBe(false);
  });

  it('a rebase in the run worktree writes into the store, never the repo objects', async () => {
    const s = await withRun();
    s.work({ 'src/a.ts': 'export const a = 1;\n' });
    // The user commits on main meanwhile.
    writeFileSync(join(s.repo, 'NOTES.md'), 'notes\n');
    git(s.repo, 'add', '-A');
    git(s.repo, 'commit', '-q', '--no-verify', '-m', 'notes');
    const onto = git(s.repo, 'rev-parse', 'HEAD').trim();
    const before = listing(s.objects);
    const storeBefore = listing(s.store);
    expect(await s.vcs.rebase({ repoPath: s.repo, worktreePath: s.worktree, branch: BRANCH, onto })).toBe('rebased');
    expect(listing(s.objects)).toEqual(before);
    expect(listing(s.store).length).toBeGreaterThan(storeBefore.length);
    const rebased = await s.vcs.branchRevision(s.repo, BRANCH);
    expect(rebased).toBeDefined();
    expect((await s.vcs.diff(s.repo, onto, BRANCH)).files).toEqual(['src/a.ts']);
    expect(await s.vcs.importObjects(s.repo, BRANCH, onto)).toBe('imported');
    expect(hasObject(s.repo, rebased!)).toBe(true);
  });

  it('refuses a store holding an alternates list or a link, and never reads through it', async () => {
    const s = await withRun();
    s.work({ 'src/a.ts': 'export const a = 1;\n' });
    mkdirSync(join(s.store, 'info'), { recursive: true });
    writeFileSync(join(s.store, 'info', 'alternates'), '/etc\n');
    expect(await s.vcs.importObjects(s.repo, BRANCH, s.base)).toBe('refused');
    // Reads go without the store: the run's commit isn't visible any more.
    expect(await s.vcs.branchRevision(s.repo, BRANCH)).toBeUndefined();
  });

  it('an attended run has no store, so there is nothing to import, and a linked store is never used', async () => {
    const s = setup();
    rmSync(s.store, { recursive: true, force: true });
    await s.vcs.addWorktree(s.repo, { path: s.worktree, branch: BRANCH, base: s.base });
    expect(await s.vcs.importObjects(s.repo, BRANCH, s.base)).toBe('nothing');
    if (process.platform !== 'win32') {
      const elsewhere = temp('ogden-agents-os-elsewhere-');
      symlinkSync(elsewhere, s.store, 'dir');
      writeFileSync(join(elsewhere, 'marker'), 'x');
      expect(await s.vcs.importObjects(s.repo, BRANCH, s.base)).toBe('nothing');
    }
    // A branch that is not a run's (the user's own) never has one.
    expect(await s.vcs.importObjects(s.repo, 'main', s.base)).toBe('nothing');
  });

  it('removes a run branch whose objects are in the store, and the repo is unharmed', async () => {
    const s = await withRun();
    s.work({ 'src/a.ts': 'export const a = 1;\n' });
    await s.vcs.removeWorktree(s.repo, s.worktree, { deleteBranch: BRANCH });
    expect(git(s.repo, 'branch', '--list', BRANCH).trim()).toBe('');
    expect(() => git(s.repo, 'fsck', '--strict', '--no-dangling')).not.toThrow();
  });
});
