// The fake Claude Agent ACP adapter for the install tests (story 9.3),
// packed at test time into a local tarball with a lockfile that pins it by
// `integrity`, so `npm ci` installs it offline, exactly as it would the real
// adapter from the registry. Its `dist/index.js` runs the fake ACP agent
// (`../fake-acp-agent.mjs`, by absolute URL), which also answers `--cli`, or
// `agent`, a script that runs it with its switches set (the installed-package
// suite's wrapper, story 9.7: an installed server passes agents only an
// allowlisted environment).
//
//   packFakeAdapter(dir, { agent? })  → { tarball, pins: { packageJson, lock }, version }
//   testNpmCli()          → npm-cli.js to run with `process.execPath`
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(HERE, '..', 'fake-acp-agent.mjs');
const PACKAGE = '@agentclientprotocol/claude-agent-acp';

/**
 * `npm-cli.js` for the tests: beside this Node (as the app looks for it),
 * else the one behind an `npm` on `PATH` (a Node whose folder has no npm,
 * such as one pnpm manages). Throws when there is none.
 * @returns {string}
 */
export function testNpmCli() {
  const beside = (/** @type {string} */ exec) => [join(dirname(exec), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(exec), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const candidates = [...beside(process.execPath)];
  try {
    candidates.push(...beside(realpathSync(process.execPath)));
  } catch {
    // Keep the path as given.
  }
  for (const dir of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const name of process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm']) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      let real = file;
      try {
        real = realpathSync(file);
      } catch {
        // Keep the path as found.
      }
      if (real.endsWith('npm-cli.js')) candidates.push(real);
      candidates.push(...beside(real));
    }
  }
  const found = candidates.find((file) => existsSync(file));
  if (found === undefined) throw new Error('the install tests need npm: no npm-cli.js beside Node or behind an npm on PATH');
  return found;
}

/**
 * Packs the fake adapter into `dir` and returns its tarball and the pins
 * that install it: a `file:` dependency and a v3 lockfile with its sha512.
 * Its `dist/index.js` runs `options.agent` (an absolute path), else the fake agent.
 * @param {string} dir
 * @param {{ npmCli?: string, agent?: string }} [options]
 */
export function packFakeAdapter(dir, options = {}) {
  const npmCli = options.npmCli ?? testNpmCli();
  const source = join(dir, 'fake-adapter');
  mkdirSync(join(source, 'dist'), { recursive: true });
  cpSync(join(HERE, 'package.json'), join(source, 'package.json'));
  writeFileSync(join(source, 'dist', 'index.js'), `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(options.agent ?? FAKE_AGENT).href)});\n`);
  const out = join(dir, 'packed');
  mkdirSync(out, { recursive: true });
  const env = { ...process.env, npm_config_cache: join(dir, 'npm-cache'), npm_config_update_notifier: 'false' };
  const result = spawnSync(process.execPath, [npmCli, 'pack', '--pack-destination', out, '--ignore-scripts', '--silent'], { cwd: source, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`npm pack failed (${result.status}): ${result.stderr}`);
  const name = readdirSync(out).find((file) => file.endsWith('.tgz'));
  if (name === undefined) throw new Error('npm pack wrote no tarball');
  const tarball = join(out, name);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
  // Forward slashes, so the `file:` spec reads the same on Windows.
  const spec = `file:${tarball.replaceAll('\\', '/')}`;
  const packageJson = { name: 'ogden-agents-claude-code', private: true, dependencies: { [PACKAGE]: spec } };
  const lock = {
    name: 'ogden-agents-claude-code',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'ogden-agents-claude-code', dependencies: { [PACKAGE]: spec } },
      [`node_modules/${PACKAGE}`]: { version, resolved: spec, integrity },
    },
  };
  return { tarball, pins: { packageJson, lock }, version, npmCli };
}
