#!/usr/bin/env node
// Checks the pinned upstream BMad sources in
// `packages/adapters/src/bmad-source/bmad-lock.json` (story 4.14, AD-13).
//
//   node scripts/bmad-lock.mjs --check   # CI: fail if a pin no longer holds
//   node scripts/bmad-lock.mjs --print   # maintainers: print each pin's computed content hash
//
// For each source, `--check` downloads the codeload tarball of the pinned
// commit, recomputes the content hash of the files under its `include`
// through the same module the app uses (`bmad-source/archive.ts`: LF
// normalized, sorted paths, and the same refusal of unsafe entries), and
// compares it with the lock's `contentHash`. It also asks GitHub's compare
// API whether the commit is in the history of the lock's `ref` (status
// `identical` or `behind`); set GITHUB_TOKEN to avoid the anonymous rate
// limit. Downloads retry with back-off.
//
// Needs the network. Only run by maintainers and CI: the app downloads a
// pinned tarball only when the user asks, and no test reaches GitHub.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BMAD_DOWNLOAD_MAX_BYTES as MAX_BYTES,
  BMAD_UNPACKED_MAX_BYTES as MAX_UNPACKED_BYTES,
  gunzipLimited,
  hashEntries,
  parseTar,
  selectVerified,
  tarballUrl,
} from '../packages/adapters/src/bmad-source/archive.ts';

const LOCK_PATH = fileURLToPath(new URL('../packages/adapters/src/bmad-source/bmad-lock.json', import.meta.url));
const ATTEMPTS = 4;

/**
 * @typedef {object} Pin
 * @property {string} repo
 * @property {string} ref
 * @property {string} commit
 * @property {string} version
 * @property {string} include
 * @property {string} contentHash
 */
/** @typedef {{ sources: Record<string, Pin> }} Lock */
/** Reads GitHub REST API JSON for a path such as `/repos/o/r/compare/a...b`. */
/** @typedef {(path: string) => Promise<any>} GetJson */

// The app's own URL and caps (`archive.ts`), re-exported for the tests.
export { tarballUrl };

/** The content hash of `tarball`'s files under `include`, exactly as the app computes it. */
export function contentHashOf(/** @type {Buffer} */ tarball, /** @type {string} */ include) {
  const entries = selectVerified(parseTar(gunzipLimited(tarball, MAX_UNPACKED_BYTES)), include);
  return { hash: hashEntries(entries), files: entries.size };
}

/** A message when the computed hash isn't the lock's. */
export function checkHash(/** @type {string} */ name, /** @type {Pin} */ pin, /** @type {string} */ actual) {
  return actual === pin.contentHash ? [] : [`${name}: ${pin.repo}@${pin.commit} hashes ${actual}, but bmad-lock.json pins ${pin.contentHash}`];
}

/** A message unless the pinned commit is in the history of the lock's `ref` (GitHub compare status `identical` or `behind`). */
export async function checkHistory(/** @type {string} */ name, /** @type {Pin} */ pin, /** @type {GetJson} */ getJson) {
  try {
    const { status } = await getJson(`/repos/${pin.repo}/compare/${encodeURIComponent(pin.ref)}...${pin.commit}`);
    if (status === 'identical' || status === 'behind') return [];
    return [`${name}: ${pin.commit} is not in the history of ${pin.repo} ${pin.ref} (compare status ${String(status)})`];
  } catch (error) {
    return [`${name}: could not compare ${pin.ref}...${pin.commit} in ${pin.repo}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** @type {GetJson} */
async function githubApi(path) {
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ogden-agents-bmad-lock' };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return withRetry(async () => {
    const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
    return response.json();
  });
}

/**
 * @template T
 * @param {() => Promise<T>} attempt
 * @returns {Promise<T>}
 */
async function withRetry(attempt) {
  let lastError;
  for (let n = 1; n <= ATTEMPTS; n++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (n < ATTEMPTS) {
        console.warn(`bmad-lock: attempt ${n} failed (${error instanceof Error ? error.message : String(error)}); retrying`);
        await new Promise((done) => setTimeout(done, 3000 * 2 ** (n - 1)));
      }
    }
  }
  throw lastError;
}

/** The tarball of `pin`, capped at {@link MAX_BYTES}. */
async function download(/** @type {Pin} */ pin) {
  return withRetry(async () => {
    const response = await fetch(tarballUrl(pin), { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
    if (!response.ok || response.body === null) throw new Error(`GET ${tarballUrl(pin)}: HTTP ${response.status}`);
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) throw new Error(`${tarballUrl(pin)} is larger than ${MAX_BYTES} bytes`);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  });
}

function readLock() {
  return /** @type {Lock} */ (JSON.parse(readFileSync(LOCK_PATH, 'utf8')));
}

async function run(/** @type {'check' | 'print'} */ mode) {
  const lock = readLock();
  /** @type {string[]} */
  const problems = [];
  for (const [name, pin] of Object.entries(lock.sources)) {
    const { hash, files } = contentHashOf(await download(pin), pin.include);
    if (mode === 'print') {
      console.log(`${name}: ${pin.repo}@${pin.commit} include "${pin.include}": ${files} files, contentHash ${hash}`);
      continue;
    }
    problems.push(...checkHash(name, pin, hash), ...(await checkHistory(name, pin, githubApi)));
    console.log(`bmad-lock: ${name} ${pin.repo}@${pin.commit}: ${files} files, ${hash}`);
  }
  if (problems.length > 0) {
    console.error(`bmad-lock --check: bmad-lock.json does not hold:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  if (mode === 'check') console.log('bmad-lock --check: every pin matches its upstream commit');
}

/** True when this file is the script node was started with (not imported by a test). */
function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const started = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || (args[0] !== '--check' && args[0] !== '--print')) {
    console.error('usage: node scripts/bmad-lock.mjs --check | --print');
    process.exit(2);
  }
  run(args[0] === '--check' ? 'check' : 'print').catch((/** @type {unknown} */ error) => {
    console.error(`bmad-lock: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
