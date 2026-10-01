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
import { bundledClaudeExecutable, claudeTerminalCommand, createPtyTerminalPort, loadPty, resolveClaudeAgentAcp, stripTerminalEscapes } from '../src/index.js';

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

  it('runs the CLI with its arguments in its folder, types into it, resizes it, and reports its own exit', async () => {
    const { cli, cwd, record, output, exits } = await openFake({});
    expect(record()).toMatchObject({ argv: ['--resume', 'session-1'], term: 'xterm-256color' });
    // The same folder, however it is spelled (Windows: an 8.3 temp path stays 8.3).
    expect(realpathSync.native(record().cwd)).toBe(realpathSync.native(cwd));
    expect(output()).toContain('fake-claude:--resume,session-1');
    cli.write('hello-there\r');
    await expect.poll(output, { timeout: 10_000 }).toContain('echo:hello-there');
    cli.resize(100, 30);
    cli.write('size\r');
    await expect.poll(output, { timeout: 10_000 }).toContain('size=100x30');
    cli.write('/exit\r');
    await expect.poll(() => exits, { timeout: 10_000 }).toEqual([0]);
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
