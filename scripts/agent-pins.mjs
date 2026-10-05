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
 *   node scripts/agent-pins.mjs --agent codex --update 2.1.1   Codex's adapter pins (epic 12 entry 4), and `--check --with-binary` for its CLI binary
 *   node scripts/agent-pins.mjs --agent grok --update 1.0.49   Grok's package pins (epic 12 entry 4); `--check --with-binary` also decompresses this OS's binary and checks its SHA-256
 *   node scripts/agent-pins.mjs --check --agent local   The Local model's pinned OpenCode (and Windows' ripgrep): epic 14 story 14.2
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
 * is downloaded (`download-sha256.mjs`: streamed, retried) and its SHA-256
 * compared with the pin (the bytes as received, after any transfer encoding,
 * as spike 6.1 hashed them). A platform with no
 * pin checks the file only. Its version is bumped by hand, in a pull request.
 *
 * npm is `npm-cli.js` beside this Node (`--npm <path>` or `$NPM_CLI_JS` to
 * name another). Exits 0 when it succeeds, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { sha256WithRetry } from './download-sha256.mjs';

const LOCAL_PINS = fileURLToPath(new URL('../packages/adapters/src/setup-local/pins/opencode.json', import.meta.url));
const ANTIGRAVITY_PINS = fileURLToPath(new URL('../packages/adapters/src/setup-antigravity/pins/antigravity-acp.json', import.meta.url));
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'];

/**
 * The npm-pinned agents (`--agent <id>`, Claude Code by default): where the pins are, the adapter package, and what
 * `--check --with-binary` looks for (the package scope of its bundled binary, and the file in the adapter that proves an install).
 * Codex's pins fix `@openai/codex` itself beside the adapter (the adapter's `^0.159.1` range would float).
 */
/** @type {Record<string, { pinsDir: string, adapter: string, project: string, description: string, extra: Record<string, string>, binaryScope: string, binaryPrefix: string, entry?: string }>} */
const NPM_AGENTS = {
  'claude-code': {
    pinsDir: fileURLToPath(new URL('../packages/adapters/src/setup-claude-code/pins/', import.meta.url)),
    adapter: '@agentclientprotocol/claude-agent-acp',
    project: 'ogden-agents-claude-code',
    description: 'The Claude Agent ACP adapter Ogden Agents installs (scripts/agent-pins.mjs).',
    extra: {},
    binaryScope: '@anthropic-ai',
    binaryPrefix: 'claude-agent-sdk-',
  },
  codex: {
    pinsDir: fileURLToPath(new URL('../packages/adapters/src/setup-codex/pins/', import.meta.url)),
    adapter: '@agentclientprotocol/codex-acp',
    project: 'ogden-agents-codex',
    description: 'The Codex ACP adapter and the Codex CLI it bundles, which Ogden Agents installs (scripts/agent-pins.mjs --agent codex).',
    // `--update <version>` pins the adapter; the Codex CLI it runs is pinned exactly too (the registry's version, spike 12.1).
    extra: { '@openai/codex': '0.159.3' },
    binaryScope: '@openai',
    binaryPrefix: 'codex-',
  },
  grok: {
    pinsDir: fileURLToPath(new URL('../packages/adapters/src/setup-grok/pins/', import.meta.url)),
    adapter: '@xai-official/grok',
    project: 'ogden-agents-grok',
    description: 'Grok Build and its platform binary packages, which Ogden Agents installs (scripts/agent-pins.mjs --agent grok).',
    extra: {},
    binaryScope: '@xai-official',
    binaryPrefix: 'grok-',
    // The package's own launcher (`bin/grok`) proves the install; it is never run. The binary is checked by Ogden itself (`binarySha256`).
    entry: 'bin/grok',
  },
};

/** @typedef {{ version?: string, resolved?: string, integrity?: string, link?: boolean, optional?: boolean }} LockEntry */
/** @typedef {{ packages: Record<string, LockEntry> }} Lock */

const args = process.argv.slice(2);
const flag = (/** @type {string} */ name) => args.includes(name);
const valueOf = (/** @type {string} */ name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const agentArg = valueOf('--agent');
if (flag('--agent') && (agentArg === undefined || agentArg.startsWith('--'))) {
  console.error('agent-pins: --agent needs an agent id');
  process.exit(1);
}
const agentId = agentArg ?? 'claude-code';
/** The agent's pins (an unknown id is refused before any use, below). */
const AGENT = /** @type {NonNullable<(typeof NPM_AGENTS)[string]>} */ (NPM_AGENTS[agentId] ?? NPM_AGENTS['claude-code']);
const PINS_DIR = AGENT.pinsDir;
const ADAPTER = AGENT.adapter;
const PROJECT = AGENT.project;

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
    const manifest = { name: PROJECT, private: true, description: AGENT.description, dependencies: { [ADAPTER]: version, ...AGENT.extra } };
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
    for (const [name, pinned] of Object.entries(AGENT.extra)) {
      if (lock.packages[`node_modules/${name}`]?.version !== pinned) throw new Error(`the lockfile does not pin ${name} ${pinned}`);
    }
    mkdirSync(PINS_DIR, { recursive: true });
    writeFileSync(join(PINS_DIR, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(PINS_DIR, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`agent-pins: pinned ${ADAPTER} ${version} (${entries(lock).length} packages)`);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

/**
 * Grok's binary (epic 12 entry 4): this OS's platform package carries it brotli compressed. It is decompressed
 * as the app does and its SHA-256 compared with the pin in `acp-grok/constants.ts` (xAI publishes none).
 * @param {string} project
 */
function checkGrokBinary(project) {
  const platform = `${process.platform}-${process.arch}`;
  const constants = readFileSync(fileURLToPath(new URL('../packages/adapters/src/acp-grok/constants.ts', import.meta.url)), 'utf8');
  const pinned = new RegExp(`'${platform}': '([0-9a-f]{64})'`).exec(constants)?.[1];
  if (pinned === undefined) throw new Error(`no binary SHA-256 is pinned for ${platform}`);
  const name = process.platform === 'win32' ? 'grok.exe.br' : 'grok.br';
  const compressed = join(project, 'node_modules', '@xai-official', `grok-${platform}`, 'bin', name);
  const hash = createHash('sha256');
  hash.update(brotliDecompressSync(readFileSync(compressed), { maxOutputLength: 400 * 1024 * 1024 }));
  const actual = hash.digest('hex');
  if (actual !== pinned) throw new Error(`the ${platform} binary's SHA-256 is ${actual}, pinned ${pinned}`);
  console.log(`agent-pins: the ${platform} binary matches its pinned SHA-256`);
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
    const entry = AGENT.entry ?? 'dist/index.js';
    if (!existsSync(join(root, ...entry.split('/')))) throw new Error(`${ADAPTER} has no ${entry}`);
    const installed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    if (installed !== version) throw new Error(`installed ${installed}, pinned ${version}`);
    if (withBinary) {
      const scope = join(project, 'node_modules', AGENT.binaryScope);
      const binaries = existsSync(scope) ? readdirSync(scope).filter((name) => name.startsWith(AGENT.binaryPrefix)) : [];
      if (binaries.length === 0) throw new Error(`no bundled binary package for ${process.platform}-${process.arch}`);
      console.log(`agent-pins: bundled binary ${binaries.join(', ')}`);
      if (agentId === 'grok') checkGrokBinary(project);
    }
    console.log(`agent-pins: ${ADAPTER} ${version} installs${withBinary ? ' with its bundled binary' : ''} on ${process.platform}-${process.arch}`);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

/**
 * Throws naming every malformed pin in the Antigravity pins file.
 * @param {{ version?: unknown, archives?: Record<string, { url?: unknown, sha256?: unknown, size?: unknown, binary?: unknown, args?: unknown, files?: Record<string, { size?: unknown, sha256?: unknown }> }> }} pins
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
    // Epic 6 entry 7: the archive's identity size (a download never takes more) and each file it holds, the only entries Install unpacks.
    if (typeof pin.size !== 'number' || !Number.isSafeInteger(pin.size) || pin.size <= 0) problems.push(`${platform}: size is not a positive whole number of bytes`);
    const files = Object.entries(pin.files ?? {});
    if (files.length === 0) problems.push(`${platform}: no file is pinned`);
    if (typeof pin.binary === 'string' && !files.some(([name]) => name === pin.binary)) problems.push(`${platform}: the server is not among its pinned files`);
    for (const [name, file] of files) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') problems.push(`${platform}: ${name} is not a plain file name`);
      if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) problems.push(`${platform}: ${name}'s size is not a whole number of bytes`);
      if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) problems.push(`${platform}: ${name}'s SHA-256 is not 64 lower-case hex digits`);
    }
  }
  if (problems.length > 0) throw new Error(`antigravity pins: ${problems.join('; ')}`);
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
  // Hashed as it streams in, never written to disk; retried with back-off (the shared download).
  const { sha256, size } = await sha256WithRetry(pin.url, `agent-pins: antigravity ${platform}`);
  if (sha256 !== pin.sha256) throw new Error(`the ${platform} archive's SHA-256 is ${sha256}, pinned ${pin.sha256}`);
  if (size !== pin.size) throw new Error(`the ${platform} archive is ${size} bytes, pinned ${pin.size}`);
  console.log(`agent-pins: antigravity ${pins.version} archive for ${platform} matches its pin (${Math.round(size / 1024 / 1024)} MB)`);
}

/**
 * Throws naming every malformed pin in the Local model's pins file (`pins/opencode.json`).
 * @param {{ version?: unknown, archives?: Record<string, any>, ripgrep?: { version?: unknown, archives?: Record<string, any> } }} pins
 */
function assertLocalPins(pins) {
  const problems = [];
  const version = pins.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) problems.push('version is not an exact x.y.z');
  const archives = Object.entries(pins.archives ?? {});
  for (const platform of PLATFORMS) if (pins.archives?.[platform] === undefined) problems.push(`${platform} has no pin`);
  const sha = /^[0-9a-f]{64}$/;
  for (const [platform, pin] of archives) {
    if (!PLATFORMS.includes(platform)) problems.push(`${platform} is not a platform`);
    const format = platform.startsWith('linux') ? 'tar.gz' : 'zip';
    const binary = platform.startsWith('win32') ? 'opencode.exe' : 'opencode';
    const expectedUrl = `https://github.com/anomalyco/opencode/releases/download/v${version}/opencode-${platform.replace('win32', 'windows')}.${format}`;
    if (pin.url !== expectedUrl) problems.push(`${platform}: the URL is not ${expectedUrl}`);
    if (typeof pin.sha256 !== 'string' || !sha.test(pin.sha256)) problems.push(`${platform}: the SHA-256 is not 64 lower-case hex digits`);
    if (!Number.isSafeInteger(pin.size) || pin.size <= 0) problems.push(`${platform}: size is not a positive whole number of bytes`);
    if (pin.format !== format) problems.push(`${platform}: format is not ${format}`);
    if (pin.binary !== binary) problems.push(`${platform}: the binary is not ${binary}`);
    if (JSON.stringify(pin.args) !== '["acp"]') problems.push(`${platform}: args is not ["acp"]`);
    const files = Object.entries(pin.files ?? {});
    if (files.length !== 1 || files[0]?.[0] !== binary) problems.push(`${platform}: the only pinned file must be ${binary}`);
    for (const [name, file] of files) {
      if (!Number.isSafeInteger(file.size) || file.size <= 0) problems.push(`${platform}: ${name}'s size is not a whole number of bytes`);
      if (typeof file.sha256 !== 'string' || !sha.test(file.sha256)) problems.push(`${platform}: ${name}'s SHA-256 is not 64 lower-case hex digits`);
    }
  }
  const rg = pins.ripgrep ?? { version: undefined, archives: {} };
  if (typeof rg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(rg.version)) problems.push('ripgrep: version is not an exact x.y.z');
  for (const platform of ['win32-x64', 'win32-arm64']) {
    const pin = rg.archives?.[platform];
    if (pin === undefined) {
      problems.push(`ripgrep: ${platform} has no pin`);
      continue;
    }
    if (typeof pin.url !== 'string' || !pin.url.startsWith(`https://github.com/BurntSushi/ripgrep/releases/download/${rg.version}/ripgrep-${rg.version}-`) || !pin.url.endsWith('.zip')) problems.push(`ripgrep ${platform}: the URL is not a ripgrep ${rg.version} zip`);
    if (!sha.test(pin.sha256 ?? '') || !sha.test(pin.file?.sha256 ?? '')) problems.push(`ripgrep ${platform}: a SHA-256 is not 64 lower-case hex digits`);
    if (!Number.isSafeInteger(pin.size) || !Number.isSafeInteger(pin.file?.size)) problems.push(`ripgrep ${platform}: a size is not a whole number`);
    if (typeof pin.member !== 'string' || !pin.member.endsWith('/rg.exe')) problems.push(`ripgrep ${platform}: the member is not .../rg.exe`);
  }
  if (Object.keys(rg.archives ?? {}).some((platform) => !platform.startsWith('win32'))) problems.push('ripgrep is pinned for Windows only');
  if (problems.length > 0) throw new Error(`local pins: ${problems.join('; ')}`);
}

async function checkLocal() {
  const pins = JSON.parse(readFileSync(LOCAL_PINS, 'utf8'));
  assertLocalPins(pins);
  // The ACP registry's own record of OpenCode: every pinned URL and SHA-256 must be what it says (a bump is a reviewed change).
  const registryUrl = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
  const registry = await (await fetch(registryUrl, { signal: AbortSignal.timeout(60_000) })).json();
  const entry = registry.agents?.find((/** @type {{ id?: string }} */ agent) => agent.id === 'opencode');
  if (entry === undefined) throw new Error('the ACP registry no longer lists opencode');
  if (entry.version !== pins.version) {
    // The registry moved on: the pins are still checked against their own release, and the drift is only reported.
    console.log(`agent-pins: the ACP registry lists opencode ${entry.version}; Ogden Agents pins ${pins.version} (a bump is a reviewed change)`);
  } else {
    /** @type {Record<string, string>} */
    const names = { 'darwin-arm64': 'darwin-aarch64', 'darwin-x64': 'darwin-x86_64', 'linux-arm64': 'linux-aarch64', 'linux-x64': 'linux-x86_64', 'win32-arm64': 'windows-aarch64', 'win32-x64': 'windows-x86_64' };
    for (const [platform, pin] of Object.entries(pins.archives)) {
      const listed = entry.distribution?.binary?.[names[platform] ?? ''];
      if (listed === undefined || listed.archive !== pin.url || listed.sha256 !== pin.sha256) throw new Error(`${platform}: the pin is not the ACP registry's (${listed?.sha256 ?? 'none'})`);
    }
  }
  const platform = `${process.platform}-${process.arch}`;
  const pin = pins.archives[platform];
  if (pin === undefined) {
    console.log(`agent-pins: local ${pins.version} pins are well formed; no archive is pinned for ${platform}`);
    return;
  }
  const { sha256, size } = await sha256WithRetry(pin.url, `agent-pins: local ${platform}`);
  if (sha256 !== pin.sha256) throw new Error(`the ${platform} archive's SHA-256 is ${sha256}, pinned ${pin.sha256}`);
  if (size !== pin.size) throw new Error(`the ${platform} archive is ${size} bytes, pinned ${pin.size}`);
  console.log(`agent-pins: local ${pins.version} archive for ${platform} matches its pin (${Math.round(size / 1024 / 1024)} MB)`);
  const rg = pins.ripgrep.archives[platform];
  if (rg !== undefined) {
    const found = await sha256WithRetry(rg.url, `agent-pins: ripgrep ${platform}`);
    if (found.sha256 !== rg.sha256 || found.size !== rg.size) throw new Error(`the ripgrep archive for ${platform} is ${found.sha256} (${found.size} bytes), pinned ${rg.sha256} (${rg.size})`);
    console.log(`agent-pins: ripgrep ${pins.ripgrep.version} archive for ${platform} matches its pin`);
  }
}

try {
  if (valueOf('--agent') === 'local') {
    if (!flag('--check')) throw new Error('usage: agent-pins.mjs --check --agent local');
    await checkLocal();
    process.exit(0);
  }
  if (valueOf('--agent') === 'antigravity') {
    if (!flag('--check')) throw new Error('usage: agent-pins.mjs --check --agent antigravity');
    await checkAntigravity();
    process.exit(0);
  }
  if (!Object.hasOwn(NPM_AGENTS, agentId)) throw new Error(`no pins for the agent ${agentId}`);
  const npmCli = findNpmCli();
  if (npmCli === undefined) throw new Error('npm-cli.js was not found beside this Node; pass --npm <path to npm-cli.js>');
  if (flag('--update')) update(npmCli, valueOf('--update'));
  else if (flag('--check')) check(npmCli, flag('--with-binary'));
  else throw new Error('usage: agent-pins.mjs [--agent claude-code|codex|grok] --update <version> | --check [--with-binary] | --check --agent antigravity | --check --agent local');
} catch (error) {
  console.error(`agent-pins: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
