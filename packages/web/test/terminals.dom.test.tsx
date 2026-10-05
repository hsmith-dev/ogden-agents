// @vitest-environment happy-dom
/**
 * The Terminals page and a pane's view (epic 16, story 16.2), in a DOM with
 * xterm and the pane socket as stand-ins, so each test drives the socket's
 * handlers itself. Without Developer mode the page asks the server for
 * nothing; with it a pane shows starting, slow to start (Restart pane),
 * ended (Restart pane), and the screen the server replays after a reset.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../src/ui/tooltip';
import type { PaneSocketHandlers } from '../src/terminal/pane-socket';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const PANE = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const fakes = vi.hoisted(() => ({
  connections: [] as Array<{ handlers: PaneSocketHandlers; closed: boolean; typed: string[] }>,
  terminals: [] as Array<{ cols: number; rows: number; written: string[]; resets: number; options: Record<string, unknown>; unicode: { activeVersion: string } }>,
  requests: [] as Array<{ method: string; path: string; body?: string }>,
  panes: [] as unknown[],
  /** The layout the server answers; by default one tab per pane. */
  layout: undefined as unknown,
  terminal: { available: true } as unknown,
  denied: false,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    written: string[] = [];
    resets = 0;
    unicode = { activeVersion: '6' };
    constructor(options: Record<string, unknown>) {
      this.options = options;
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
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../src/terminal/pane-socket', () => ({
  connectPane: (_paneId: string, handlers: PaneSocketHandlers) => {
    const connection = { handlers, closed: false, typed: [] as string[] };
    fakes.connections.push(connection);
    return { type: (text: string) => connection.typed.push(text), resize() {}, close: () => void (connection.closed = true) };
  },
}));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fakes.requests.push({ method, path, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      if (fakes.denied) return new Response(JSON.stringify({ error: { code: 'developer_mode_required', message: 'Terminals are only offered in Developer mode.' } }), { status: 403 });
      if (method === 'GET') {
        const panes = fakes.panes as Array<{ id: string; title: string }>;
        const layout = fakes.layout ?? { tabs: panes.map((p, i) => ({ id: `t${i}`, title: p.title, root: { type: 'pane', paneId: p.id } })), activeTabId: panes.length === 0 ? null : 't0' };
        return new Response(JSON.stringify({ panes, layout, terminal: fakes.terminal, limits: { perProject: 8, perInstall: 16 } }));
      }
      if (method === 'PUT') {
        const { layout } = JSON.parse(String(init?.body)) as { layout: unknown };
        fakes.layout = layout;
        return new Response(JSON.stringify({ panes: fakes.panes, layout, terminal: fakes.terminal, limits: { perProject: 8, perInstall: 16 } }));
      }
      if (method === 'PATCH') return new Response(JSON.stringify({ pane: { ...(fakes.panes[0] as object), title: JSON.parse(String(init?.body)).title } }));
      if (method === 'POST' && path.endsWith('/restart')) return new Response(JSON.stringify({ pane: fakes.panes[0] }));
      if (method === 'POST') {
        const pane = { id: PANE, workspaceId: WS, launcherId: 'shell', title: 'Terminal 1', state: 'starting', exitCode: null };
        fakes.panes = [pane];
        return new Response(JSON.stringify({ pane }), { status: 201 });
      }
      if (method === 'DELETE') {
        fakes.panes = [];
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

const { DEVELOPER_MODE_NEEDED, TerminalsView } = await import('../src/terminal/terminals-view');
const { SLOW_START_MS } = await import('../src/terminal/pane-view');

const pane = (fields: Record<string, unknown> = {}) => ({ id: PANE, workspaceId: WS, launcherId: 'shell', title: 'Terminal 1', state: 'starting', exitCode: null, ...fields });

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

const mount = async (developerMode = true) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TerminalsView wsId={WS} developerMode={developerMode} screenReaderMode={false} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await settle();
};

beforeEach(() => {
  fakes.connections.length = 0;
  fakes.terminals.length = 0;
  fakes.requests.length = 0;
  fakes.panes = [];
  fakes.layout = undefined;
  fakes.terminal = { available: true };
  fakes.denied = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Terminals page (E16-R3, AD-21)', () => {
  it('without Developer mode says so in one sentence and asks the server for nothing', async () => {
    await mount(false);
    expect(screen.getByTestId('terminals-developer-mode').textContent).toBe(DEVELOPER_MODE_NEEDED);
    expect(screen.queryByTestId('terminals-new')).toBeNull();
    expect(fakes.requests).toEqual([]);
  });

  it('says the same when the server refuses with developer_mode_required (the page was ahead of the switch)', async () => {
    fakes.denied = true;
    await mount(true);
    expect(screen.getByTestId('terminals-developer-mode')).toBeTruthy();
  });

  it('with Developer mode shows an empty state and opens a pane on New terminal, at the page size', async () => {
    await mount();
    expect(screen.getByTestId('terminals-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('terminals-new'));
    await settle();
    expect(fakes.requests.find((r) => r.method === 'POST')).toMatchObject({ path: `/api/v1/workspaces/${WS}/panes`, body: JSON.stringify({ cols: 100, rows: 30 }) });
    expect(screen.getByTestId('pane')).toBeTruthy();
    expect(screen.getByTestId('pane-title').textContent).toBe('Terminal 1');
  });

  it('says why a pane can not open (node-pty failed to load) and disables New terminal', async () => {
    fakes.terminal = { available: false, code: 'pty_unavailable', reason: 'The terminal couldn\'t start on this computer: no prebuilt terminal.' };
    await mount();
    expect(screen.getByTestId('terminals-unavailable').textContent).toContain('no prebuilt terminal');
    expect((screen.getByTestId('terminals-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Close asks the server to stop the pane and removes it', async () => {
    fakes.panes = [pane()];
    await mount();
    fireEvent.click(screen.getByTestId('pane-close'));
    await settle();
    expect(fakes.requests.some((r) => r.method === 'DELETE' && r.path === `/api/v1/workspaces/${WS}/panes/${PANE}`)).toBe(true);
    expect(screen.queryByTestId('pane')).toBeNull();
  });
});

const two = () => {
  const a = pane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WA', title: 'Terminal 1', state: 'running' });
  const b = pane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WB', title: 'Terminal 2', state: 'running' });
  fakes.panes = [a, b];
  fakes.layout = {
    tabs: [
      { id: 'ta', title: 'Main', root: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', paneId: a.id }, second: { type: 'pane', paneId: b.id } } },
      { id: 'tb', title: 'Other', root: { type: 'pane', paneId: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WC' } },
    ],
    activeTabId: 'ta',
  };
  fakes.panes.push(pane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WC', title: 'Terminal 3', state: 'running' }));
};
const puts = () => fakes.requests.filter((r) => r.method === 'PUT').map((r) => JSON.parse(r.body!).layout);

describe('tabs, splits and the layout (story 16.4)', () => {
  it('shows the active tab only: its split panes connect, the other tab\'s do not', async () => {
    two();
    await mount();
    expect(screen.getAllByTestId('pane')).toHaveLength(2);
    expect(fakes.connections).toHaveLength(2);
    expect(screen.getAllByTestId('terminal-tab').map((t) => t.textContent)).toEqual(['Main', 'Other']);
    expect(screen.getAllByTestId('layout-divider')).toHaveLength(1);
  });

  it('switching tab saves the active tab and shows the other tab\'s pane', async () => {
    two();
    await mount();
    fireEvent.click(screen.getAllByTestId('terminal-tab')[1]!);
    await settle();
    expect(puts().at(-1).activeTabId).toBe('tb');
    expect(screen.getAllByTestId('pane')).toHaveLength(1);
  });

  it('a divider moves with the arrow keys, 5 percent each, and is saved', async () => {
    two();
    await mount();
    const divider = screen.getByTestId('layout-divider');
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    await settle();
    expect(puts().at(-1).tabs[0].root.ratio).toBeCloseTo(0.55);
    fireEvent.keyDown(screen.getByTestId('layout-divider'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('layout-divider'), { key: 'ArrowLeft' });
    await settle();
    expect(puts().at(-1).tabs[0].root.ratio).toBeGreaterThanOrEqual(0.1);
  });

  it('Split right asks for a pane beside this one, and is refused in words at the limit', async () => {
    two();
    await mount();
    fireEvent.click(screen.getAllByTestId('pane-split-row')[0]!);
    await settle();
    const post = fakes.requests.find((r) => r.method === 'POST')!;
    expect(JSON.parse(post.body!)).toMatchObject({ placement: { kind: 'split', paneId: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WA', direction: 'row' } });
    cleanup();
    fakes.panes = Array.from({ length: 8 }, (_, i) => pane({ id: `pan_01J9Z3K4M5N6P7Q8R9S0T1V2W${i}`, title: `T${i}`, state: 'running' }));
    await mount();
    expect(screen.getByTestId('terminals-full').textContent).toBe('A project can have 8 terminals open at once. Close one first.');
    expect((screen.getByTestId('terminals-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a pane from its name and a tab by double click, Enter saves and Escape does not', async () => {
    two();
    await mount();
    fireEvent.click(screen.getAllByTestId('pane-title')[0]!);
    const input = screen.getByTestId('pane-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Server' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle();
    expect(fakes.requests.find((r) => r.method === 'PATCH')).toMatchObject({ body: JSON.stringify({ title: 'Server' }) });
    fireEvent.doubleClick(screen.getAllByTestId('terminal-tab')[0]!);
    const tabInput = screen.getByTestId('tab-title-input') as HTMLInputElement;
    fireEvent.change(tabInput, { target: { value: 'Servers' } });
    fireEvent.keyDown(tabInput, { key: 'Enter' });
    await settle();
    expect(puts().at(-1).tabs[0].title).toBe('Servers');
    fireEvent.doubleClick(screen.getAllByTestId('terminal-tab')[0]!);
    fireEvent.keyDown(screen.getByTestId('tab-title-input'), { key: 'Escape' });
    expect(screen.queryByTestId('tab-title-input')).toBeNull();
  });
});

describe('a pane (E16-R11: starting, slow to start, ended; replay)', () => {
  it('xterm gets the Unicode 11 width table and 5,000 lines of scrollback', async () => {
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    expect(fakes.terminals[0]!.unicode.activeVersion).toBe('11');
    expect(fakes.terminals[0]!.options).toMatchObject({ scrollback: 5000, allowProposedApi: true });
  });

  it('is starting until it prints, then says nothing; Restart pane is offered only once it is slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakes.panes = [pane()];
    await mount();
    const connection = fakes.connections[0]!;
    await act(async () => connection.handlers.onOpen());
    expect(screen.getByTestId('pane-status').textContent).toBe('Starting the terminal');
    expect(screen.queryByTestId('pane-restart')).toBeNull();
    await act(async () => void vi.advanceTimersByTime(SLOW_START_MS + 100));
    expect(screen.getByTestId('pane-status').textContent).toContain('slow to start');
    expect(screen.getByTestId('pane-restart')).toBeTruthy();
    await act(async () => connection.handlers.onState('running'));
    expect(screen.queryByTestId('pane-status')).toBeNull();
    expect(screen.queryByTestId('pane-restart')).toBeNull();
  });

  it('says its program ended with the code, and Restart pane starts it again at the terminal size', async () => {
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    const connection = fakes.connections[0]!;
    await act(async () => connection.handlers.onOpen());
    await act(async () => {
      connection.handlers.onExit(3);
      connection.handlers.onState('exited');
    });
    expect(screen.getByTestId('pane-status').textContent).toBe('The program in this terminal ended with code 3.');
    fireEvent.click(screen.getByTestId('pane-restart'));
    await settle();
    const restart = fakes.requests.find((r) => r.path.endsWith('/restart'));
    expect(restart).toMatchObject({ method: 'POST', body: JSON.stringify({ cols: 80, rows: 24 }) });
    // The same socket carries the new program: its state follows.
    await act(async () => connection.handlers.onState('starting'));
    expect(screen.getByTestId('pane-status').textContent).toBe('Starting the terminal');
  });

  it('a reset replaces the screen with what the server replays, then live output adds to it', async () => {
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    const { handlers } = fakes.connections[0]!;
    const term = fakes.terminals[0]!;
    await act(async () => {
      handlers.onOpen();
      handlers.onBytes(new TextEncoder().encode('old screen'));
    });
    await act(async () => {
      handlers.onReset();
      handlers.onBytes(new TextEncoder().encode('replayed'));
      handlers.onBytes(new TextEncoder().encode(' live'));
    });
    expect(term.resets).toBe(1);
    expect(term.written).toEqual(['replayed', ' live']);
  });

  it('follows another viewer\'s size', async () => {
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    await act(async () => fakes.connections[0]!.handlers.onSize(120, 40));
    expect([fakes.terminals[0]!.cols, fakes.terminals[0]!.rows]).toEqual([120, 40]);
  });

  it('says Developer mode is off, or that the pane was closed, and does not reconnect', async () => {
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    await act(async () => fakes.connections[0]!.handlers.onClose(4403));
    expect(screen.getByTestId('pane-status').textContent).toBe('Terminals are only available in Developer mode.');
    expect(fakes.connections).toHaveLength(1);
    cleanup();
    fakes.connections.length = 0;
    await mount();
    await act(async () => fakes.connections[0]!.handlers.onClose(4001));
    expect(screen.getByTestId('pane-status').textContent).toBe('This terminal was closed.');
  });

  it('reconnects after a dropped connection, and the replay resets the screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    await act(async () => fakes.connections[0]!.handlers.onClose(1006));
    expect(screen.getByTestId('pane-status').textContent).toBe('Reconnecting to the terminal');
    await act(async () => void vi.advanceTimersByTime(1100));
    expect(fakes.connections).toHaveLength(2);
  });
});
