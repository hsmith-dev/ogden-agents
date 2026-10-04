#!/usr/bin/env node
/**
 * The pinned Claude Agent ACP adapter Ogden Agents installs (story 9.3):
 * `packages/adapters/src/setup-claude-code/pins/{package.json,package-lock.json}`.
 * Needs the network; the unit and browser tests never run it.
 *
 *   node scripts/agent-pins.mjs --update <version>   regenerate both files for that exact version
 *   node scripts/agent-pins.mjs --check              `npm ci` the pins into a temp folder, as the app does
 *   node scripts/agent-pins.mjs --check --with-binary   the same with the SDK's bundled `claude`
 *   node scripts/agent-pins.mjs --check --agent antigravity   Antigravity's pinned archive (epic 6 entry 5)
 *
 * `--update` writes an exact version and a lockfile in which every package
 * has its `resolved` URL and `integrity`; bump the pin in a pull request.
 * `--check` runs the app's own install (node + npm-cli.js, `--ignore-scripts`,
 * the npm cache inside the temp folder) and checks the adapter's entry script
 * and version. Nothing is written outside the temp folder but the pins.
 *
 * `--agent antigravity` checks `packages/adapters/src/setup-antigravity/pins/antigravity-acp.json`
 * instead: every pin is well formed (an https URL on dl.google.com for the
 * pinned version, a SHA-256, the server's file name), then this OS's archive
 * is downloaded into a temp folder, its SHA-256 compared with the pin (the
 * bytes as received, after any transfer encoding, as spike 6.1 hashed them)
 * and the server's file name found in the zip's directory. A platform with no
 * pin checks the file only. Its version is bumped by hand, in a pull request.
 *
 * npm is `npm-cli.js` beside this Node (`--npm <path>` or `$NPM_CLI_JS` to
 * name another). Exits 0 when it succeeds, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, fstatSync, openSync, readSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANTIGRAVITY_PINS = fileURLToPath(new URL('../packages/adapters/src/setup-antigravity/pins/antigravity-acp.json', import.meta.url));
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'];
const PINS_DIR = fileURLToPath(new URL('../packages/adapters/src/setup-claude-code/pins/', import.meta.url));
const ADAPTER = '@agentclientprotocol/claude-agent-acp';
const PROJECT = 'ogden-agents-claude-code';

/** @typedef {{ version?: string, resolved?: string, integrity?: string, link?: boolean, optional?: boolean }} LockEntry */
/** @typedef {{ packages: Record<string, LockEntry> }} Lock */

const args = process.argv.slice(2);
const flag = (/** @type {string} */ name) => args.includes(name);
const valueOf = (/** @type {string} */ name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

/** `npm-cli.js` beside this Node, as the app finds it (`findNpmCli` in `setup-claude-code/install.ts`). */
function findNpmCli() {
  const named = valueOf('--npm') ?? process.env.NPM_CLI_JS;
  if (named !== undefined && named !== '') return named;
  const execs = [process.execPath];
  try {
    execs.push(realpathSync(process.execPath));
  } catch {
    // Keep the path as given.
  }
  for (const exec of execs) {
    const bin = dirname(exec);
    for (const candidate of [join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * This environment without inherited `npm_*` settings, with the cache in `cache`.
 * @param {string} cache
 */
function npmEnv(cache) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.toLowerCase().startsWith('npm_') && value !== undefined) env[name] = value;
  env.npm_config_cache = cache;
  env.npm_config_update_notifier = 'false';
  return env;
}

/**
 * @param {string} npmCli
 * @param {string} cwd
 * @param {string} cache
 * @param {string[]} npmArgs
 */
function npm(npmCli, cwd, cache, npmArgs) {
  const result = spawnSync(process.execPath, [npmCli, ...npmArgs], { cwd, env: npmEnv(cache), stdio: 'inherit', windowsHide: true });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${npmArgs[0]} exited with ${result.status}`);
}

/** Every package entry of a lockfile but the root. */
const entries = (/** @type {Lock} */ lock) => Object.entries(lock.packages ?? {}).filter(([path]) => path !== '');

const REGISTRY = 'https://registry.npmjs.org/';

/**
 * Throws unless every package has its `integrity` and a `resolved` URL on the
 * public registry (review F1): a mirror from whoever ran --update never lands in the pins.
 * @param {Lock} lock
 */
function assertPinned(lock) {
  const bad = entries(lock).filter(
    ([, entry]) => entry.link !== true && (typeof entry.integrity !== 'string' || typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY)),
  );
  if (bad.length > 0) throw new Error(`packages without integrity or not from ${REGISTRY}: ${bad.map(([path]) => path).join(', ')}`);
}

/**
 * @param {string} npmCli
 * @param {string | undefined} version
 */
function update(npmCli, version) {
  if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('--update needs an exact version, such as 0.84.0');
  const work = mkdtempSync(join(tmpdir(), 'ogden-agents-pins-'));
  try {
    const manifest = { name: PROJECT, private: true, description: 'The Claude Agent ACP adapter Ogden Agents installs (scripts/agent-pins.mjs).', dependencies: { [ADAPTER]: version } };
    writeFileSync(join(work, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // Empty npm configs: the lock never picks up this machine's registry, proxy or auth settings.
    const userConfig = join(work, 'user.npmrc');
    const globalConfig = join(work, 'global.npmrc');
    writeFileSync(userConfig, '');
    writeFileSync(globalConfig, '');
    npm(npmCli, work, join(work, '.cache'), [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      `--userconfig=${userConfig}`,
      `--globalconfig=${globalConfig}`,
      `--registry=${REGISTRY}`,
    ]);
    /** @type {Lock} */
    const lock = JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8'));
    assertPinned(lock);
    if (lock.packages[`node_modules/${ADAPTER}`]?.version !== version) throw new Error(`the lockfile does not pin ${ADAPTER} ${version}`);
    mkdirSync(PINS_DIR, { recursive: true });
    writeFileSync(join(PINS_DIR, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(PINS_DIR, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`agent-pins: pinned ${ADAPTER} ${version} (${entries(lock).length} packages)`);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

/**
 * @param {string} npmCli
 * @param {boolean} withBinary
 */
function check(npmCli, withBinary) {
  /** @type {Lock} */
  const lock = JSON.parse(readFileSync(join(PINS_DIR, 'package-lock.json'), 'utf8'));
  const version = lock.packages[`node_modules/${ADAPTER}`]?.version;
  assertPinned(lock);
  const work = mkdtempSync(join(tmpdir(), 'ogden-agents-pins-'));
  try {
    const project = join(work, 'adapter');
    mkdirSync(project);
    for (const file of ['package.json', 'package-lock.json']) writeFileSync(join(project, file), readFileSync(join(PINS_DIR, file)));
    npm(npmCli, project, join(work, 'cache'), [
      'ci',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      ...(withBinary ? [] : ['--omit=optional']),
    ]);
    const root = join(project, 'node_modules', ...ADAPTER.split('/'));
    if (!existsSync(join(root, 'dist', 'index.js'))) throw new Error(`${ADAPTER} has no dist/index.js`);
    const installed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    if (installed !== version) throw new Error(`installed ${installed}, pinned ${version}`);
    if (withBinary) {
      const scope = join(project, 'node_modules', '@anthropic-ai');
      const binaries = existsSync(scope) ? readdirSync(scope).filter((name) => name.startsWith('claude-agent-sdk-')) : [];
      if (binaries.length === 0) throw new Error(`no bundled claude binary package for ${process.platform}-${process.arch}`);
      console.log(`agent-pins: bundled binary ${binaries.join(', ')}`);
    }
    console.log(`agent-pins: ${ADAPTER} ${version} installs${withBinary ? ' with its bundled binary' : ''} on ${process.platform}-${process.arch}`);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

/**
 * Throws naming every malformed pin in the Antigravity pins file.
 * @param {{ version?: unknown, archives?: Record<string, { url?: unknown, sha256?: unknown, binary?: unknown, args?: unknown }> }} pins
 */
function assertAntigravityPins(pins) {
  const problems = [];
  const version = pins.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) problems.push('version is not an exact x.y.z');
  const archives = Object.entries(pins.archives ?? {});
  if (archives.length === 0) problems.push('no archive is pinned');
  for (const [platform, pin] of archives) {
    if (!PLATFORMS.includes(platform)) problems.push(`${platform} is not a platform`);
    if (typeof pin.url !== 'string' || !pin.url.startsWith('https://dl.google.com/') || !pin.url.endsWith('.zip') || !pin.url.includes(`-${version}-`)) {
      problems.push(`${platform}: the URL is not a dl.google.com zip of ${version}`);
    }
    if (typeof pin.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pin.sha256)) problems.push(`${platform}: the SHA-256 is not 64 lower-case hex digits`);
    if (typeof pin.binary !== 'string' || !/^agy_acp_server\.(par|exe)$/.test(pin.binary)) problems.push(`${platform}: the server's file name is not agy_acp_server.par or .exe`);
    if (!Array.isArray(pin.args) || pin.args.some((arg) => typeof arg !== 'string')) problems.push(`${platform}: args is not a list of strings`);
  }
  if (problems.length > 0) throw new Error(`antigravity pins: ${problems.join('; ')}`);
}

/**
 * Whether the zip at `file` lists `name` in its central directory (read from its last 8 MB).
 * @param {string} file
 * @param {string} name
 */
function zipLists(file, name) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, 8 * 1024 * 1024);
    const tail = Buffer.alloc(length);
    readSync(fd, tail, 0, length, size - length);
    // A central directory file header (PK\x01\x02) whose name is `name`, at any depth.
    for (let at = tail.indexOf('PK\x01\x02'); at !== -1; at = tail.indexOf('PK\x01\x02', at + 4)) {
      const nameLength = tail.readUInt16LE(at + 28);
      const entry = tail.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      if (entry === name || entry.endsWith(`/${name}`)) return true;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

async function checkAntigravity() {
  const pins = JSON.parse(readFileSync(ANTIGRAVITY_PINS, 'utf8'));
  assertAntigravityPins(pins);
  const platform = `${process.platform}-${process.arch}`;
  const pin = pins.archives[platform];
  if (pin === undefined) {
    console.log(`agent-pins: antigravity ${pins.version} pins are well formed; no archive is pinned for ${platform}`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), 'ogden-agents-pins-'));
  try {
    const file = join(work, 'archive.zip');
    const response = await fetch(pin.url);
    if (!response.ok || response.body === null) throw new Error(`downloading ${pin.url} answered ${response.status}`);
    const hash = createHash('sha256');
    const body = Readable.fromWeb(response.body);
    body.on('data', (chunk) => hash.update(chunk));
    await pipeline(body, createWriteStream(file));
    const sha256 = hash.digest('hex');
    if (sha256 !== pin.sha256) throw new Error(`the ${platform} archive's SHA-256 is ${sha256}, pinned ${pin.sha256}`);
    if (!zipLists(file, pin.binary)) throw new Error(`the ${platform} archive has no ${pin.binary}`);
    console.log(`agent-pins: antigravity ${pins.version} archive for ${platform} matches its pin and holds ${pin.binary}`);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

try {
  if (valueOf('--agent') === 'antigravity') {
    if (!flag('--check')) throw new Error('usage: agent-pins.mjs --check --agent antigravity');
    await checkAntigravity();
    process.exit(0);
  }
  if (valueOf('--agent') !== undefined && valueOf('--agent') !== 'claude-code') throw new Error(`no pins for the agent ${valueOf('--agent')}`);
  const npmCli = findNpmCli();
  if (npmCli === undefined) throw new Error('npm-cli.js was not found beside this Node; pass --npm <path to npm-cli.js>');
  if (flag('--update')) update(npmCli, valueOf('--update'));
  else if (flag('--check')) check(npmCli, flag('--with-binary'));
  else throw new Error('usage: agent-pins.mjs --update <version> | --check [--with-binary] | --check --agent antigravity');
} catch (error) {
  console.error(`agent-pins: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
