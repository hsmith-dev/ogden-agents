/** Entry of the bundled `ogden-install.mjs`: wires `run` to the real world. */
import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { findNpmCli } from './npm.js';
import { maskSecrets } from '@ogden-agents/shared/release-source';
import { run, type CliDeps } from './cli.js';

/** The environment for child processes: the GitHub token is for asking GitHub only, so npm, its scripts and the launcher never see it. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(OGDEN_AGENTS_GITHUB_TOKEN|GITHUB_TOKEN|GH_TOKEN)$/i.test(key)) delete env[key];
  return env;
}

/** `gh` needs the user's own environment (its config folder, a GH_TOKEN) to say who is signed in. */
function ghEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

const deps: CliDeps = {
  fetch: (url, init) => fetch(url, init),
  env: process.env,
  platform: process.platform,
  home: homedir(),
  out: (line) => console.log(line),
  err: (line) => {
    if (line !== '') console.error(line);
  },
  ghToken: () =>
    new Promise((resolve) => {
      // `gh` is an executable on every OS, so no shell. A missing or signed-out gh is simply "no token".
      execFile('gh', ['auth', 'token'], { timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024, env: ghEnv() }, (error, stdout) => {
        const token = stdout.trim();
        resolve(error === null && token !== '' ? token : undefined);
      });
    }),
  npmInstall: (prefix, tarball) =>
    new Promise((resolve, reject) => {
      const cli = findNpmCli();
      if (cli === undefined) {
        reject(new Error('npm was not found beside Node.js. Reinstall Node.js from https://nodejs.org/en/download, which includes npm.'));
        return;
      }
      const child = spawn(
        process.execPath,
        [cli, 'install', tarball, '--prefix', prefix, '--no-audit', '--no-fund', '--no-update-notifier', '--no-save', '--loglevel=error', '--install-links=false'],
        { cwd: prefix, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...childEnv(), npm_config_update_notifier: 'false' } },
      );
      let output = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => (output = (output + chunk.toString()).slice(-4000)));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm install failed (exit code ${code}):\n${maskSecrets(output)}`))));
    }),
  startLauncher: (launcher, args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [launcher, ...args], { stdio: 'inherit', windowsHide: false, env: childEnv() });
      child.on('error', () => resolve(1));
      child.on('close', (code) => resolve(code ?? 1));
    }),
};

process.exitCode = await run(process.argv.slice(2), deps);
