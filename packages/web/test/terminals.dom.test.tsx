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
  terminals: [] as Array<{ focused: number; cols: number; rows: number; written: string[]; resets: number; options: Record<string, unknown>; unicode: { activeVersion: string } }>,
  requests: [] as Array<{ method: string; path: string; body?: string }>,
  panes: [] as unknown[],
  /** The layout the server answers; by default one tab per pane. */
  layout: undefined as unknown,
  terminal: { available: true } as unknown,
  denied: false,
  launchers: [] as unknown[],
  settings: { notifyNeedsAttention: false, notifyExited: false, notifyLaunchers: [] as string[], passProxies: false, passSshAgent: false, launcherArgs: {} as Record<string, string>, hidden: false },
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
    focused = 0;
    focus() {
      this.focused++;
    }
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
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], store: undefined, caughtUp: true }) }));
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
      if (path.endsWith('/settings/terminals')) return new Response(JSON.stringify({ settings: fakes.settings }));
      if (path.endsWith('/terminals/launchers')) return new Response(JSON.stringify({ launchers: fakes.launchers }));
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
        if (fakes.panes.length === 0) fakes.panes = [pane];
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
  // Each pane connects once its (lazily imported) terminal is up: wait for that, not for a fixed number of ticks,
  // which a slow runner (Windows CI) can outrun. Bounded; a pane that never connects fails its own assertions.
  for (let i = 0; i < 500 && fakes.connections.length < screen.queryAllByTestId('pane').length; i++) await settle();
};

beforeEach(() => {
  fakes.connections.length = 0;
  fakes.terminals.length = 0;
  fakes.requests.length = 0;
  fakes.panes = [];
  fakes.layout = undefined;
  fakes.terminal = { available: true };
  fakes.denied = false;
  fakes.launchers = [];
  fakes.settings = { notifyNeedsAttention: false, notifyExited: false, notifyLaunchers: [], passProxies: false, passSshAgent: false, launcherArgs: {}, hidden: false };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const launcher = (id: string, label: string, state: string, extra: Record<string, unknown> = {}) => ({
  launcher: { id, label, kind: 'cli', executables: {}, defaultArgs: [], promptPatterns: [], showWhenMissing: true, installUrl: `https://example.com/${id}`, ...extra },
  detection: { launcherId: id, state, ...(state === 'found' ? { version: 'tool 1.2.3' } : {}) },
});

describe('programs: detection and starting (story 16.5; E16-R5, R9)', () => {
  it('shows each program as found or not found, with the install page and "install it yourself" and never an installer', async () => {
    fakes.launchers = [launcher('claude-code', 'Claude Code', 'found'), launcher('codex', 'Codex', 'not_found'), launcher('grok', 'Grok', 'failed')];
    await mount();
    const rows = screen.getAllByTestId('launcher');
    expect(rows.map((row) => [row.getAttribute('data-launcher'), row.getAttribute('data-state')])).toEqual([['claude-code', 'found'], ['codex', 'not_found'], ['grok', 'failed']]);
    expect(rows[0]!.textContent).toContain('Found, tool 1.2.3');
    const missing = rows[1]!;
    expect(missing.textContent).toContain('Install it yourself, then press Detect.');
    const link = missing.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/codex');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(rows[2]!.textContent).toContain('did not answer');
    // Only a found program can be started; nothing here installs anything.
    expect(rows[1]!.querySelector('[data-testid="launcher-start"]')).toBeNull();
    expect(fakes.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });

  it('starts a found program with the arguments typed in its own field, and nothing else', async () => {
    fakes.launchers = [launcher('claude-code', 'Claude Code', 'found')];
    await mount();
    fireEvent.change(screen.getByTestId('launcher-args'), { target: { value: '--model big' } });
    fireEvent.click(screen.getByTestId('launcher-start'));
    await settle();
    const post = fakes.requests.find((r) => r.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({ cols: 100, rows: 30, launcherId: 'claude-code', args: '--model big' });
  });

  it('starts with no args field content as just the launcher', async () => {
    fakes.launchers = [launcher('codex', 'Codex', 'found')];
    await mount();
    fireEvent.click(screen.getByTestId('launcher-start'));
    await settle();
    expect(JSON.parse(fakes.requests.find((r) => r.method === 'POST')!.body!)).toEqual({ cols: 100, rows: 30, launcherId: 'codex' });
  });

  it('Detect asks the server to look again and shows the new answer', async () => {
    fakes.launchers = [launcher('codex', 'Codex', 'not_found')];
    await mount();
    fakes.launchers = [launcher('codex', 'Codex', 'found')];
    fireEvent.click(screen.getByTestId('launchers-detect'));
    await settle();
    expect(fakes.requests.some((r) => r.method === 'POST' && r.path.endsWith('/terminals/launchers'))).toBe(true);
    expect(screen.getByTestId('launcher').getAttribute('data-state')).toBe('found');
  });

  it('says Copilot is for interactive use only', async () => {
    fakes.launchers = [launcher('copilot', 'Copilot', 'found', { termsNote: 'interactive_only' })];
    await mount();
    expect(screen.getByTestId('launcher-interactive').textContent).toContain('own interactive use only');
  });

  it('shows nothing about programs when there are none and none failed to load', async () => {
    await mount();
    expect(screen.queryByTestId('launchers')).toBeNull();
  });
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

describe('Terminals settings on the page (story 16.9)', () => {
  it('hidden says so in one sentence, with no list and no New terminal', async () => {
    fakes.settings = { ...fakes.settings, hidden: true };
    await mount();
    expect(screen.getByTestId('terminals-hidden-notice').textContent).toContain('Terminals are hidden');
    expect(screen.queryByTestId('terminals-new')).toBeNull();
  });

  it('a program\'s own arguments from Settings fill its field, and Start sends them', async () => {
    fakes.launchers = [launcher('claude-code', 'Claude Code', 'found')];
    fakes.settings = { ...fakes.settings, launcherArgs: { 'claude-code': '--model big' } };
    await mount();
    expect((screen.getByTestId('launcher-args') as HTMLInputElement).value).toBe('--model big');
    fireEvent.click(screen.getByTestId('launcher-start'));
    await settle();
    expect(JSON.parse(fakes.requests.find((r) => r.method === 'POST')!.body!)).toMatchObject({ launcherId: 'claude-code', args: '--model big' });
  });
});

describe('notifications are the user\'s opt in (story 16.8)', () => {
  it('each pane has a Notify me switch, off by default, that asks the server and says what it shows', async () => {
    fakes.panes = [pane({ state: 'running' })];
    await mount();
    const box = screen.getByTestId('pane-notify') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.closest('label')!.getAttribute('title')).toContain('never what it printed');
    fireEvent.click(box);
    await settle();
    const patch = fakes.requests.find((r) => r.method === 'PATCH')!;
    expect(JSON.parse(patch.body!)).toEqual({ notify: true });
  });

  it('shows the opt in the server has, with a name for screen readers', async () => {
    fakes.panes = [pane({ state: 'running', notify: true })];
    await mount();
    const box = screen.getByTestId('pane-notify') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.getAttribute('aria-label')).toBe('Notify me when Terminal 1 may need me');
  });
});

describe('stopped panes after a restart (story 16.7)', () => {
  it('says it is stopped and offers Start, with the program\'s own resume words and an arguments field for a CLI', async () => {
    fakes.launchers = [launcher('example', 'Example CLI', 'found', { resumeHint: 'Run example --resume to pick up an earlier session.' })];
    fakes.panes = [pane({ launcherId: 'example', state: 'stopped', status: 'idle' })];
    await mount();
    expect(screen.getByTestId('pane-status-chip').textContent).toBe('Stopped');
    const connection = fakes.connections[0]!;
    await act(async () => connection.handlers.onOpen());
    expect(screen.getByTestId('pane-status').textContent).toContain('Press Start to run it again.');
    expect(screen.getByTestId('pane-status').textContent).toContain('Run example --resume');
    fireEvent.change(screen.getByTestId('pane-start-args'), { target: { value: '--model big' } });
    fireEvent.click(screen.getByTestId('pane-restart'));
    await settle();
    expect(screen.getByTestId('pane-restart').textContent).toBe('Start');
    expect(JSON.parse(fakes.requests.find((r) => r.path.endsWith('/restart'))!.body!)).toEqual({ cols: 80, rows: 24, args: '--model big' });
  });

  it('a stopped shell has no arguments field and no resume words', async () => {
    fakes.panes = [pane({ state: 'stopped', status: 'idle' })];
    await mount();
    await act(async () => fakes.connections[0]!.handlers.onOpen());
    expect(screen.queryByTestId('pane-start-args')).toBeNull();
    expect(screen.getByTestId('pane-restart').textContent).toBe('Start');
  });
});

describe('status (story 16.6)', () => {
  it('shows each pane\'s status in plain words, says it is a guess, and marks a tab that has a pane needing attention', async () => {
    two();
    fakes.panes = (fakes.panes as Array<Record<string, unknown>>).map((p, i) => ({ ...p, status: ['needs_attention', 'idle', 'working'][i] }));
    await mount();
    const chips = screen.getAllByTestId('pane-status-chip');
    expect(chips.map((chip) => [chip.getAttribute('data-status'), chip.textContent])).toEqual([['needs_attention', 'Needs attention'], ['idle', 'Idle']]);
    expect(screen.getByTestId('status-guess').textContent).toContain('a guess');
    // The tab of the pane that needs attention says so; the other tab does not.
    const tabs = screen.getAllByTestId('terminal-tab');
    expect(tabs[0]!.textContent).toContain('Needs attention');
    expect(tabs[1]!.textContent).not.toContain('Needs attention');
  });

  it('an ended program reads Ended', async () => {
    fakes.panes = [pane({ state: 'exited', status: 'exited', exitCode: 0 })];
    await mount();
    expect(screen.getByTestId('pane-status-chip').textContent).toBe('Ended');
  });
});

describe('tabs, splits and the layout (story 16.4)', () => {
  it('shows the active tab only: its split panes connect, the other tab\'s do not', async () => {
    two();
    await mount();
    expect(screen.getAllByTestId('pane')).toHaveLength(2);
    // The other tab's pane is not connected.
    expect(fakes.connections).toHaveLength(2);
    expect(screen.getAllByTestId('terminal-tab').map((t) => t.textContent)).toEqual(['Main', 'Other']);
    expect(screen.getAllByTestId('layout-divider')).toHaveLength(1);
  });

  it('switching tab saves the active tab, closes the old tab\'s sockets and shows the other tab\'s pane', async () => {
    two();
    await mount();
    fireEvent.click(screen.getAllByTestId('terminal-tab')[1]!);
    await settle();
    expect(puts().at(-1).activeTabId).toBe('tb');
    expect(screen.getAllByTestId('pane')).toHaveLength(1);
    expect(fakes.connections.filter((c) => c.closed)).toHaveLength(2);
  });

  it('a split does not reconnect the pane that was already shown (panes stay mounted as the layout changes)', async () => {
    const a = pane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WA', title: 'Terminal 1', state: 'running' });
    fakes.panes = [a];
    await mount();
    expect(fakes.connections).toHaveLength(1);
    const b = pane({ id: 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2WB', title: 'Terminal 2', state: 'running' });
    fakes.panes = [a, b];
    fakes.layout = { tabs: [{ id: 'ta', title: 'Main', root: { type: 'split', direction: 'row', ratio: 0.5, first: { type: 'pane', paneId: a.id }, second: { type: 'pane', paneId: b.id } } }], activeTabId: 'ta' };
    fireEvent.click(screen.getByTestId('pane-split-row'));
    await settle();
    expect(screen.getAllByTestId('pane')).toHaveLength(2);
    expect(fakes.connections).toHaveLength(2);
    expect(fakes.connections[0]!.closed).toBe(false);
  });

  it('a drag of the divider saves its new ratio once, and a click without a move saves nothing', async () => {
    two();
    await mount();
    const stage = screen.getByTestId('layout-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON() {} });
    const divider = screen.getByTestId('layout-divider');
    fireEvent.pointerDown(divider, { clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(divider, { clientX: 500, clientY: 100, pointerId: 1 });
    await settle();
    expect(puts()).toHaveLength(0);
    fireEvent.pointerDown(divider, { clientX: 500, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientX: 300, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(divider, { clientX: 300, clientY: 100, pointerId: 1 });
    await settle();
    expect(puts()).toHaveLength(1);
    expect(puts()[0].tabs[0].root.ratio).toBeCloseTo(0.3);
  });

  it('only a pane the user just opened takes keyboard focus', async () => {
    two();
    await mount();
    expect(fakes.terminals.every((t) => (t as { focused?: number }).focused === undefined || (t as { focused: number }).focused === 0)).toBe(true);
  });

  it('a divider moves with the arrow keys, 5 percent each, and is saved', async () => {
    two();
    await mount();
    const divider = screen.getByTestId('layout-divider');
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    await settle();
    expect(puts().at(-1).tabs[0].root.ratio).toBeCloseTo(0.55);
    for (let i = 0; i < 2; i += 1) {
      fireEvent.keyDown(screen.getByTestId('layout-divider'), { key: 'ArrowLeft' });
      await settle();
    }
    expect(puts().at(-1).tabs[0].root.ratio).toBeCloseTo(0.45);
    // At the end of its range a divider stops: 10 percent is the smallest.
    for (let i = 0; i < 12; i += 1) {
      fireEvent.keyDown(screen.getByTestId('layout-divider'), { key: 'ArrowLeft' });
      await settle();
    }
    expect(puts().at(-1).tabs[0].root.ratio).toBeCloseTo(0.1);
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
