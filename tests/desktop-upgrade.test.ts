/**
 * Upgrades through the real launcher on the built `dist/` (story 13.6, E13-R5; AD-5), the way the
 * app and the npm route both start a server on the one shared data folder: a 0.2.0 folder is backed
 * up before its migrations and the version is recorded; the same folder opened again makes no
 * second backup; and a folder a newer version migrated is refused with the plain message, the
 * launcher exits without a server, and nothing in the folder changes. The shell mode and the plain
 * npm mode behave the same. Private folders, no real agent or keychain.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDataFolder020 } from './fixtures/data-folder-0.2.0.js';
import { exchange, isAlive, readPortFile, removeDataDir, requestQuit, ROOT, waitUntil } from './support.js';

const BIN = join(ROOT, 'bin', 'ogden.js');
const { version: VERSION } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const NEWER_MESSAGE = 'This data folder was last used by a newer version of Ogden Agents, so this older version will not open it. Update Ogden Agents, then open it again. Nothing was changed.';
const SUITE = { timeout: 60_000 };

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) {
    const record = readPortFile(dir);
    if (record !== undefined && isAlive(record.pid)) {
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

function folder020(): { dataDir: string } {
  const data = createDataFolder020();
  dirs.push(data.dataDir, data.repos.bmad.path, data.repos.plain.path);
  return data;
}

/** Runs `ogden --json --no-open` on `dataDir`, in shell mode or not, to its end or its first line. */
function run(dataDir: string, shell: boolean) {
  const child = spawn(process.execPath, [BIN, '--json', '--no-open', '--port', '0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OGDEN_AGENTS_DATA_DIR: dataDir, OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', OGDEN_AGENTS_OFFLINE: '1', NODE_ENV: 'test', ...(shell ? { OGDEN_AGENTS_SHELL: 'desktop' } : {}) },
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += String(chunk)));
  child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return {
    child,
    exited,
    stderr: () => stderr,
    line: async () => {
      await waitUntil(() => stdout.includes('\n') || child.exitCode !== null, `a JSON line (stderr: ${stderr})`, 45_000);
      return stdout.includes('\n') ? (JSON.parse(stdout.split('\n')[0]!) as { url: string; launchUrl: string; pid: number }) : undefined;
    },
  };
}

const dbFile = (dataDir: string) => join(dataDir, 'ogden-agents.db');
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

async function stop(info: { url: string; launchUrl: string; pid: number }) {
  expect((await requestQuit(info.url, await exchange(info.launchUrl))).status).toBe(202);
  await waitUntil(() => !isAlive(info.pid), 'the server to exit after Quit');
}

describe.each([
  ['the app (shell mode)', true],
  ['the npm route', false],
])('%s on a data folder from an older version', SUITE, (_name, shell) => {
  it('backs the database up before migrating, records the version, and makes no second backup', async () => {
    const { dataDir } = folder020();
    const first = run(dataDir, shell);
    const info = (await first.line())!;
    const backups = join(dataDir, 'backups');
    // 0.2.0 recorded no version, so its backup is "unknown"; it holds the database as 0.2.0 left it.
    expect(readdirSync(backups)).toEqual(['ogden-agents-unknown.db']);
    const copy = new Sqlite(join(backups, 'ogden-agents-unknown.db'), { readonly: true });
    expect((copy.prepare('SELECT count(*) AS n FROM workspaces').get() as { n: number }).n).toBe(2);
    expect((copy.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(4);
    copy.close();
    expect(JSON.parse(readFileSync(join(dataDir, 'last-version.json'), 'utf8'))).toEqual({ version: VERSION });
    await stop(info);
    first.child.stdin!.end();
    await first.exited;

    // The same version again: nothing pending, no new backup.
    const second = run(dataDir, shell);
    const again = (await second.line())!;
    expect(readdirSync(backups)).toEqual(['ogden-agents-unknown.db']);
    await stop(again);
    second.child.stdin!.end();
    await second.exited;
  });

  it('refuses a data folder a newer version migrated, says why, starts no server and changes nothing', async () => {
    const { dataDir } = folder020();
    // A newer version's migration: one this build has never heard of.
    const db = new Sqlite(dbFile(dataDir));
    db.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0', 4102444800000)");
    db.close();
    const before = sha(dbFile(dataDir));

    const attempt = run(dataDir, shell);
    expect(await attempt.exited).toBe(1);
    expect(attempt.stderr().trim()).toBe(NEWER_MESSAGE);
    expect(readPortFile(dataDir)).toBeUndefined();
    expect(sha(dbFile(dataDir))).toBe(before);
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
    expect(existsSync(join(dataDir, 'last-version.json'))).toBe(false);
  });
});
