#!/usr/bin/env node
// Syncs Ogden Agents' maintained BMad Method fork with upstream (user decision
// 2026-10-04: "We should only be forking BMad and maintaining it with changes
// from BMad, we do not want to push anything to upstream."). The procedure and
// why are in docs/bmad-fork.md.
//
//   node scripts/bmad-fork-sync.mjs --clone <dir> [--base <upstream commit or ref>] [--skip-checks] [--push]
//
// In a local clone of the fork it:
//   1. points `upstream` at bmad-code-org/BMAD-METHOD with pushing disabled,
//      and `fork` at hsmith-dev/BMAD-METHOD,
//   2. fetches both (upstream is only ever fetched),
//   3. moves the local `upstream` branch to the base (default: upstream main),
//   4. rebases Ogden Agents' patches (fork/upstream..fork/ogden-agents) onto it
//      as the local `ogden-agents` branch; a conflict stops here,
//   5. runs upstream's own checks (`uv sync --frozen`, then
//      `uv run --frozen pre-commit run --all-files`) unless --skip-checks,
//   6. tags the result `ogden-agents/<today>` (`.2`, `.3`... when taken; a
//      commit already tagged keeps its tag),
//   7. with --push, pushes `upstream`, `ogden-agents` (with a lease) and the tag
//      to the fork, and nowhere else,
// then prints the bmad-lock.json entry to pin.
//
// It refuses to push to any remote but the fork, and never pushes to a URL
// naming bmad-code-org. Tags are never deleted or moved: every released pin
// stays downloadable by its commit.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPSTREAM_URL = 'https://github.com/bmad-code-org/BMAD-METHOD.git';
export const FORK_URL = 'https://github.com/hsmith-dev/BMAD-METHOD.git';
/** The push URL the `upstream` remote gets: not a URL, so a push there fails. */
export const NO_PUSH = 'no-push-to-upstream';
/** The fork's branch holding Ogden Agents' patches, and its upstream base branch. */
export const PATCH_BRANCH = 'ogden-agents';
export const BASE_BRANCH = 'upstream';

/** Whether a push may go to `url`: only the fork, never anything of bmad-code-org. */
export function pushAllowed(/** @type {string} */ url) {
  const normalized = url.trim().toLowerCase().replace(/\.git$/, '').replace(/\/$/, '');
  if (normalized.includes('bmad-code-org')) return false;
  return normalized === FORK_URL.toLowerCase().replace(/\.git$/, '') || normalized === 'git@github.com:hsmith-dev/bmad-method';
}

/** The first free tag for `date` (`YYYY-MM-DD`) among `existing`: `ogden-agents/<date>`, then `.2`, `.3`... */
export function nextTag(/** @type {readonly string[]} */ existing, /** @type {string} */ date) {
  const taken = new Set(existing);
  const first = `${PATCH_BRANCH}/${date}`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) if (!taken.has(`${first}.${n}`)) return `${first}.${n}`;
}

/** The bmad-lock.json entry for a synced fork commit (the content hash comes from `node scripts/bmad-lock.mjs --print`). */
export function lockEntry(/** @type {{ commit: string, tag: string, base: string, version: string }} */ synced) {
  return {
    repo: 'hsmith-dev/BMAD-METHOD',
    ref: synced.tag,
    commit: synced.commit,
    base: { repo: 'bmad-code-org/BMAD-METHOD', ref: 'main', commit: synced.base },
    version: synced.version,
    include: 'skills/',
    contentHash: 'sha256:<node scripts/bmad-lock.mjs --print>',
  };
}

function parseArgs(/** @type {string[]} */ argv) {
  /** @type {{ clone?: string, base: string, checks: boolean, push: boolean }} */
  const options = { base: `${BASE_BRANCH}/main`, checks: true, push: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--clone') options.clone = argv[++i];
    else if (arg === '--base') options.base = argv[++i] ?? '';
    else if (arg === '--skip-checks') options.checks = false;
    else if (arg === '--push') options.push = true;
    else throw new Error(`unknown argument ${String(arg)}`);
  }
  if (!options.clone || !options.base) throw new Error('usage: node scripts/bmad-fork-sync.mjs --clone <dir> [--base <upstream commit or ref>] [--skip-checks] [--push]');
  return options;
}

function main() {
  const { clone, base, checks, push } = parseArgs(process.argv.slice(2));
  const dir = /** @type {string} */ (clone);
  const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const tryGit = (/** @type {string[]} */ ...args) => {
    try {
      return git(...args);
    } catch {
      return undefined;
    }
  };
  /** Sets a remote's fetch URL (adding it when missing). */
  const remote = (/** @type {string} */ name, /** @type {string} */ url) => {
    if (tryGit('remote', 'get-url', name) === undefined) git('remote', 'add', name, url);
    else git('remote', 'set-url', name, url);
  };

  remote(BASE_BRANCH, UPSTREAM_URL);
  git('remote', 'set-url', '--push', BASE_BRANCH, NO_PUSH);
  remote('fork', FORK_URL);
  // Network steps retry once: GitHub fetches are flaky.
  for (const name of [BASE_BRANCH, 'fork']) {
    if (tryGit('fetch', '--tags', name) === undefined) git('fetch', '--tags', name);
  }
  const oldBase = git('rev-parse', `fork/${BASE_BRANCH}`);
  const newBase = git('rev-parse', `${base}^{commit}`);
  if (tryGit('merge-base', '--is-ancestor', newBase, `${BASE_BRANCH}/main`) === undefined) throw new Error(`${base} is not in upstream main's history`);
  const patches = git('rev-list', '--reverse', `${oldBase}..fork/${PATCH_BRANCH}`).split('\n').filter(Boolean);
  console.log(`bmad-fork-sync: ${patches.length} Ogden Agents patch(es) from ${oldBase.slice(0, 7)} onto ${newBase.slice(0, 7)}`);

  git('branch', '-f', BASE_BRANCH, newBase);
  git('checkout', '-B', PATCH_BRANCH, `fork/${PATCH_BRANCH}`);
  if (tryGit('rebase', '--onto', newBase, oldBase, PATCH_BRANCH) === undefined) {
    throw new Error(`the rebase stopped on a conflict in ${dir}: resolve it and run \`git rebase --continue\`, then finish by hand from step 5 of docs/bmad-fork.md`);
  }
  if (checks) {
    execFileSync('uv', ['sync', '--frozen'], { cwd: dir, stdio: 'inherit' });
    execFileSync('uv', ['run', '--frozen', 'pre-commit', 'run', '--all-files'], { cwd: dir, stdio: 'inherit' });
  }
  const commit = git('rev-parse', 'HEAD');
  // A commit already tagged (nothing changed since the last sync) keeps its tag; a new one gets the next free name.
  const existing = git('tag', '--points-at', commit, '--list', `${PATCH_BRANCH}/*`).split('\n').filter(Boolean);
  const tag = existing[0] ?? nextTag(git('tag', '--list', `${PATCH_BRANCH}/*`).split('\n').filter(Boolean), new Date().toISOString().slice(0, 10));
  if (existing.length === 0) git('tag', '-a', tag, '-m', `Ogden Agents patches on upstream ${newBase.slice(0, 7)}`);
  console.log(`bmad-fork-sync: ${PATCH_BRANCH} is ${commit}, tagged ${tag}`);

  if (push) {
    const url = git('remote', 'get-url', '--push', 'fork');
    if (!pushAllowed(url)) throw new Error(`refusing to push to ${url}: only ${FORK_URL}`);
    git('push', 'fork', `--force-with-lease=${BASE_BRANCH}:${oldBase}`, `${BASE_BRANCH}:${BASE_BRANCH}`);
    git('push', 'fork', `--force-with-lease=${PATCH_BRANCH}:${git('rev-parse', `fork/${PATCH_BRANCH}`)}`, `${PATCH_BRANCH}:${PATCH_BRANCH}`);
    git('push', 'fork', `refs/tags/${tag}`);
  } else {
    console.log('bmad-fork-sync: not pushed (pass --push to push the branches and the tag to the fork)');
  }
  // The version upstream gives the module at that commit (`skills/bmod-method/bmod.toml`).
  const version = tryGit('show', `${commit}:skills/bmod-method/bmod.toml`)?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? '<upstream version>';
  console.log(`bmad-fork-sync: pin it in packages/adapters/src/bmad-source/bmad-lock.json:\n${JSON.stringify(lockEntry({ commit, tag, base: newBase, version }), null, 2)}`);
}

/** True when this file is the script node was started with (not imported by a test). */
function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const started = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMain()) {
  try {
    main();
  } catch (error) {
    console.error(`bmad-fork-sync: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
