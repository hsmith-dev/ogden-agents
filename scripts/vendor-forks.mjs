#!/usr/bin/env node
// Vendors the pinned forks named in `forks.lock` into `vendor/` (AD-13).
//
//   node scripts/vendor-forks.mjs           # fetch each fork at its locked commit, rewrite vendor/ and the lock's hashes
//   node scripts/vendor-forks.mjs --check   # re-derive vendor/ from the lock and fail if anything differs
//
// `--check` also fails if a fork's tag no longer points at its locked commit
// (GitHub API; set GITHUB_TOKEN to avoid the anonymous rate limit), or if a
// vendored skill's executable bit differs from the fork (not on Windows). It
// compares only files git tracks or would track under vendor/, so ignored files
// such as .DS_Store don't count.
//
// Each fork is fetched as a GitHub tarball of the locked commit (no git clone):
//   - hsmith-dev/BMAD-METHOD: `skills/` is copied to `vendor/bmad-method/skills/`.
//   - hsmith-dev/bmad-loop:   `uv build --wheel` builds the wheel into `vendor/bmad-loop/`.
//
// Content hashes (`contentHash` in the lock) are sha256 over every file's path
// and contents, sorted by path. Skill files are hashed with CRLF normalized to
// LF (binary files, those containing a NUL byte, are left as they are), so a
// Windows checkout hashes the same as any other; vendored skills are also
// written with LF. The wheel is hashed over the files inside it, not the archive
// bytes, because wheels embed timestamps; `--check` rebuilds it and compares its
// file list and each file's contents.
//
// Needs the network and `uv` (https://docs.astral.sh/uv/). Only run by
// maintainers and CI: the published package ships `vendor/` and never fetches.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCK_PATH = join(ROOT, 'forks.lock');

/** A file set: POSIX relative path → contents. */
/** @typedef {Map<string, Buffer>} Entries */

/**
 * @typedef {object} ForkLock
 * @property {string} repo           GitHub `owner/name` of the fork.
 * @property {string} upstream       GitHub `owner/name` the fork tracks.
 * @property {string} tag            `v<upstream version>-ogden-agents.<n>`.
 * @property {string} commit         Full commit SHA the tag points at.
 * @property {string} vendored       Repo-relative path of the vendored output.
 * @property {string[]} [buildConstraints]  Pinned build requirements for `uv build` (bmad-loop only).
 * @property {string} contentHash    `sha256:<hex>` of the vendored output.
 */

/** @typedef {{ forks: { 'bmad-method': ForkLock, 'bmad-loop': ForkLock } }} Lock */

// ---------------------------------------------------------------------------
// Hashing and comparison (pure; unit-tested in tests/vendor-forks.test.ts)
// ---------------------------------------------------------------------------

/** Text contents with CRLF turned into LF; a buffer with a NUL byte is binary and returned unchanged. */
export function normalizeText(/** @type {Buffer} */ data) {
  if (data.includes(0) || !data.includes(13)) return data;
  return Buffer.from(data.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

/** `sha256:<hex>` over each entry's path and contents, in sorted path order. */
export function hashEntries(/** @type {Entries} */ entries) {
  const hash = createHash('sha256');
  for (const path of [...entries.keys()].sort()) {
    const data = /** @type {Buffer} */ (entries.get(path));
    hash.update(`${path}\0${data.length}\0`);
    hash.update(data);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Files under `dir` that git tracks or would track (committed, staged, or new
 * and not ignored), as POSIX paths relative to `dir`. Ignored files such as
 * `.DS_Store` are left out. `dir` must be inside a git work tree.
 */
export function gitFiles(/** @type {string} */ dir) {
  if (!existsSync(dir)) return [];
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`git ls-files failed in ${dir}: ${result.stderr}${result.error ?? ''}`);
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

/**
 * The files git lists under `dir` (see `gitFiles`), keyed by POSIX relative
 * path, with text normalized to LF. A tracked file deleted from disk is left
 * out, so it is reported as missing.
 */
export function readTree(/** @type {string} */ dir) {
  /** @type {Entries} */
  const entries = new Map();
  for (const path of gitFiles(dir)) {
    const full = join(dir, ...path.split('/'));
    if (existsSync(full)) entries.set(path, normalizeText(readFileSync(full)));
  }
  return entries;
}

/** Whether each of `paths` under `dir` has an executable bit set (files that don't exist are skipped). */
export function readExecutableBits(/** @type {string} */ dir, /** @type {Iterable<string>} */ paths) {
  /** @type {Map<string, boolean>} */
  const bits = new Map();
  for (const path of paths) {
    const full = join(dir, ...path.split('/'));
    if (existsSync(full)) bits.set(path, (statSync(full).mode & 0o111) !== 0);
  }
  return bits;
}

/**
 * One message per file whose executable bit differs between the fork's tar
 * modes and the vendored files. Files present on only one side are left to
 * `diffEntries`.
 */
export function diffExecutableBits(
  /** @type {Map<string, number>} */ expectedModes,
  /** @type {Map<string, boolean>} */ actual,
  /** @type {string} */ label,
) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, mode] of [...expectedModes].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const have = actual.get(path);
    if (have === undefined) continue;
    const want = (mode & 0o111) !== 0;
    if (want !== have) problems.push(`${label}/${path} should ${want ? '' : 'not '}be executable, as in the locked fork`);
  }
  return problems;
}

/** Reads GitHub REST API JSON for a path such as `/repos/o/r/git/ref/tags/v1`. */
/** @typedef {(path: string) => Promise<any>} GetJson */

/** The commit SHA `tag` points at in `repo`, peeling annotated tags. */
export async function resolveTagCommit(/** @type {string} */ repo, /** @type {string} */ tag, /** @type {GetJson} */ getJson) {
  let { object } = await getJson(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
  for (let depth = 0; object?.type === 'tag' && depth < 10; depth++) {
    ({ object } = await getJson(`/repos/${repo}/git/tags/${object.sha}`));
  }
  if (object?.type !== 'commit') throw new Error(`${repo} tag ${tag} does not point at a commit`);
  return /** @type {string} */ (object.sha);
}

/** A message if the fork's tag doesn't point at its locked commit, or can't be resolved. */
export async function checkTag(/** @type {string} */ name, /** @type {ForkLock} */ fork, /** @type {GetJson} */ getJson) {
  try {
    const sha = await resolveTagCommit(fork.repo, fork.tag, getJson);
    return sha === fork.commit ? [] : [`${name}: tag ${fork.tag} in ${fork.repo} points at ${sha}, but forks.lock pins ${fork.commit}`];
  } catch (error) {
    return [`${name}: could not resolve tag ${fork.tag} in ${fork.repo}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** @type {GetJson} */
async function githubApi(path) {
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ogden-agents-vendor-forks' };
  // Authenticated requests avoid the low anonymous rate limit on shared CI runners.
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

/**
 * One message per file that is missing from, extra in, or different in
 * `actual` compared with `expected`, each naming the file under `label`.
 */
export function diffEntries(/** @type {Entries} */ expected, /** @type {Entries} */ actual, /** @type {string} */ label) {
  /** @type {string[]} */
  const problems = [];
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const path of paths) {
    const want = expected.get(path);
    const have = actual.get(path);
    if (!have) problems.push(`${label}/${path} is missing`);
    else if (!want) problems.push(`${label}/${path} is not in the locked fork`);
    else if (!want.equals(have)) problems.push(`${label}/${path} differs from the locked fork`);
  }
  return problems;
}

/**
 * Compares the committed vendored files with those re-derived from the lock:
 * any file difference, and a hash that doesn't match the lock (for example a
 * bumped commit that was never re-vendored).
 */
export function compareVendored(
  /** @type {{ name: string, label: string, expected: Entries, actual: Entries, lockedHash: string }} */ args,
) {
  const { name, label, expected, actual, lockedHash } = args;
  const problems = diffEntries(expected, actual, label);
  const derived = hashEntries(expected);
  if (derived !== lockedHash) {
    problems.push(`${name}: forks.lock contentHash is ${lockedHash}, but the locked commit gives ${derived}; re-run node scripts/vendor-forks.mjs`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

/** @param {Buffer} buf @param {number} start @param {number} length */
function field(buf, start, length) {
  const raw = buf.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/** `key=value` records of a pax extended header. */
function parsePax(/** @type {Buffer} */ data) {
  /** @type {Record<string, string>} */
  const records = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(offset, space).toString('utf8'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1) records[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return records;
}

/**
 * Entries of an uncompressed tar archive (ustar, with pax and GNU long names,
 * as GitHub serves them).
 * @returns {Array<{ path: string, type: 'file' | 'dir' | 'symlink' | 'other', mode: number, data: Buffer }>}
 */
export function parseTar(/** @type {Buffer} */ buf) {
  /** @type {ReturnType<typeof parseTar>} */
  const out = [];
  /** @type {string | undefined} */
  let longPath;
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const mode = Number.parseInt(field(header, 100, 8).trim() || '0', 8);
    const flag = header[156] === 0 ? '0' : String.fromCharCode(/** @type {number} */ (header[156]));
    const data = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (flag === 'x') {
      longPath = parsePax(data).path ?? longPath;
      continue;
    }
    if (flag === 'g') continue;
    if (flag === 'L') {
      longPath = field(data, 0, data.length);
      continue;
    }
    const name = field(header, 0, 100);
    const prefix = field(header, 257, 6).startsWith('ustar') ? field(header, 345, 155) : '';
    const path = longPath ?? (prefix ? `${prefix}/${name}` : name);
    longPath = undefined;
    const type = flag === '0' || flag === '7' ? 'file' : flag === '5' ? 'dir' : flag === '2' ? 'symlink' : 'other';
    out.push({ path, type, mode, data });
  }
  return out;
}

/** Files inside a zip archive (such as a wheel), keyed by name. */
export function readZip(/** @type {Buffer} */ buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip archive (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  /** @type {Entries} */
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(raw));
    else if (method === 8) entries.set(name, inflateRawSync(raw));
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Fetching and building
// ---------------------------------------------------------------------------

/** Files of `repo` at `commit`, with the tarball's top-level folder stripped. */
async function fetchFork(/** @type {ForkLock} */ fork) {
  const url = `https://codeload.github.com/${fork.repo}/tar.gz/${fork.commit}`;
  /** @type {Response} */
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`could not download ${fork.repo}@${fork.commit} (${url}); is the network available? ${String(error)}`);
  }
  if (!response.ok) throw new Error(`downloading ${url} failed: HTTP ${response.status}`);
  const entries = parseTar(gunzipSync(Buffer.from(await response.arrayBuffer())));
  return entries.map((entry) => ({ ...entry, path: entry.path.split('/').slice(1).join('/') })).filter((entry) => entry.path);
}

/** BMAD-METHOD's `skills/` folder, text normalized to LF. */
function skillsFrom(/** @type {Awaited<ReturnType<typeof fetchFork>>} */ files) {
  /** @type {Entries} */
  const entries = new Map();
  /** @type {Map<string, number>} */
  const modes = new Map();
  for (const file of files) {
    if (!file.path.startsWith('skills/')) continue;
    const path = file.path.slice('skills/'.length);
    if (file.type === 'symlink' || file.type === 'other') throw new Error(`skills/${path} is not a regular file`);
    if (file.type !== 'file') continue;
    entries.set(path, normalizeText(file.data));
    modes.set(path, file.mode);
  }
  if (entries.size === 0) throw new Error('the locked BMAD-METHOD commit has no skills/ folder');
  return { entries, modes };
}

function requireUv() {
  const result = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error('uv is required to build the bmad-loop wheel; install it from https://docs.astral.sh/uv/ and retry');
  }
  return result.stdout.trim();
}

/** Builds bmad-loop's wheel from the locked commit; returns its file name and bytes. */
function buildWheel(/** @type {Awaited<ReturnType<typeof fetchFork>>} */ files, /** @type {ForkLock} */ fork) {
  const work = mkdtempSync(join(tmpdir(), 'vendor-forks-'));
  try {
    const src = join(work, 'src');
    for (const file of files) {
      if (file.type !== 'file') continue;
      const target = join(src, ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.data);
    }
    const out = join(work, 'out');
    const args = ['build', '--wheel', '--out-dir', out, '--no-config'];
    if (fork.buildConstraints?.length) {
      const constraints = join(work, 'build-constraints.txt');
      writeFileSync(constraints, `${fork.buildConstraints.join('\n')}\n`);
      args.push('--build-constraints', constraints);
    }
    args.push(src);
    // A fixed timestamp keeps the build as reproducible as the backend allows.
    const result = spawnSync('uv', args, { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '315532800' } });
    if (result.error || result.status !== 0) {
      throw new Error(`uv build failed (${result.status}):\n${result.stderr}${result.stdout}${result.error ?? ''}`);
    }
    const wheels = readdirSync(out).filter((name) => name.endsWith('.whl'));
    if (wheels.length !== 1) throw new Error(`uv build produced ${wheels.length} wheels: ${wheels.join(', ')}`);
    const name = /** @type {string} */ (wheels[0]);
    return { name, data: readFileSync(join(out, name)) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function readLock() {
  return /** @type {Lock} */ (JSON.parse(readFileSync(LOCK_PATH, 'utf8')));
}

async function vendor() {
  console.log(`vendor-forks: using ${requireUv()}`);
  const lock = readLock();

  const method = lock.forks['bmad-method'];
  const { entries: skills, modes } = skillsFrom(await fetchFork(method));
  const skillsDir = join(ROOT, 'vendor', 'bmad-method', 'skills');
  rmSync(skillsDir, { recursive: true, force: true });
  for (const [path, data] of skills) {
    const target = join(skillsDir, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    if ((modes.get(path) ?? 0) & 0o111) chmodSync(target, 0o755);
  }
  method.vendored = 'vendor/bmad-method/skills';
  method.contentHash = hashEntries(skills);
  console.log(`vendor-forks: ${method.repo}@${method.tag}: ${skills.size} skill files -> ${method.vendored}`);

  const loop = lock.forks['bmad-loop'];
  const wheel = buildWheel(await fetchFork(loop), loop);
  const loopDir = join(ROOT, 'vendor', 'bmad-loop');
  rmSync(loopDir, { recursive: true, force: true });
  mkdirSync(loopDir, { recursive: true });
  writeFileSync(join(loopDir, wheel.name), wheel.data);
  loop.vendored = `vendor/bmad-loop/${wheel.name}`;
  loop.contentHash = hashEntries(readZip(wheel.data));
  console.log(`vendor-forks: ${loop.repo}@${loop.tag}: built ${loop.vendored}`);

  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log('vendor-forks: updated forks.lock; commit it together with vendor/');
}

async function check() {
  requireUv();
  const lock = readLock();
  /** @type {string[]} */
  const problems = [];

  const method = lock.forks['bmad-method'];
  const loop = lock.forks['bmad-loop'];
  problems.push(...(await checkTag('bmad-method', method, githubApi)), ...(await checkTag('bmad-loop', loop, githubApi)));

  const { entries: skills, modes } = skillsFrom(await fetchFork(method));
  const skillsDir = join(ROOT, ...method.vendored.split('/'));
  problems.push(
    ...compareVendored({
      name: 'bmad-method',
      label: method.vendored,
      expected: skills,
      actual: readTree(skillsDir),
      lockedHash: method.contentHash,
    }),
  );
  // Windows has no executable bit to compare.
  if (process.platform !== 'win32') {
    problems.push(...diffExecutableBits(modes, readExecutableBits(skillsDir, modes.keys()), method.vendored));
  }

  const wheel = buildWheel(await fetchFork(loop), loop);
  const expectedPath = `vendor/bmad-loop/${wheel.name}`;
  if (loop.vendored !== expectedPath) problems.push(`bmad-loop: forks.lock names ${loop.vendored}, but the locked commit builds ${expectedPath}`);
  const vendoredWheels = gitFiles(join(ROOT, 'vendor', 'bmad-loop'));
  for (const name of vendoredWheels) if (name !== wheel.name) problems.push(`vendor/bmad-loop/${name} is not the locked wheel`);
  const committed = join(ROOT, 'vendor', 'bmad-loop', wheel.name);
  if (!existsSync(committed)) {
    problems.push(`${expectedPath} is missing`);
  } else {
    problems.push(
      ...compareVendored({
        name: 'bmad-loop',
        label: expectedPath,
        expected: readZip(wheel.data),
        actual: readZip(readFileSync(committed)),
        lockedHash: loop.contentHash,
      }),
    );
  }

  if (problems.length > 0) {
    console.error(`vendor-forks --check: vendor/ does not match forks.lock:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`vendor-forks --check: vendor/ matches forks.lock (${method.tag}, ${loop.tag})`);
}

/** True when this file is the script node was started with (not imported by a test). */
function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const started = resolve(process.argv[1]);
  // Windows paths may differ only in drive-letter or other casing.
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`vendor-forks: unknown argument ${unknown.join(' ')}; usage: node scripts/vendor-forks.mjs [--check]`);
    process.exit(2);
  }
  (args.includes('--check') ? check() : vendor()).catch((/** @type {unknown} */ error) => {
    console.error(`vendor-forks: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
