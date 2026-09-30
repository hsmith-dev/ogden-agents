/**
 * Launcher end to end: runs the real `bin/ogden.js` against the assembled
 * `dist/` (the bundled server and web UI; `pnpm test` builds first).
 *
 * The default flow starts a detached background server (story 1.7); these
 * tests stop every server they start through Quit, or kill it if a test failed
 * first. Older and newer servers are played by `fixtures/fake-server.mjs`,
 * which speaks only the launcher handshake.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin', 'ogden.js');
const FAKE_SERVER = join(import.meta.dirname, 'fixtures', 'fake-server.mjs');
const { version: VERSION } = JSON.parse(readFileSync(join(ROOT, 'packages', 'server', 'package.json'), 'utf8')) as { version: string };

const children: ChildProcess[] = [];
const dataDirs: string[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function readPortFile(dataDir: string): { port: number; pid: number; version: string } | undefined {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'server.json'), 'utf8')) as { port: number; pid: number; version: string };
  } catch {
    return undefined;
  }
}

afterEach(async () => {
  const exits = children.splice(0).map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    return exited;
  });
  await Promise.all(exits);
  for (const dir of dataDirs.splice(0)) {
    // A background server a failed test left running.
    const record = readPortFile(dir);
    if (record !== undefined && record.pid !== process.pid && isAlive(record.pid)) {
      try {
        process.kill(record.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      await waitUntil(() => !isAlive(record.pid), 'a leftover server to exit').catch(() => {});
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** A throwaway data folder, so the test never touches the user's real one. */
function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-launcher-'));
  dataDirs.push(dataDir);
  return dataDir;
}

/** Runs the launcher to completion (the background flow exits once the server is up). */
function runLauncher(dataDir: string, args: string[] = ['--no-open', '--port', '0']) {
  const child = spawn(process.execPath, [BIN, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OGDEN_AGENTS_DATA_DIR: dataDir },
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += String(chunk)));
  child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
  return new Promise<{ code: number | null; stdout: string; stderr: string; url: string; launchUrl: string }>((resolve) =>
    // `close`, not `exit`: it fires only once all output has been read.
    child.once('close', (code) =>
      resolve({
        code,
        stdout,
        stderr,
        url: /running at (http:\/\/\S+)/.exec(stdout)?.[1] ?? '',
        launchUrl: /one-time link: (http:\/\/\S+)/.exec(stdout)?.[1] ?? '',
      }),
    ),
  );
}

/**
 * Opens a launch link (`/#c=<code>`) as the page's boot script does: POSTs
 * the code to `/api/v1/tab/exchange` and returns the tab's `Authorization`
 * header, with the token from the response body (never a URL; no cookie).
 */
async function signIn(launchUrl: string): Promise<string> {
  const { origin, hash } = new URL(launchUrl);
  const code = /^#c=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1];
  expect(code).toBeDefined();
  const exchange = await fetch(`${origin}/api/v1/tab/exchange`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  expect(exchange.status).toBe(200);
  expect(exchange.headers.get('set-cookie')).toBeNull();
  const { token } = (await exchange.json()) as { token: string };
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return `Bearer ${token}`;
}

/** Quit, as the UI does it, then waits for the process to exit. */
async function quit(url: string, launchUrl: string, pid: number): Promise<void> {
  const authorization = await signIn(launchUrl);
  const response = await fetch(`${url}/api/v1/server/quit`, { method: 'POST', headers: { authorization, origin: url } });
  expect(response.status).toBe(202);
  await waitUntil(() => !isAlive(pid), 'the server to exit after Quit');
}

/** Starts a fake server of `version` with `busy` busy sessions in `dataDir`. */
async function fakeServer(dataDir: string, version: string, busy: number) {
  const child = spawn(process.execPath, [FAKE_SERVER, dataDir, version, String(busy)], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const port = await new Promise<number>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (chunk) => {
      out += String(chunk);
      const match = /ready (\d+)/.exec(out);
      if (match !== null) resolve(Number(match[1]));
    });
    child.once('exit', (code) => reject(new Error(`fake server exited early (${code})`)));
  });
  return { child, port, pid: child.pid! };
}

describe('bin/ogden.js --foreground', () => {
  it('starts on loopback in this process, prints the URL and launch link, and serves the page through the gate', async () => {
    const dataDir = makeDataDir();
    const child = spawn(process.execPath, [BIN, '--foreground', '--no-open', '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OGDEN_AGENTS_DATA_DIR: dataDir },
    });
    children.push(child);
    let stdout = '';
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    const { url: address, launchUrl } = await new Promise<{ url: string; launchUrl: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no URLs printed; stdout: ${stdout}`)), 10_000);
      child.stdout!.on('data', (chunk) => {
        stdout += String(chunk);
        const url = /running at (http:\/\/\S+)/.exec(stdout)?.[1];
        const link = /one-time link: (http:\/\/\S+)/.exec(stdout)?.[1];
        if (url !== undefined && link !== undefined) {
          clearTimeout(timer);
          resolve({ url, launchUrl: link });
        }
      });
    });
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(launchUrl).toMatch(new RegExp(`^${address.replaceAll('.', '\\.')}/#c=[A-Za-z0-9_-]{43}$`));
    // In this process, not a background one.
    expect(readPortFile(dataDir)?.pid).toBe(child.pid);

    // The app's files load without a token (the page then shows "Open Ogden
    // Agents"); the API needs the tab's token.
    const page = await fetch(address);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');
    expect((await fetch(`${address}/api/v1/tab`)).status).toBe(401);

    const authorization = await signIn(launchUrl);
    expect((await fetch(`${address}/api/v1/tab`, { headers: { authorization } })).status).toBe(204);

    child.kill('SIGTERM');
    const { code, signal } = await exited;
    // On Windows there are no signals: Node terminates the process without
    // running the SIGTERM handler, so `exited` resolving (above) is the check.
    if (process.platform !== 'win32') {
      // POSIX delivers SIGTERM, and the launcher shuts the server down cleanly.
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    }
  });

  it('rejects an invalid --port with exit code 2', async () => {
    const { code } = await runLauncher(makeDataDir(), ['--no-open', '--port', 'abc']);
    expect(code).toBe(2);
  });
});

describe('bin/ogden.js (background)', () => {
  it('cold start: spawns a detached server, prints a working link and exits 0; the server outlives it; a second launch attaches with a fresh link; Quit stops it', async () => {
    const dataDir = makeDataDir();
    const first = await runLauncher(dataDir);
    expect(first.code, first.stderr).toBe(0);
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const record = readPortFile(dataDir)!;
    expect(record.version).toBe(VERSION);
    // The launcher has exited; the server it started is another, still running, process.
    expect(isAlive(record.pid)).toBe(true);
    expect(first.url).toBe(`http://127.0.0.1:${record.port}`);
    expect(existsSync(join(dataDir, 'launcher.token'))).toBe(true);

    const authorization = await signIn(first.launchUrl);
    expect((await fetch(`${first.url}/api/v1/tab`, { headers: { authorization } })).status).toBe(204);
    const page = await fetch(first.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');

    // Attach: no new process, a fresh link that works (the first one is spent,
    // as an expired one would be).
    const second = await runLauncher(dataDir);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain('already running');
    expect(second.url).toBe(first.url);
    expect(second.launchUrl).not.toBe(first.launchUrl);
    expect(readPortFile(dataDir)!.pid).toBe(record.pid);
    const spent = await fetch(`${first.url}/api/v1/tab/exchange`, {
      method: 'POST',
      headers: { origin: first.url, 'content-type': 'application/json' },
      body: JSON.stringify({ code: new URL(first.launchUrl).hash.slice('#c='.length) }),
    });
    expect(spent.status).toBe(401);

    await quit(second.url, second.launchUrl, record.pid);
    expect(existsSync(join(dataDir, 'server.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'launcher.token'))).toBe(false);
    // Its output went to the log in the data folder.
    expect(readFileSync(join(dataDir, 'logs', 'server.log'), 'utf8')).toContain('server stopped');
  });

  it('stale port file (dead pid): removes it and starts a new server', async () => {
    const dataDir = makeDataDir();
    const dead = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => dead.once('exit', resolve));
    writeFileSync(join(dataDir, 'server.json'), JSON.stringify({ port: 1, pid: dead.pid, version: VERSION, startedAt: new Date().toISOString() }));

    const result = await runLauncher(dataDir);
    expect(result.code, result.stderr).toBe(0);
    const record = readPortFile(dataDir)!;
    expect(record.pid).not.toBe(dead.pid);
    expect(isAlive(record.pid)).toBe(true);
    expect(readFileSync(join(dataDir, 'logs', 'launcher.log'), 'utf8')).toContain('removing a stale port file');
    await quit(result.url, result.launchUrl, record.pid);
  });

  it('live pid, failed handshake: reports "not responding" and deletes nothing', async () => {
    const dataDir = makeDataDir();
    // This test process is alive but answers no handshake (a slow or stuck server looks the same).
    const record = JSON.stringify({ port: 1, pid: process.pid, version: VERSION, startedAt: new Date().toISOString() });
    writeFileSync(join(dataDir, 'server.json'), record);
    writeFileSync(join(dataDir, 'launcher.token'), 'token');

    const result = await runLauncher(dataDir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`Ogden Agents (process ${process.pid}) is running but not responding`);
    expect(readFileSync(join(dataDir, 'server.json'), 'utf8')).toBe(record);
    expect(readFileSync(join(dataDir, 'launcher.token'), 'utf8')).toBe('token');
    rmSync(join(dataDir, 'server.json'));
  });

  it('simultaneous launches: one server, and every launcher opens it', async () => {
    const dataDir = makeDataDir();
    const results = await Promise.all([runLauncher(dataDir), runLauncher(dataDir), runLauncher(dataDir)]);
    for (const result of results) expect(result.code, result.stderr).toBe(0);
    const record = readPortFile(dataDir)!;
    for (const result of results) expect(result.url).toBe(`http://127.0.0.1:${record.port}`);
    // Every launcher that spawned a server beyond the winner saw it refuse the
    // data folder's lock and exit (the rest attached without spawning).
    const spawned = results.filter((r) => r.stdout.includes('Starting Ogden Agents')).length;
    expect(spawned).toBeGreaterThanOrEqual(1);
    const refusals = () => (readFileSync(join(dataDir, 'logs', 'server.log'), 'utf8').match(/another server already runs/g) ?? []).length;
    await waitUntil(() => refusals() === spawned - 1, 'the losing servers to exit');
    await quit(results[0]!.url, results[0]!.launchUrl, record.pid);
  });

  it('--foreground beside a background server refuses to start a second one', async () => {
    const dataDir = makeDataDir();
    const background = await runLauncher(dataDir);
    expect(background.code, background.stderr).toBe(0);
    const record = readPortFile(dataDir)!;

    const foreground = await runLauncher(dataDir, ['--foreground', '--no-open', '--port', '0']);
    expect(foreground.code).toBe(1);
    expect(foreground.stderr).toContain(`Ogden Agents is already running (process ${record.pid})`);
    expect(readPortFile(dataDir)!.pid).toBe(record.pid);
    await quit(background.url, background.launchUrl, record.pid);
  });

  it('older server, idle: it stops cleanly and the new version starts and opens', async () => {
    const dataDir = makeDataDir();
    const fake = await fakeServer(dataDir, `${VERSION}-old`, 0);

    const result = await runLauncher(dataDir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Updating Ogden Agents from ${VERSION}-old to ${VERSION}`);
    expect(isAlive(fake.pid)).toBe(false);
    const record = readPortFile(dataDir)!;
    expect(record.version).toBe(VERSION);
    expect(record.pid).not.toBe(fake.pid);
    expect(result.url).toBe(`http://127.0.0.1:${record.port}`);
    await quit(result.url, result.launchUrl, record.pid);
  });

  it('older server, busy: it keeps running, the launcher says the update waits, and opens the running version', async () => {
    const dataDir = makeDataDir();
    const fake = await fakeServer(dataDir, `${VERSION}-old`, 1);

    const result = await runLauncher(dataDir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 session is still working');
    expect(result.stdout).toContain('The update applies when they finish');
    expect(result.url).toBe(`http://127.0.0.1:${fake.port}`);
    expect(result.launchUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${fake.port}/#c=`));
    expect(isAlive(fake.pid)).toBe(true);
    expect(readPortFile(dataDir)!.pid).toBe(fake.pid);
  });

  it('newer server: simply used', async () => {
    const dataDir = makeDataDir();
    const fake = await fakeServer(dataDir, '999.0.0', 0);

    const result = await runLauncher(dataDir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('already running (version 999.0.0)');
    expect(result.url).toBe(`http://127.0.0.1:${fake.port}`);
    expect(isAlive(fake.pid)).toBe(true);
  });
});
