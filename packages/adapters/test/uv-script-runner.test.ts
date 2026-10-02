/**
 * The uv script runner (story 4.1), against a Node stand-in for `uv`
 * (`tests/fixtures/fake-uv.mjs`): only the environment it is given reaches
 * the script, the arguments go as an array, a run past the time limit kills
 * the whole tree, and each failure (no uv, a non-zero exit with the script's
 * `{"error"}`, output that isn't JSON, too much output) is its own error.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUvScriptRunner, ScriptRunError, type UvScriptRunnerOptions } from '../src/index.js';

const FAKE_UV = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-uv.mjs');
const SCRIPT = '/bundled/tickets.py';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-runner-'));
  dirs.push(dir);
  return dir;
}

/** What Windows needs to start any process; nothing else of this process's environment. */
const base = (): Record<string, string> => (process.platform === 'win32' && process.env.SystemRoot !== undefined ? { SystemRoot: process.env.SystemRoot } : {});

function runner(env: Record<string, string>, options: Partial<UvScriptRunnerOptions> = {}) {
  return createUvScriptRunner({
    uvCommand: async () => ({ file: process.execPath, args: [FAKE_UV] }),
    env: () => ({ ...base(), ...env }),
    ...options,
  });
}

const failure = (promise: Promise<unknown>) => promise.then(
  () => {
    throw new Error('expected the run to fail');
  },
  (error: unknown) => error as ScriptRunError,
);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('uv script runner (story 4.1)', () => {
  it('runs `uv run` on the script with its arguments as an array, in cwd, with only the given environment', async () => {
    const cwd = tempDir();
    process.env.OGDEN_AGENTS_RUNNER_SECRET = 'must-not-leak';
    try {
      const out = (await runner({ PYTHONUTF8: '1', FAKE_UV_MODE: 'echo' }).run({ script: SCRIPT, args: ['--project-root', 'a b; rm -rf /', 'status'], cwd })) as {
        argv: string[];
        cwd: string;
        env: Record<string, string>;
      };
      expect(out.argv).toEqual(['run', '--no-project', '--quiet', SCRIPT, '--project-root', 'a b; rm -rf /', 'status']);
      expect(realpathSync(out.cwd)).toBe(realpathSync(cwd));
      expect(out.env.PYTHONUTF8).toBe('1');
      expect(out.env.OGDEN_AGENTS_RUNNER_SECRET).toBeUndefined();
      // Only what was given (and what the OS adds to every process by itself).
      const extra = Object.keys(out.env).filter((name) => !['PYTHONUTF8', 'FAKE_UV_MODE', 'SystemRoot', '__CF_USER_TEXT_ENCODING'].includes(name));
      // libuv adds its required variables to every child it spawns on Windows, whatever env it is given
      // (uv-common/win/process.c `required_vars`: HOMEDRIVE … WINDIR, PATH, TEMP, USERNAME, USERPROFILE included).
      const osAdded = /^(HOMEDRIVE|HOMEPATH|LOGONSERVER|PATH|SYSTEMDRIVE|SYSTEMROOT|TEMP|USERDOMAIN|USERNAME|USERPROFILE|WINDIR)$/i;
      expect(extra.filter((name) => !(process.platform === 'win32' && osAdded.test(name)))).toEqual([]);
    } finally {
      delete process.env.OGDEN_AGENTS_RUNNER_SECRET;
    }
  });

  it('without a uv, fails with uv_missing and starts nothing', async () => {
    const error = await failure(createUvScriptRunner({ uvCommand: async () => undefined, env: () => ({}) }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error).toBeInstanceOf(ScriptRunError);
    expect(error.code).toBe('uv_missing');
  });

  it('a uv that is not there fails with uv_missing', async () => {
    const missing = join(tempDir(), 'no-such-uv');
    const error = await failure(createUvScriptRunner({ uvCommand: async () => ({ file: missing }), env: () => base() }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error.code).toBe('uv_missing');
  });

  it('a non-zero exit fails with the script’s own {"error"} text', async () => {
    const error = await failure(runner({ FAKE_UV_MODE: 'fail' }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error.code).toBe('failed');
    expect(error.exitCode).toBe(1);
    expect(error.scriptError).toBe('no active initiative: set core.active_initiative');
  });

  it('stdout that is not JSON fails with bad_output', async () => {
    const error = await failure(runner({ FAKE_UV_MODE: 'bad' }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error.code).toBe('bad_output');
  });

  it('more output than allowed fails with too_much_output', async () => {
    const error = await failure(runner({ FAKE_UV_MODE: 'big' }, { maxOutputBytes: 64 * 1024 }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error.code).toBe('too_much_output');
  });

  it('past the time limit, kills the whole tree and fails with timeout', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    const started = Date.now();
    const error = await failure(runner({ FAKE_UV_MODE: 'hang', FAKE_UV_PID_FILE: pidFile }, { timeoutMs: 1500 }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error.code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(8000);
    expect(existsSync(pidFile)).toBe(true);
    const pids = JSON.parse(readFileSync(pidFile, 'utf8')) as { uv: number; child: number };
    const deadline = Date.now() + 5000;
    while ((alive(pids.uv) || alive(pids.child)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive(pids.uv)).toBe(false);
    expect(alive(pids.child)).toBe(false);
  }, 20_000);
});
