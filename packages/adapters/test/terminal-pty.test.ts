/**
 * The agent's own terminal (story 3.1): which `claude` a session's terminal
 * runs and with what arguments, core's `TerminalPort` over `terminal-pty`
 * when `node-pty` can't load (AD-19), and the real `node-pty` running the
 * fake CLI (`tests/fixtures/fake-claude-cli.mjs`). No test runs the real
 * Claude Code.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, type TerminalProcess } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bundledClaudeExecutable,
  CLAUDE_CLI_NOT_FOUND,
  claudeTerminalCommand,
  createPtyTerminalPort,
  hiddenPtySpawner,
  INVALID_PTY_HANDLE,
  loadPty,
  PTY_SPAWN_ATTEMPTS,
  locateClaudeTerminal,
  resolveClaudeAgentAcp,
  resolveClaudeExecutable,
  stripTerminalEscapes,
} from '../src/index.js';

const FAKE_CLI = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-claude-cli.mjs');

const dirs: string[] = [];
const processes: TerminalProcess[] = [];
afterEach(() => {
  for (const cli of processes.splice(0)) cli.kill();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-terminal-'));
  dirs.push(dir);
  return dir;
}

describe("the session's CLI command", () => {
  const ID = '0f8b6a2e-58c2-4d1e-9a51-3b7c2d9e4f10';

  it('runs the chat’s CLAUDE_CODE_EXECUTABLE first, with --resume and the id as separate arguments, and the env as given', () => {
    const env = { PATH: '/usr/bin', CLAUDE_CODE_EXECUTABLE: '/opt/claude/bin/claude' };
    expect(claudeTerminalCommand(ID, env, { claudeExecutable: '/elsewhere/claude' })).toEqual({ file: '/opt/claude/bin/claude', args: ['--resume', ID], env });
    // Then the one the adapter would find, as the chat's adapter does.
    expect(claudeTerminalCommand(ID, { PATH: '' }, { claudeExecutable: '/elsewhere/claude' }).file).toBe('/elsewhere/claude');
  });

  it('runs a script CLI under Node, as the Agent SDK does', () => {
    const command = claudeTerminalCommand(ID, { CLAUDE_CODE_EXECUTABLE: FAKE_CLI }, { nodePath: '/node' });
    expect(command).toMatchObject({ file: '/node', args: [FAKE_CLI, '--resume', ID] });
  });

  it('refuses an id that could read as an option or a path, and a CLI it cannot find', () => {
    for (const id of ['--dangerously-skip-permissions', '-p', '../x', 'a b', '', 'x'.repeat(200)]) {
      expect(() => claudeTerminalCommand(id, { CLAUDE_CODE_EXECUTABLE: '/c' }), id).toThrow(AgentError);
    }
    expect(() => claudeTerminalCommand(ID, { PATH: '' }, { claudeExecutable: null, adapterPath: undefined })).toThrow("Claude Code's terminal couldn't be found on this computer.");
  });

  it('resolves the same claude for the command and for locate, whose reason never names a path (story 3.2)', () => {
    const env = { PATH: '', CLAUDE_CODE_EXECUTABLE: '/opt/claude/bin/claude' };
    expect(resolveClaudeExecutable(env, { claudeExecutable: null })).toBe('/opt/claude/bin/claude');
    expect(locateClaudeTerminal(env, { claudeExecutable: null })).toEqual({ found: true });
    expect(resolveClaudeExecutable({ PATH: '' }, { claudeExecutable: '/elsewhere/claude' })).toBe('/elsewhere/claude');
    const missing = { PATH: '/nowhere/bin' };
    expect(resolveClaudeExecutable(missing, { claudeExecutable: null, adapterPath: undefined })).toBeUndefined();
    const located = locateClaudeTerminal(missing, { claudeExecutable: null, adapterPath: undefined });
    expect(located).toEqual({ found: false, reason: CLAUDE_CLI_NOT_FOUND });
    expect(JSON.stringify(located)).not.toMatch(/[\\/]/);
  });

  it('finds the Agent SDK’s bundled binary beside the adapter, as claude-agent-acp does (never running it)', () => {
    expect(bundledClaudeExecutable(undefined)).toBeUndefined();
    const adapter = resolveClaudeAgentAcp();
    if (adapter === undefined) return;
    const bundled = bundledClaudeExecutable(adapter);
    // Its platform package is optional: when installed, it is a real file.
    if (bundled !== undefined) expect(existsSync(bundled)).toBe(true);
  });
});

describe('the terminal port when node-pty cannot load (AD-19)', () => {
  it('says why, and refuses to open', async () => {
    const port = createPtyTerminalPort(async () => ({ ok: false, reason: 'no prebuilt terminal for this platform', detail: 'Error: injected' }));
    expect(await port.available()).toEqual({ ok: false, reason: 'no prebuilt terminal for this platform' });
    await expect(port.open({ file: 'x', args: [], cwd: '.', env: {}, cols: 80, rows: 24 })).rejects.toThrow('no prebuilt terminal for this platform');
  });
});

// node-pty (Windows) can lose a new pseudo-console's handle when another terminal exits at that moment (CI run 36910450998).
describe('a spawn that loses its pseudo-console handle (story 3.8)', () => {
  const flakyPty = (failures: number, message = INVALID_PTY_HANDLE) => {
    let calls = 0;
    const spawn = hiddenPtySpawner({
      spawn: () => {
        calls += 1;
        if (calls <= failures) throw new Error(message);
        return { pid: 7, onData: () => {}, onExit: () => {}, write: () => {}, kill: () => {} };
      },
    });
    return { open: () => spawn('node', [], { env: {}, cwd: '.', cols: 80, rows: 24 }), calls: () => calls };
  };

  it('is tried again, and opens', () => {
    const pty = flakyPty(PTY_SPAWN_ATTEMPTS - 1);
    expect(pty.open().pid).toBe(7);
    expect(pty.calls()).toBe(PTY_SPAWN_ATTEMPTS);
  });

  it('is tried a bounded number of times, then fails with that error', () => {
    const pty = flakyPty(PTY_SPAWN_ATTEMPTS);
    expect(pty.open).toThrow(INVALID_PTY_HANDLE);
    expect(pty.calls()).toBe(PTY_SPAWN_ATTEMPTS);
  });

  it('any other spawn error is not retried', () => {
    const pty = flakyPty(1, 'File not found: ');
    expect(pty.open).toThrow('File not found');
    expect(pty.calls()).toBe(1);
  });
});

describe('the hidden terminal after its program exited (story 3.4)', () => {
  /** A pseudo-terminal the test exits by hand, its program leading process group `pid`. */
  const handPty = (pid: number) => {
    let exit: (event: { exitCode: number; signal?: number }) => void = () => {};
    const ptyKills: unknown[] = [];
    const spawn = hiddenPtySpawner({
      spawn: () => ({ pid, onData: () => {}, onExit: (listener) => void (exit = listener), write: () => {}, kill: (signal) => void ptyKills.push(signal) }),
    });
    return { pty: spawn('node', [], { env: {}, cwd: '.', cols: 80, rows: 24 }), exit: (code: number) => exit({ exitCode: code }), ptyKills };
  };

  it.runIf(process.platform !== 'win32')('stops its process group (what it started) as its exit is reported, once; a later kill signals nothing (review F2)', () => {
    const signalled: Array<[number, unknown]> = [];
    const original = process.kill;
    process.kill = ((pid: number, signal?: unknown) => {
      signalled.push([pid, signal]);
      return true;
    }) as typeof process.kill;
    try {
      const { pty, exit, ptyKills } = handPty(4242);
      exit(70);
      expect(signalled).toEqual([[-4242, 'SIGKILL']]);
      // Later, the id could belong to someone else: nothing is signalled, and the exited terminal isn't killed.
      pty.kill();
      pty.kill();
      expect(signalled).toEqual([[-4242, 'SIGKILL']]);
      expect(ptyKills).toEqual([]);

      // Killed first: the tree once, and its exit then signals nothing more.
      signalled.length = 0;
      const killed = handPty(4343);
      killed.pty.kill();
      killed.exit(0);
      expect(signalled).toEqual([[-4343, 'SIGKILL']]);
    } finally {
      process.kill = original;
    }
  });

  it('reports its exit once to each listener, a listener added after it a moment later', async () => {
    const { pty, exit } = handPty(0);
    const early: number[] = [];
    pty.onExit(({ exitCode }) => early.push(exitCode));
    exit(70);
    exit(0);
    expect(early).toEqual([70]);
    const late = await new Promise<number>((resolve) => pty.onExit(({ exitCode }) => resolve(exitCode)));
    expect(late).toBe(70);
    expect(early).toEqual([70]);
  });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

// The real node-pty running the fake CLI. Required on CI; skipped locally only if node-pty can't load.
const realPty = await loadPty();
describe.runIf(realPty.ok || process.env.CI !== undefined)('the real terminal (fake CLI)', () => {
  const baseEnv = () => ({ PATH: process.env.PATH ?? '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) });

  const openFake = async (env: Record<string, string>) => {
    const cwd = tempDir();
    const record = join(tempDir(), 'record.json');
    const port = createPtyTerminalPort();
    expect(await port.available()).toEqual({ ok: true });
    const cli = await port.open({
      file: process.execPath,
      args: [FAKE_CLI, '--resume', 'session-1'],
      cwd,
      env: { ...baseEnv(), TERM: 'xterm-256color', FAKE_CLAUDE_RECORD: record, ...env },
      cols: 80,
      rows: 24,
    });
    processes.push(cli);
    let output = '';
    cli.onData((data) => (output += data));
    const exits: Array<number | null> = [];
    cli.onExit(({ exitCode }) => exits.push(exitCode));
    await expect.poll(() => existsSync(record), { timeout: 10_000 }).toBe(true);
    // What the screen shows: ConPTY (Windows) repaints with escape sequences between the CLI's tokens.
    const shown = () => stripTerminalEscapes(output);
    await expect.poll(shown, { timeout: 10_000 }).toContain('ready>');
    return { cli, cwd, record: () => JSON.parse(readFileSync(record, 'utf8')) as { argv: string[]; cwd: string; grandchild: number | null; term: string }, output: shown, exits };
  };

  it('runs the CLI with its arguments in its folder, types into it, and reports its own exit', async () => {
    const { cli, cwd, record, output, exits } = await openFake({});
    expect(record()).toMatchObject({ argv: ['--resume', 'session-1'], term: 'xterm-256color' });
    // The same folder, however it is spelled (Windows: an 8.3 temp path stays 8.3).
    expect(realpathSync.native(record().cwd)).toBe(realpathSync.native(cwd));
    expect(output()).toContain('fake-claude:--resume,session-1');
    cli.write('hello-there\r');
    await expect.poll(output, { timeout: 10_000 }).toContain('echo:hello-there');
    cli.write('/exit\r');
    await expect.poll(() => exits, { timeout: 10_000 }).toEqual([0]);
  }, 30_000);

  it('reports a crash with its exit code (story 3.2 fake CLI: crash)', async () => {
    const { cli, exits } = await openFake({});
    cli.write('crash\r');
    await expect.poll(() => exits, { timeout: 10_000 }).toEqual([70]);
  }, 30_000);

  // Opening one terminal just as another closes (Windows: node-pty's handle race, retried; story 3.8).
  it('opens a terminal just as another is closed, many times over', async () => {
    const port = createPtyTerminalPort();
    const exited: Array<Promise<unknown>> = [];
    for (let i = 0; i < 12; i += 1) {
      const cli = await port.open({
        file: process.execPath,
        args: [FAKE_CLI, '--resume', 'session-1'],
        cwd: tempDir(),
        env: { ...baseEnv(), TERM: 'xterm-256color', FAKE_CLAUDE_RECORD: join(tempDir(), 'record.json') },
        cols: 80,
        rows: 24,
      });
      processes.push(cli);
      exited.push(new Promise((resolve) => cli.onExit(resolve)));
      cli.kill();
    }
    await Promise.all(exited);
  }, 60_000);

  it('resizes it', async () => {
    const { cli, output } = await openFake({});
    cli.resize(100, 30);
    // A resize can apply after input already on its way: ask until it shows.
    await expect
      .poll(
        () => {
          if (!output().includes('size=100x30')) cli.write('size\r');
          return output();
        },
        { timeout: 10_000, interval: 500 },
      )
      .toContain('size=100x30');
    // The fake CLI also says so unasked when the resize reaches it (SIGWINCH; ConPTY's resize on Windows, read raw).
    await expect.poll(output, { timeout: 10_000 }).toContain('resized=100x30');
  }, 30_000);

  // POSIX: its process group is stopped as its exit is reported. Windows: nothing is done after the exit
  // (taskkill can't find a tree whose root has gone); a Node or Bun CLI's children are in libuv's
  // kill-on-close job and stop with it, which is what this checks there (story 3.8, decision Q2a).
  it('a CLI that crashed takes what it started with it, though that ignores the hang-up; its exit is heard late too (story 3.4)', async () => {
    const { cli, record, exits } = await openFake({ FAKE_CLAUDE_GRANDCHILD: '1' });
    const grandchild = record().grandchild!;
    expect(alive(grandchild)).toBe(true);
    cli.write('crash\r');
    await expect.poll(() => exits, { timeout: 10_000 }).toEqual([70]);
    // No kill() is needed: its group was stopped as its exit was reported (Windows: its job closed).
    await expect.poll(() => alive(grandchild), { timeout: 10_000 }).toBe(false);
    const late = await new Promise<number | null>((resolve) => cli.onExit(({ exitCode }) => resolve(exitCode)));
    expect(late).toBe(70);
  }, 30_000);

  it('a CLI that crashes on start reports exit 70, and what it started is stopped with it (story 3.4)', async () => {
    const record = join(tempDir(), 'record.json');
    const cli = await createPtyTerminalPort().open({
      file: process.execPath,
      args: [FAKE_CLI, '--resume', 'session-1'],
      cwd: tempDir(),
      env: { ...baseEnv(), TERM: 'xterm-256color', FAKE_CLAUDE_RECORD: record, FAKE_CLAUDE_GRANDCHILD: '1', FAKE_CLAUDE_CRASH_ON_START: '1' },
      cols: 80,
      rows: 24,
    });
    processes.push(cli);
    const exited = await new Promise<number | null>((resolve) => cli.onExit(({ exitCode }) => resolve(exitCode)));
    expect(exited).toBe(70);
    const { grandchild } = JSON.parse(readFileSync(record, 'utf8')) as { grandchild: number };
    await expect.poll(() => alive(grandchild), { timeout: 10_000 }).toBe(false);
  }, 30_000);

  it('passes a bracketed paste, Ctrl+C and a truecolour colour through unchanged (story 3.8)', async () => {
    const { cli, output, exits } = await openFake({});
    let raw = '';
    cli.onData((data) => (raw += data));
    cli.write('\x1b[200~pa ste\x1b[201~');
    await expect.poll(output, { timeout: 10_000 }).toContain(`pasted:${Buffer.from('pa ste').toString('hex')}`);
    // Ctrl+C reaches the CLI as a byte (it reads raw, as Claude Code does) and doesn't stop it.
    cli.write('\x03');
    await expect.poll(output, { timeout: 10_000 }).toContain('ctrl-c');
    expect(exits).toEqual([]);
    cli.write('colour\r');
    await expect.poll(output, { timeout: 10_000 }).toContain('TC');
    // ConPTY repaints, so the colour may come before the line break, but its bytes are the same.
    expect(raw).toContain('\x1b[38;2;12;34;56m');
  }, 30_000);

  it('kill stops the whole tree: the CLI and what it started', async () => {
    const { cli, record, exits } = await openFake({ FAKE_CLAUDE_GRANDCHILD: '1' });
    const grandchild = record().grandchild!;
    expect(alive(grandchild)).toBe(true);
    cli.kill();
    await expect.poll(() => exits.length, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => alive(grandchild), { timeout: 10_000 }).toBe(false);
  }, 30_000);
});
