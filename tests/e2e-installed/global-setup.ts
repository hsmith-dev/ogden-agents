/**
 * Installs the packed tarball with npx in an empty folder (fresh npm cache,
 * temp data folder) and starts it through the installed `ogden` launcher in
 * background mode, as a user does, with the fake agent (story 2.13). It also
 * makes the extra folder the specs' own servers and projects live in. The
 * teardown makes sure no server process is left and removes every folder.
 *
 * As in `scripts/smoke-installed.mjs`, npx's output (npm's per-request `http`
 * log lines included) is streamed as it arrives, so a slow install shows its
 * progress, and an install and start that stall past START_TIMEOUT_MS (a
 * registry stall on a CI runner, most likely) is retried once in fresh
 * folders, with a log line saying so. Any other failure is not retried.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { prepareInstall, withTimeout } from '../../scripts/installed-package.mjs';
import { isAlive, ROOT, waitUntil } from '../support.js';
import { agentEnv, ENV, FAKE_AGENT, killExtraServers, LAUNCHER_ARGS } from './installed.js';

/** Installing into an empty npm cache can be slow on CI runners. */
const START_TIMEOUT_MS = 240_000;

/** Hides one-time launch codes: they are secrets (AD-15), and CI logs are kept. */
const redact = (text: string) => text.replace(/#c=[A-Za-z0-9_-]+/g, '#c=<code>');

/** Prints the launcher's (and npx's) output as it arrives, line by line. */
function echoLines(): (chunk: string) => void {
  let partial = '';
  return (chunk) => {
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) if (line.trim() !== '') console.log(`  | ${redact(line)}`);
  };
}

export default async function globalSetup(_config: FullConfig) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const tarball = resolve(process.env[ENV.tarball] ?? join(ROOT, `ogden-agents-${version}.tgz`));
  if (!existsSync(tarball)) throw new Error(`e2e:installed: tarball not found: ${tarball}\nRun \`pnpm run pack\` first.`);

  const start = () => {
    const next = prepareInstall({ tarball, prefix: 'ogden-agents-e2e', env: agentEnv(FAKE_AGENT) });
    console.log(`e2e:installed: installing ${tarball} with npx in ${next.workDir}`);
    return { install: next, launcher: next.runLauncher(LAUNCHER_ARGS, { echo: echoLines() }) };
  };
  let { install, launcher } = start();
  const extraDir = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-extra-'));
  const removeExtra = () => rmSync(extraDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  let pid: number | undefined;
  try {
    let urls: { url: string };
    try {
      urls = await withTimeout(launcher.urls(), START_TIMEOUT_MS, 'the installed launcher to print its URLs');
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith('timed out'))) throw error;
      console.log(`e2e:installed: RETRY: npx install and start stalled (${error.message}); retrying once in fresh folders`);
      await launcher.stop();
      install.killBackgroundServer();
      install.removeFolders();
      ({ install, launcher } = start());
      urls = await withTimeout(launcher.urls(), START_TIMEOUT_MS, 'the installed launcher to print its URLs (retry)');
    }
    const { url } = urls;
    // Background mode: the launcher exits once the server is up, and the server keeps running.
    await withTimeout(launcher.exited, 15_000, 'the launcher to exit');
    if (launcher.child.exitCode !== 0) throw new Error(`the launcher exited with code ${launcher.child.exitCode}`);
    const record = install.readPortFile();
    if (record === undefined || !isAlive(record.pid)) throw new Error('the background server is not running after the launcher exited');
    pid = record.pid;
    console.log(`e2e:installed: server ${pid} is at ${url}`);

    Object.assign(process.env, {
      [ENV.tarball]: tarball,
      [ENV.workDir]: install.workDir,
      [ENV.cacheDir]: install.cacheDir,
      [ENV.dataDir]: install.dataDir,
      [ENV.url]: url,
      [ENV.pid]: String(pid),
      [ENV.startOutput]: launcher.output(),
      [ENV.extraDir]: extraDir,
    });
  } catch (error) {
    await launcher.stop();
    install.killBackgroundServer();
    install.removeFolders();
    removeExtra();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- launcher output ---\n${redact(launcher.output()) || '(none)'}`);
  }

  return async () => {
    await launcher.stop();
    // The journey ends with Quit; a failed run may leave the server up. Kill it, and make sure it's gone.
    if (install.killBackgroundServer()) console.warn(`e2e:installed: the server (${pid}) was still running at the end; killed it`);
    if (pid !== undefined) await waitUntil(() => !isAlive(pid), `server ${pid} to exit`).catch(() => {});
    // The specs stop their own servers; one a failed spec left is killed here.
    const leftover = killExtraServers(extraDir);
    if (leftover.length > 0) console.warn(`e2e:installed: a spec's server (${leftover.join(', ')}) was still running at the end; killed it`);
    for (const extra of leftover) await waitUntil(() => !isAlive(extra), `server ${extra} to exit`).catch(() => {});
    install.removeFolders();
    try {
      removeExtra();
    } catch {
      // Reported below.
    }
    const problems = [
      ...[pid, ...leftover].filter((p) => p !== undefined && isAlive(p)).map((p) => `server process ${p} is still running`),
      ...[install.workDir, install.cacheDir, install.dataDir, extraDir].filter((dir) => existsSync(dir)).map((dir) => `${dir} was not removed`),
    ];
    if (problems.length > 0) throw new Error(`e2e:installed cleanup: ${problems.join('; ')}`);
  };
}
