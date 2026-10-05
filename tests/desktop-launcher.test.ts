/**
 * The launcher's `--json` mode, as the desktop app's shell runs it (story 13.3, E13-R4): the real
 * `bin/ogden.js` on the built `dist/`, a private data folder and no real agent. One JSON line and
 * nothing else; a server the launcher started stays tied to it by a pipe, so it exits when the shell
 * (here, the test's stdin) goes away; a server that was already running is attached to, never held.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codeOfLink, exchange, isAlive, makeDataDir, postCode, readPortFile, removeDataDir, requestQuit, ROOT, waitUntil } from './support.js';

const BIN = join(ROOT, 'bin', 'ogden.js');
const SUITE = { timeout: 60_000 };
const children: ChildProcess[] = [];
const dataDirs: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dataDirs.splice(0)) {
    const record = readPortFile(dir);
    if (record !== undefined && record.pid !== process.pid && isAlive(record.pid)) {
      try {
        process.kill(record.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      await waitUntil(() => !isAlive(record.pid), 'a leftover server to exit').catch(() => {});
    }
    removeDataDir(dir);
  }
});

interface JsonLine {
  action: string;
  owned: boolean;
  port: number;
  pid: number;
  version: string;
  url: string;
  launchUrl: string;
  dataDir: string;
}

/** Runs `ogden --json --no-open --port 0` as the shell does: stdin a pipe the test holds. */
function runJson(dataDir: string, shell: boolean) {
  const child = spawn(process.execPath, [BIN, '--json', '--no-open', '--port', '0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OGDEN_AGENTS_DATA_DIR: dataDir,
      OGDEN_AGENTS_TEST_SECRET_STORE: 'memory',
      NODE_ENV: 'test',
      ...(shell ? { OGDEN_AGENTS_SHELL: 'desktop' } : {}),
    },
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += String(chunk)));
  child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  const line = async (): Promise<JsonLine> => {
    await waitUntil(() => stdout.includes('\n') || child.exitCode !== null, `the JSON line (stderr: ${stderr})`, 45_000);
    return JSON.parse(stdout.split('\n')[0]!) as JsonLine;
  };
  return { child, line, exited, output: () => stdout };
}

describe('bin/ogden.js --json (the desktop shell)', SUITE, () => {
  it('prints one JSON line and nothing else, holds the server it started, and the server follows the launcher out', async () => {
    const dataDir = makeDataDir('ogden-agents-desktop-');
    dataDirs.push(dataDir);
    const run = runJson(dataDir, true);
    const info = await run.line();
    expect(info).toMatchObject({ action: 'started', owned: true, dataDir, url: `http://127.0.0.1:${info.port}` });
    expect(Object.keys(info).sort()).toEqual(['action', 'dataDir', 'launchUrl', 'owned', 'pid', 'port', 'url', 'version']);
    // Nothing but that line.
    expect(run.output().trim().split('\n')).toHaveLength(1);
    // The link works once.
    expect((await postCode(info.url, codeOfLink(info.launchUrl))).status).toBe(200);
    expect((await postCode(info.url, codeOfLink(info.launchUrl))).status).toBe(401);

    // The launcher stays alive while the shell (this test) holds its stdin; the server runs.
    expect(run.child.exitCode).toBeNull();
    expect(isAlive(info.pid)).toBe(true);

    // The shell goes away: the launcher exits, and the server it held exits with it.
    run.child.stdin!.end();
    expect(await run.exited).toBe(0);
    await waitUntil(() => !isAlive(info.pid), 'the held server to exit with its launcher');
  });

  it('exits when the held server quits', async () => {
    const dataDir = makeDataDir('ogden-agents-desktop-');
    dataDirs.push(dataDir);
    const run = runJson(dataDir, true);
    const info = await run.line();
    expect((await requestQuit(info.url, await exchange(info.launchUrl))).status).toBe(202);
    await waitUntil(() => !isAlive(info.pid), 'the server to exit after Quit');
    expect(await run.exited).toBe(0);
  });

  it('attaches to a running server without holding it: owned is false and the server outlives the launcher', async () => {
    const dataDir = makeDataDir('ogden-agents-desktop-');
    dataDirs.push(dataDir);
    const first = runJson(dataDir, true);
    const started = await first.line();

    const second = runJson(dataDir, true);
    const attached = await second.line();
    expect(attached).toMatchObject({ action: 'attached', owned: false, pid: started.pid, port: started.port });
    expect(await second.exited).toBe(0);
    expect(isAlive(started.pid)).toBe(true);

    first.child.stdin!.end();
    await first.exited;
  });

  it('without shell mode, the npm route: the server is not tied to the launcher and keeps running', async () => {
    const dataDir = makeDataDir('ogden-agents-desktop-');
    dataDirs.push(dataDir);
    const run = runJson(dataDir, false);
    const info = await run.line();
    expect(info.owned).toBe(false);
    expect(await run.exited).toBe(0);
    expect(isAlive(info.pid)).toBe(true);
    expect((await requestQuit(info.url, await exchange(info.launchUrl))).status).toBe(202);
  });
});
