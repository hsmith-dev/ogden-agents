/**
 * The uv script runner (story 4.1; story 4.2 adds streaming and close),
 * against a Node stand-in for `uv` (`tests/fixtures/fake-uv.mjs`): only the
 * environment it is given reaches the script, the arguments go as an array,
 * a run past the time limit kills the whole tree, and each failure (no uv, a
 * non-zero exit with the script's `{"error"}`, output that isn't JSON, too
 * much output) is its own error. Lines stream as they arrive; `close()`
 * kills every tree in flight. The version probe and a script run get the
 * same allowlisted environment, with no planted secret, on every OS.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUvScriptRunner, runVersion, ScriptRunError, uvEnvironment, type ScriptStream, type UvScriptRunnerOptions } from '../src/index.js';

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

  // The fake's `hang` mode stands for a `tickets.py` read that never answers (a project's config code
  // that blocks, say): it starts a child of its own, so the test proves the whole tree goes.
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

describe('uv script runner: streaming and close (story 4.2)', () => {
  it('streams each line of stdout and stderr as it arrives, and still answers the JSON', async () => {
    const lines: Array<[ScriptStream, string]> = [];
    const out = await runner({ FAKE_UV_MODE: 'lines' }).run({ script: SCRIPT, args: [], cwd: tempDir(), onLine: (stream, line) => lines.push([stream, line]) });
    expect(out).toEqual({ done: true });
    expect(lines.filter(([stream]) => stream === 'stderr')).toEqual([
      ['stderr', 'step checking'],
      ['stderr', 'step copying_skills'],
      ['stderr', 'step verifying'],
    ]);
    // The last line, without a line break, is told when the stream ends.
    expect(lines.filter(([stream]) => stream === 'stdout')).toEqual([
      ['stdout', '{"done":'],
      ['stdout', ' true}'],
    ]);
  });

  it('a listener that throws changes nothing', async () => {
    const out = await runner({ FAKE_UV_MODE: 'lines' }).run({
      script: SCRIPT,
      args: [],
      cwd: tempDir(),
      onLine: () => {
        throw new Error('listener failed');
      },
    });
    expect(out).toEqual({ done: true });
  });

  it('exit 2 (the store’s refusal) is failed with its exit code and text', async () => {
    const error = await failure(runner({ FAKE_UV_MODE: 'refuse' }).run({ script: SCRIPT, args: [], cwd: tempDir() }));
    expect(error.code).toBe('failed');
    expect(error.exitCode).toBe(2);
    expect(error.scriptError).toMatch(/^store is linear/);
  });

  it('close() kills every tree in flight (a tickets.py read that never answers) and refuses later runs', async () => {
    const pidFile = join(tempDir(), 'pids.json');
    const uv = runner({ FAKE_UV_MODE: 'hang', FAKE_UV_PID_FILE: pidFile }, { timeoutMs: 60_000 });
    const pending = failure(uv.run({ script: SCRIPT, args: [], cwd: tempDir() }));
    const deadline = Date.now() + 5000;
    while (!existsSync(pidFile) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(existsSync(pidFile)).toBe(true);
    const started = Date.now();
    await uv.close();
    expect((await pending).code).toBe('closed');
    expect(Date.now() - started).toBeLessThan(8000);
    const pids = JSON.parse(readFileSync(pidFile, 'utf8')) as { uv: number; child: number };
    const gone = Date.now() + 5000;
    while ((alive(pids.uv) || alive(pids.child)) && Date.now() < gone) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive(pids.uv)).toBe(false);
    expect(alive(pids.child)).toBe(false);
    expect((await failure(uv.run({ script: SCRIPT, args: [], cwd: tempDir() }))).code).toBe('closed');
    // Safe to call again.
    await uv.close();
  }, 20_000);
});

describe('one allowlist for every uv child (story 4.2)', () => {
  it('the version probe and a script run get the identical environment, with no planted secret', async () => {
    const envFile = join(tempDir(), 'env.jsonl');
    const planted = {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ant-planted',
      GITHUB_TOKEN: 'ghp_planted',
      OGDEN_AGENTS_PLANTED: 'planted',
      NODE_OPTIONS: '--planted',
    };
    // The server's one function: the allowlist of its environment, plus the test-only additions (`extraUvEnv`).
    const childEnv = () => ({ ...uvEnvironment(planted), FAKE_UV_ENV_FILE: envFile });
    const command = { file: process.execPath, args: [FAKE_UV] };
    expect(await runVersion(command, childEnv())).toMatch(/^uv 0\.12\.21/);
    await createUvScriptRunner({ uvCommand: async () => command, env: childEnv }).run({ script: SCRIPT, args: [], cwd: tempDir() });
    const [probe, script] = readFileSync(envFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { mode: string; env: Record<string, string> });
    expect(probe!.mode).toBe('version');
    expect(script!.mode).toBe('echo');
    expect(script!.env).toEqual(probe!.env);
    const text = JSON.stringify(probe!.env);
    for (const secret of ['sk-ant-planted', 'ghp_planted', 'planted']) expect(text).not.toContain(secret);
    for (const name of Object.keys(probe!.env)) expect(name).not.toMatch(/^(ANTHROPIC_API_KEY|GITHUB_TOKEN|OGDEN_AGENTS_|NODE_OPTIONS)/i);
    expect(probe!.env.PYTHONUTF8).toBe('1');
  });
});
