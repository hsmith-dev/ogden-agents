#!/usr/bin/env node
/**
 * The pinned Claude Agent ACP adapter Ogden Agents installs (story 9.3):
 * `packages/adapters/src/setup-claude-code/pins/{package.json,package-lock.json}`.
 * Needs the network; the unit and browser tests never run it.
 *
 *   node scripts/agent-pins.mjs --update <version>   regenerate both files for that exact version
 *   node scripts/agent-pins.mjs --check              `npm ci` the pins into a temp folder, as the app does
 *   node scripts/agent-pins.mjs --check --with-binary   the same with the SDK's bundled `claude`
 *
 * `--update` writes an exact version and a lockfile in which every package
 * has its `resolved` URL and `integrity`; bump the pin in a pull request.
 * `--check` runs the app's own install (node + npm-cli.js, `--ignore-scripts`,
 * the npm cache inside the temp folder) and checks the adapter's entry script
 * and version. Nothing is written outside the temp folder but the pins.
 *
 * npm is `npm-cli.js` beside this Node (`--npm <path>` or `$NPM_CLI_JS` to
 * name another). Exits 0 when it succeeds, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

try {
  const npmCli = findNpmCli();
  if (npmCli === undefined) throw new Error('npm-cli.js was not found beside this Node; pass --npm <path to npm-cli.js>');
  if (flag('--update')) update(npmCli, valueOf('--update'));
  else if (flag('--check')) check(npmCli, flag('--with-binary'));
  else throw new Error('usage: agent-pins.mjs --update <version> | --check [--with-binary]');
} catch (error) {
  console.error(`agent-pins: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
