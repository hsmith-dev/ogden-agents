// @vitest-environment happy-dom
/**
 * The terminal panel reconnecting (story 3.5, user decision; review F1, F2,
 * F4), in a DOM with fake timers: xterm and the socket are stand-ins, so
 * each test drives the connections' handlers itself. After a drop (1006,
 * 1001) or falling behind (1013) it waits 1, 2, 4, 4, 4 s; the tries start
 * again only after a connection stayed up 10 s or sent live output; a 4xxx
 * close keeps what was shown and says why.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSocketHandlers } from '../src/terminal/terminal-socket';

const fakes = vi.hoisted(() => ({
  connections: [] as Array<{ handlers: TerminalSocketHandlers; closed: boolean }>,
  terminals: [] as Array<{ written: string[]; resets: number }>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    written: string[] = [];
    resets = 0;
    constructor() {
      fakes.terminals.push(this);
    }
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    write(bytes: Uint8Array) {
      this.written.push(new TextDecoder().decode(bytes));
    }
    reset() {
      this.resets++;
      this.written = [];
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    onData = () => ({ dispose() {} });
    onResize = () => ({ dispose() {} });
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../src/terminal/terminal-socket', () => ({
  connectTerminal: (_sesId: string, handlers: TerminalSocketHandlers) => {
    const connection = { handlers, closed: false };
    fakes.connections.push(connection);
    return { type() {}, resize() {}, close: () => void (connection.closed = true) };
  },
}));

const { RECONNECT_DELAYS_MS, STABLE_CONNECTION_MS, TerminalPanel, TOO_MANY_VIEWERS } = await import('../src/terminal/terminal-panel');

const bytes = (text: string) => new TextEncoder().encode(text);

/** Lets the panel's dynamic imports and effects run. */
async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

async function mount() {
  render(<TerminalPanel sesId="ses_1" agentName="Claude Code" screenReaderMode={false} />);
  await flush();
  expect(fakes.connections).toHaveLength(1);
}

const status = () => screen.getByTestId('terminal').dataset.status;
const words = () => screen.queryByTestId('terminal-status')?.textContent;
const last = () => fakes.connections.at(-1)!.handlers;

/** Closes the newest connection with `code`, then waits `delay`, checking no connection comes a moment early. */
async function dropAndWait(code: number, delay: number) {
  const before = fakes.connections.length;
  act(() => last().onClose(code));
  expect(status()).toBe('reconnecting');
  await act(async () => void vi.advanceTimersByTime(delay - 1));
  expect(fakes.connections).toHaveLength(before);
  await act(async () => void vi.advanceTimersByTime(1));
  expect(fakes.connections).toHaveLength(before + 1);
}

beforeEach(() => {
  fakes.connections.length = 0;
  fakes.terminals.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  if (globalThis.ResizeObserver === undefined) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the terminal panel reconnecting (story 3.5)', () => {
  it('a connection that attaches and drops at once runs out of tries after five, waiting 1, 2, 4, 4, 4 s, then says to reload (review F1)', async () => {
    await mount();
    for (const delay of RECONNECT_DELAYS_MS) {
      act(() => {
        last().onOpen();
        last().onBytes(bytes('recent output'));
      });
      await dropAndWait(1006, delay);
    }
    act(() => {
      last().onOpen();
      last().onBytes(bytes('recent output'));
      last().onClose(1006);
    });
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(fakes.connections).toHaveLength(RECONNECT_DELAYS_MS.length + 1);
    expect(status()).toBe('disconnected');
    expect(words()).toBe('The terminal is not connected. Reload to reconnect.');
  });

  it(`the tries start again after a connection stayed up ${STABLE_CONNECTION_MS} ms, or sent live output after the recent output (review F1)`, async () => {
    await mount();
    await dropAndWait(1006, 1_000);
    await dropAndWait(1001, 2_000);
    act(() => last().onOpen());
    await act(async () => void vi.advanceTimersByTime(STABLE_CONNECTION_MS));
    await dropAndWait(1006, 1_000);
    await dropAndWait(1006, 2_000);
    act(() => {
      last().onOpen();
      last().onBytes(bytes('recent output'));
      last().onBytes(bytes('live output'));
    });
    await dropAndWait(1006, 1_000);
  });

  it('falling behind (1013) waits and is limited like a drop (review F1)', async () => {
    await mount();
    await dropAndWait(1013, 1_000);
    await dropAndWait(1013, 2_000);
  });

  it('after a reconnect xterm is reset only when the recent output arrives; a close that says the terminal ended keeps what was shown (review F4)', async () => {
    await mount();
    const term = fakes.terminals[0]!;
    act(() => {
      last().onOpen();
      last().onBytes(bytes('old output'));
    });
    await dropAndWait(1006, 1_000);
    act(() => last().onOpen());
    expect(term.resets).toBe(0);
    // The terminal ended while away: the new socket is refused (4404).
    act(() => last().onClose(4404));
    expect(term.written).toEqual(['old output']);
    expect(status()).toBe('ended');
    expect(words()).toBe('Claude Code left the terminal.');
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(fakes.connections).toHaveLength(2);
  });

  it('the recent output replaces what was shown once it arrives (review F4)', async () => {
    await mount();
    const term = fakes.terminals[0]!;
    act(() => last().onBytes(bytes('old output')));
    await dropAndWait(1006, 1_000);
    act(() => {
      last().onOpen();
      last().onBytes(bytes('recent output'));
    });
    expect(term.resets).toBe(1);
    expect(term.written).toEqual(['recent output']);
    expect(status()).toBe('connected');
  });

  it('a viewer over the session’s limit says so in plain words, keeps what was shown and does not retry (review F2)', async () => {
    await mount();
    act(() => last().onBytes(bytes('shown')));
    act(() => last().onClose(TOO_MANY_VIEWERS));
    expect(status()).toBe('tooMany');
    expect(words()).toBe('Too many open terminal views. Close one, then reload.');
    expect(fakes.terminals[0]!.written).toEqual(['shown']);
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(fakes.connections).toHaveLength(1);
  });
});
