/**
 * `project-commands-node` (AD-38; 8.9) with a real `node` fixture: the
 * child and the grandchild it starts are both gone after Stop and after
 * `close()`; the child's environment is the allowlist plus `CI`,
 * `NO_COLOR` and `FORCE_COLOR`, with no planted key and nothing else of
 * `process.env`; a shell-needing argv never reaches spawn; a missing
 * program says so in plain words; the output keeps its last bytes; a run
 * past its time limit is stopped with `error`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectCommandsNode } from '../src/index.js';
import { plantedProgram, type PlantedProgram } from './planted-program.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-problems-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

/** `node` on a PATH of its own folder only, plus a planted key and a stray variable the child must never see. */
const source = () => ({ PATH: dirname(process.execPath), HOME: tmpdir(), OGDEN_PLANTED_KEY: 'planted-8c1d', ANTHROPIC_API_KEY: 'sk-ant-planted', STRAY_SETTING: 'stray' });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A child that starts a grandchild, writes both pids, then waits forever. */
const TREE = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: {} });
writeFileSync('pids.json', JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
console.log('ready');
setInterval(() => {}, 1000);
`;

async function startTree(runner: ReturnType<typeof createProjectCommandsNode>) {
  const cwd = project({ 'tree.js': TREE });
  const started = runner.start({ cwd, argv: ['node', 'tree.js'] });
  await until(() => existsSync(join(cwd, 'pids.json')) && started.output().text.includes('ready'));
  const pids = JSON.parse(readFileSync(join(cwd, 'pids.json'), 'utf8')) as { child: number; grandchild: number };
  expect(alive(pids.child) && alive(pids.grandchild)).toBe(true);
  return { started, pids };
}

describe('project-commands-node', () => {
  it('kills the child and its grandchild on Stop', async () => {
    const runner = createProjectCommandsNode({ source });
    const { started, pids } = await startTree(runner);
    started.stop();
    expect(await started.done).toEqual({ exitCode: null, stopped: true });
    await until(() => !alive(pids.child) && !alive(pids.grandchild));
    await runner.close();
  });

  it('kills every tree on close, and refuses new starts after it', async () => {
    const runner = createProjectCommandsNode({ source });
    const { started, pids } = await startTree(runner);
    await runner.close();
    expect((await started.done).stopped).toBe(true);
    await until(() => !alive(pids.child) && !alive(pids.grandchild));
    const late = runner.start({ cwd: tmpdir(), argv: ['node', '-e', '1'] });
    expect((await late.done).error).toMatch(/stopping/);
  });

  it('killAll kills every tree synchronously (a crashing server), and refuses new starts', async () => {
    const runner = createProjectCommandsNode({ source });
    const { started, pids } = await startTree(runner);
    runner.killAll!();
    await until(() => !alive(pids.child) && !alive(pids.grandchild));
    expect(await started.done).toEqual({ exitCode: null, stopped: true });
    expect((await runner.start({ cwd: tmpdir(), argv: ['node', '-e', '1'] }).done).error).toMatch(/stopping/);
  });

  it('killAll reports Ogden\'s stop even when the kill ends the command with an exit code (taskkill /F on Windows exits 1)', async () => {
    // Simulates Windows on any platform: the injected kill makes the command exit 1, as `taskkill /T /F` does.
    const runner = createProjectCommandsNode({ source, killTree: (pid) => {
        if (pid !== undefined) process.kill(pid, 'SIGTERM');
      },
    });
    const started = runner.start({ cwd: tmpdir(), argv: ['node', '-e', "process.on('SIGTERM', () => process.exit(1)); console.log('ready'); setInterval(() => {}, 1000)"] });
    await until(() => started.output().text.includes('ready'));
    runner.killAll!();
    expect(await started.done).toEqual({ exitCode: null, stopped: true });
  });

  it('gives the child the allowlist plus CI, NO_COLOR and FORCE_COLOR, never a planted key or process.env', async () => {
    process.env.OGDEN_TEST_PROCESS_ONLY = 'from-process-env';
    try {
      const runner = createProjectCommandsNode({ source });
      const cwd = project({ 'env.js': 'console.log(JSON.stringify(process.env)); process.exitCode = 3;' });
      const started = runner.start({ cwd, argv: ['node', 'env.js'] });
      expect(await started.done).toEqual({ exitCode: 3, stopped: false });
      const env = JSON.parse(started.output().text) as Record<string, string>;
      expect(env).toMatchObject({ CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', PATH: dirname(process.execPath) });
      for (const name of ['OGDEN_PLANTED_KEY', 'ANTHROPIC_API_KEY', 'STRAY_SETTING', 'OGDEN_TEST_PROCESS_ONLY']) expect(env[name], name).toBeUndefined();
      expect(started.output().text).not.toContain('planted');
    } finally {
      delete process.env.OGDEN_TEST_PROCESS_ONLY;
    }
  });

  it('never spawns a shell-needing argv, and says when a program is missing', async () => {
    const spawned: string[] = [];
    const runner = createProjectCommandsNode({ source, onSpawn: (file) => spawned.push(file) });
    for (const argv of [['sh', '-c', 'echo hi'], ['bash'], ['FOO=1', 'node'], ['./x.js'], ['node', 'a\nb'], []]) {
      const started = runner.start({ cwd: tmpdir(), argv });
      const exit = await started.done;
      expect(exit.exitCode, argv.join(' ')).toBeNull();
      expect(exit.error, argv.join(' ')).toBeTruthy();
    }
    expect(spawned).toEqual([]);
    const missing = await runner.start({ cwd: tmpdir(), argv: ['ogden-no-such-program-8c1d', 'x'] }).done;
    expect(missing).toEqual({ exitCode: null, stopped: false, error: "ogden-no-such-program-8c1d wasn't found on this computer. Check that it's installed and on your PATH." });
    // A relative PATH entry is never searched: only the absolute ones.
    const relative = createProjectCommandsNode({ source: () => ({ PATH: `.${process.platform === 'win32' ? ';' : ':'}bin` }) });
    expect((await relative.start({ cwd: tmpdir(), argv: ['node', '-e', '1'] }).done).error).toMatch(/wasn't found/);
    expect(spawned).toEqual([]);
  });

  for (const kind of ['empty', 'relative'] as const) {
    it.skipIf(process.platform === 'win32')(`hands the command only the absolute PATH folders: a bare name it runs is never one planted behind ${kind === 'empty' ? 'an empty' : 'a relative'} entry in the project (8.12)`, async () => {
      const fixture: PlantedProgram = plantedProgram('ogden-tool', 'tool done');
      dirs.push(fixture.root);
      const seen: Array<Readonly<Record<string, string>>> = [];
      const runner = createProjectCommandsNode({ source: () => ({ PATH: fixture.paths[kind], HOME: tmpdir() }), onSpawn: (_file, _args, env) => seen.push(env) });
      const started = runner.start({ cwd: fixture.work, argv: ['ogden-tool'] });
      expect(await started.done).toEqual({ exitCode: 0, stopped: false });
      expect(started.output().text).toContain('tool done');
      expect(seen[0]!.PATH).toBe(fixture.bin);
      expect(fixture.ran()).toBe(false);
    });
  }

  it('keeps the last bytes of the output, and stops a run past its time limit with error', async () => {
    const runner = createProjectCommandsNode({ source, maxOutputBytes: 64 });
    const cwd = project({ 'loud.js': "process.stdout.write('x'.repeat(1000) + '\\nlast line\\n');", 'hang.js': 'setInterval(() => {}, 1000);' });
    const loud = runner.start({ cwd, argv: ['node', 'loud.js'] });
    expect((await loud.done).exitCode).toBe(0);
    const out = loud.output();
    expect(out.truncated).toBe(true);
    expect(Buffer.byteLength(out.text)).toBeLessThanOrEqual(64);
    expect(out.text.endsWith('last line\n')).toBe(true);
    const limited = createProjectCommandsNode({ source, maxRunMs: 300 });
    const hang = await limited.start({ cwd, argv: ['node', 'hang.js'] }).done;
    expect(hang).toEqual({ exitCode: null, stopped: false, error: 'This command ran longer than 30 minutes, so Ogden stopped it.' });
    await runner.close();
  });
});
