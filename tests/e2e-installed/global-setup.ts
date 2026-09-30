/**
 * Installs the packed tarball with npx in an empty folder (fresh npm cache,
 * temp data folder) and starts it through the installed `ogden` launcher in
 * background mode, as a user does. The teardown makes sure no server process
 * is left and removes every folder.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { prepareInstall, withTimeout } from '../../scripts/installed-package.mjs';
import { isAlive, ROOT, waitUntil } from '../support.js';
import { ENV, LAUNCHER_ARGS } from './installed.js';

/** Installing into an empty npm cache can be slow on CI runners. */
const START_TIMEOUT_MS = 240_000;

export default async function globalSetup(_config: FullConfig) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const tarball = resolve(process.env[ENV.tarball] ?? join(ROOT, `ogden-agents-${version}.tgz`));
  if (!existsSync(tarball)) throw new Error(`e2e:installed: tarball not found: ${tarball}\nRun \`pnpm run pack\` first.`);

  const install = prepareInstall({ tarball, prefix: 'ogden-agents-e2e' });
  const launcher = install.runLauncher(LAUNCHER_ARGS);
  let pid: number | undefined;
  try {
    console.log(`e2e:installed: installing ${tarball} with npx in ${install.workDir}`);
    const { url } = await withTimeout(launcher.urls(), START_TIMEOUT_MS, 'the installed launcher to print its URLs');
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
    });
  } catch (error) {
    await launcher.stop();
    install.killBackgroundServer();
    install.removeFolders();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- launcher output ---\n${launcher.output() || '(none)'}`);
  }

  return async () => {
    await launcher.stop();
    // The journey ends with Quit; a failed run may leave the server up. Kill it, and make sure it's gone.
    if (install.killBackgroundServer()) console.warn(`e2e:installed: the server (${pid}) was still running at the end; killed it`);
    if (pid !== undefined) await waitUntil(() => !isAlive(pid), `server ${pid} to exit`).catch(() => {});
    install.removeFolders();
    const problems = [
      ...(pid !== undefined && isAlive(pid) ? [`server process ${pid} is still running`] : []),
      ...[install.workDir, install.cacheDir, install.dataDir].filter((dir) => existsSync(dir)).map((dir) => `${dir} was not removed`),
    ];
    if (problems.length > 0) throw new Error(`e2e:installed cleanup: ${problems.join('; ')}`);
  };
}
