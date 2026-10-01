/**
 * Story 3.5 (E3-R2, E3-R3): several viewers of one terminal. Each viewer
 * has its own size; the terminal takes the size of whichever viewer last
 * resized or typed, and the others are told. A viewer that leaves only
 * detaches: the terminal runs on with no viewer. Core depends on no adapter,
 * so the in-memory terminal (it echoes what is typed and records resizes, as
 * `terminal-memory` does) is core's own (`support/fake-terminal.ts`, story
 * 3.9); fake timers for "still running".
 * The socket rows of the plan's matrix (attach order, the 5 s wait, bytes
 * before attach, the rate limit) are in the server's terminal-socket.test.ts.
 */
import { MAX_TERMINAL_COLS, MAX_TERMINAL_ROWS } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChat,
  TERMINAL_BACKLOG_CHARS,
  TERMINAL_COLS,
  TERMINAL_ROWS,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type TerminalSize,
  type TerminalViewer,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';
import { fakeTerminal as memoryTerminal } from './support/fake-terminal.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A Claude-Code-like agent that answers at once and whose sessions resume in its CLI. */
function resumingAgent(): AgentPort {
  let sessions = 0;
  const open = (agentSessionId: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const emit = (event: AgentEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        emit({ type: 'state', state: 'working' });
        emit({ type: 'message_chunk', text: `re: ${text}` });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {},
    };
  };
  return {
    displayName: 'Claude Code',
    listAuthMethods: async () => [],
    startSession: async () => open(`agent-${++sessions}`),
    reopenSession: async (input) => ({ session: open(input.agentSessionId), restored: 'resumed' }),
    terminalResume: {
      command: async (id, env) => ({ file: 'claude', args: ['--resume', id], env: { ...env } }),
      locate: async () => ({ found: true }),
    },
  };
}

/** A chat that answered once and switched to its terminal. */
async function chatInTerminal() {
  const core = openTestCore();
  const terminal = memoryTerminal();
  const internal: unknown[] = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agent: resumingAgent(),
    terminal: terminal.port,
    onInternalError: (_sessionId, error) => internal.push(error),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = chat.createChatSession(workspace.id);
  chat.sendMessage(workspace.id, session.id, 'first question');
  await chat.settled();
  expect((await chat.switchDriver(workspace.id, session.id, 'terminal')).driver).toBe('terminal');
  return { core, chat, workspace, session, cli: terminal.processes[0]!, internal };
}

/** A viewer and what it has been told. */
function watch(viewer: TerminalViewer | undefined) {
  expect(viewer).toBeDefined();
  const seen = { output: viewer!.backlog, sizes: [] as TerminalSize[], ends: [] as Array<number | null> };
  viewer!.onData((data) => (seen.output += data));
  viewer!.onSize((size) => seen.sizes.push(size));
  viewer!.onEnd(({ exitCode }) => seen.ends.push(exitCode));
  return { viewer: viewer!, seen };
}

describe('several viewers of one terminal (story 3.5)', () => {
  it('attaching sizes the terminal to the viewer and tells the others; the newcomer gets the recent output, then live output', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    expect(a.viewer.size).toEqual({ cols: TERMINAL_COLS, rows: TERMINAL_ROWS });
    a.viewer.resize(100, 30);
    expect(cli.resizes).toEqual([{ cols: 100, rows: 30 }]);
    // The resizer is at its own size already: it is not told.
    expect(a.seen.sizes).toEqual([]);
    cli.print('before b\r\n');

    const b = watch(chat.attachTerminal(session.id));
    expect(b.seen.output).toBe('before b\r\n');
    b.viewer.resize(90, 20);
    expect(cli.resizes.at(-1)).toEqual({ cols: 90, rows: 20 });
    expect(a.seen.sizes).toEqual([{ cols: 90, rows: 20 }]);
    expect(b.seen.sizes).toEqual([]);
    expect(a.viewer.size).toEqual({ cols: 90, rows: 20 });

    cli.print('after b');
    expect(a.seen.output).toBe('before b\r\nafter b');
    expect(b.seen.output).toBe('before b\r\nafter b');
    await chat.close();
  });

  it('a resize to the size the terminal has already changes nothing and tells no one', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    a.viewer.resize(TERMINAL_COLS, TERMINAL_ROWS);
    expect(cli.resizes).toEqual([]);
    expect([...a.seen.sizes, ...b.seen.sizes]).toEqual([]);
    await chat.close();
  });

  it('typing after another viewer resized gives the terminal the typer’s size, and every viewer is told', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    b.viewer.resize(120, 40);
    a.viewer.resize(100, 30);
    expect(b.seen.sizes).toEqual([{ cols: 100, rows: 30 }]);
    b.viewer.write('x');
    expect(cli.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });
    // The typer too: its screen had followed A's size.
    expect(a.seen.sizes.at(-1)).toEqual({ cols: 120, rows: 40 });
    expect(b.seen.sizes.at(-1)).toEqual({ cols: 120, rows: 40 });
    const resizes = cli.resizes.length;
    // Typing again at its own size changes nothing more.
    b.viewer.write('y');
    expect(cli.resizes).toHaveLength(resizes);
    expect(cli.writes).toEqual(['x', 'y']);
    await chat.close();
  });

  it('a viewer that never resized types at whatever size the terminal has', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    a.viewer.resize(100, 30);
    expect(b.seen.sizes).toEqual([{ cols: 100, rows: 30 }]);
    b.viewer.write('x');
    // Its write changes no size: no one is told again.
    expect(cli.resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(b.seen.sizes).toHaveLength(1);
    expect(a.seen.sizes).toEqual([]);
    await chat.close();
  });

  it('two viewers type: both reach the CLI, and both see all the output', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    a.viewer.write('from a ');
    b.viewer.write('from b');
    expect(cli.writes).toEqual(['from a ', 'from b']);
    expect(a.seen.output).toBe('from a from b');
    expect(b.seen.output).toBe('from a from b');
    await chat.close();
  });

  it('sizes are clamped to the contract’s bounds, and a non-finite one is ignored', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    a.viewer.resize(MAX_TERMINAL_COLS + 500, 0);
    expect(cli.resizes).toEqual([{ cols: MAX_TERMINAL_COLS, rows: 1 }]);
    a.viewer.resize(-3, MAX_TERMINAL_ROWS * 2);
    expect(cli.resizes.at(-1)).toEqual({ cols: 1, rows: MAX_TERMINAL_ROWS });
    a.viewer.resize(Number.NaN, 10);
    a.viewer.resize(10, Number.POSITIVE_INFINITY);
    expect(cli.resizes).toHaveLength(2);
    await chat.close();
  });

  it('a viewer that reattaches (a reload, a dropped network) gets the newest recent output; the CLI ran on', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const first = watch(chat.attachTerminal(session.id));
    cli.print('x'.repeat(TERMINAL_BACKLOG_CHARS));
    first.viewer.detach();
    cli.print('\r\nwhile away');
    // A detached viewer hears nothing more.
    expect(first.seen.output).not.toContain('while away');
    expect(cli.exitCode()).toBeUndefined();

    const again = watch(chat.attachTerminal(session.id));
    expect(again.seen.output.length).toBeLessThanOrEqual(TERMINAL_BACKLOG_CHARS);
    expect(again.seen.output.endsWith('while away')).toBe(true);
    await chat.close();
  });

  it('a detached viewer is no longer told of sizes, and its own size no longer counts', async () => {
    const { chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    a.viewer.resize(100, 30);
    a.viewer.detach();
    b.viewer.resize(90, 20);
    expect(a.seen.sizes).toEqual([]);
    // Its calls after detaching do nothing.
    a.viewer.write('late');
    a.viewer.resize(50, 10);
    expect(cli.writes).toEqual([]);
    expect(cli.resizes.at(-1)).toEqual({ cols: 90, rows: 20 });
    await chat.close();
  });

  it('with every viewer gone the CLI is still running after 60 s, and the chat stays in the terminal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { core, chat, session, cli } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    a.viewer.detach();
    b.viewer.detach();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cli.exitCode()).toBeUndefined();
    expect(core.entities.getSession(session.id)!.driver).toBe('terminal');
    // And it can be watched again.
    cli.print('still here');
    expect(watch(chat.attachTerminal(session.id)).seen.output).toContain('still here');
    vi.useRealTimers();
    await chat.close();
  });

  it('when the terminal ends every viewer is told, once; a viewer can no longer attach', async () => {
    const { chat, workspace, session } = await chatInTerminal();
    const a = watch(chat.attachTerminal(session.id));
    const b = watch(chat.attachTerminal(session.id));
    expect((await chat.switchDriver(workspace.id, session.id, 'ui')).driver).toBe('ui');
    expect(a.seen.ends).toEqual([null]);
    expect(b.seen.ends).toEqual([null]);
    expect(chat.attachTerminal(session.id)).toBeUndefined();
    // Typing or resizing an ended terminal does nothing.
    a.viewer.write('late');
    a.viewer.resize(50, 10);
    await chat.close();
  });

  it('a throwing size listener is logged as an internal error and the other viewers are still told', async () => {
    const { chat, session, internal } = await chatInTerminal();
    const a = chat.attachTerminal(session.id)!;
    a.onSize(() => {
      throw new Error('listener failed');
    });
    const b = watch(chat.attachTerminal(session.id));
    const c = watch(chat.attachTerminal(session.id));
    c.viewer.resize(70, 20);
    expect(b.seen.sizes).toEqual([{ cols: 70, rows: 20 }]);
    expect(internal.map(String)).toEqual(['Error: listener failed']);
    await chat.close();
  });
});
