/**
 * The installed package the global setup started, as the tests see it. The
 * setup runs in Playwright's main process and hands its folders over through
 * the environment; `installed()` rebuilds the install around them, so a test
 * can run the installed launcher again (by its path in the npx install).
 */
import { prepareInstall, type Install } from '../../scripts/installed-package.mjs';

export const ENV = {
  tarball: 'E2E_INSTALLED_TARBALL',
  workDir: 'E2E_INSTALLED_WORK_DIR',
  cacheDir: 'E2E_INSTALLED_CACHE_DIR',
  dataDir: 'E2E_INSTALLED_DATA_DIR',
  url: 'E2E_INSTALLED_URL',
  pid: 'E2E_INSTALLED_PID',
  startOutput: 'E2E_INSTALLED_START_OUTPUT',
} as const;

/** The launcher arguments every run uses: no browser (the test drives its own), any free port. */
export const LAUNCHER_ARGS = ['--no-open', '--port', '0'];

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set; run through \`pnpm e2e:installed\``);
  return value;
}

export interface Installed {
  install: Install;
  /** The server's base URL, `http://127.0.0.1:<port>`. */
  url: string;
  /** The background server's pid, from its `server.json` at start. */
  pid: number;
  dataDir: string;
  /** What the first launcher run (the one that started the server) printed. */
  startOutput: string;
}

export function installed(): Installed {
  const dataDir = env(ENV.dataDir);
  const install = prepareInstall({
    tarball: env(ENV.tarball),
    prefix: 'ogden-agents-e2e',
    reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir },
  });
  return { install, url: env(ENV.url), pid: Number(env(ENV.pid)), dataDir, startOutput: env(ENV.startOutput) };
}
