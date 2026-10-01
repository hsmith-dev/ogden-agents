/**
 * `terminal-memory` (story 3.2): the in-memory `TerminalPort` tests use in
 * place of `terminal-pty`. Every method, and that it behaves as the real
 * port does where core relies on it (a kill reports its exit a moment later;
 * nothing happens once the program has exited).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryTerminalPort } from '../src/index.js';

const input = { file: 'agent-cli', args: ['--resume', 'session-1'], cwd: '/repo', env: { TERM: 'xterm-256color' }, cols: 80, rows: 24 };

describe('the memory terminal port', () => {
  it('is available by default, can be switched off and on, and refuses to open while off', async () => {
    const port = createMemoryTerminalPort();
    expect(await port.available()).toEqual({ ok: true });
    port.setAvailable({ ok: false, reason: 'no prebuilt terminal' });
    expect(await port.available()).toEqual({ ok: false, reason: 'no prebuilt terminal' });
    await expect(port.open(input)).rejects.toThrow('no prebuilt terminal');
    expect(port.opened).toEqual([]);
    port.setAvailable({ ok: true });
    await port.open(input);
    expect(port.opened).toHaveLength(1);

    const off = createMemoryTerminalPort({ available: { ok: false, reason: 'off' } });
    expect(await off.available()).toEqual({ ok: false, reason: 'off' });
  });

  it('records what it was opened with, echoes and records writes, records resizes, and prints', async () => {
    const port = createMemoryTerminalPort();
    const cli = await port.open(input);
    expect(port.opened[0]).toBe(cli);
    expect(port.opened[0]!.input).toEqual(input);
    const seen: string[] = [];
    const off = cli.onData((data) => seen.push(data));
    cli.write('hello\r');
    cli.resize(120, 40);
    port.opened[0]!.print('welcome\r\n');
    expect(port.opened[0]!.writes).toEqual(['hello\r']);
    expect(port.opened[0]!.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(seen).toEqual(['hello\r', 'welcome\r\n']);
    off();
    cli.write('unheard');
    expect(seen).toHaveLength(2);

    const quiet = await createMemoryTerminalPort({ echo: false }).open(input);
    const heard: string[] = [];
    quiet.onData((data) => heard.push(data));
    quiet.write('secret');
    expect(heard).toEqual([]);
  });

  it('exit(code) reports the exit once; nothing is typed, resized or printed after it', async () => {
    const port = createMemoryTerminalPort();
    const cli = await port.open(input);
    const memory = port.opened[0]!;
    const exits: Array<number | null> = [];
    const seen: string[] = [];
    cli.onData((data) => seen.push(data));
    cli.onExit(({ exitCode }) => exits.push(exitCode));
    expect(memory.exitCode).toBeUndefined();
    memory.exit(70);
    memory.exit(0);
    expect(exits).toEqual([70]);
    expect(memory.exitCode).toBe(70);
    cli.write('late');
    cli.resize(1, 1);
    memory.print('late');
    expect(memory.writes).toEqual([]);
    expect(memory.resizes).toEqual([]);
    expect(seen).toEqual([]);
    // A listener added after the exit still hears it, once.
    const late = await new Promise<number | null>((resolve) => cli.onExit(({ exitCode }) => resolve(exitCode)));
    expect(late).toBe(70);
  });

  it('kill reports the exit (null) a moment later, as a real terminal does, and counts the kills', async () => {
    const port = createMemoryTerminalPort();
    const cli = await port.open(input);
    const memory = port.opened[0]!;
    const exited = new Promise<number | null>((resolve) => cli.onExit(({ exitCode }) => resolve(exitCode)));
    cli.kill();
    cli.kill();
    expect(memory.exitCode).toBeUndefined();
    expect(await exited).toBeNull();
    expect(memory.kills).toBe(2);
    expect(memory.exitCode).toBeNull();
  });
});
