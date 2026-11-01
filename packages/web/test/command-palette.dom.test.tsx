// @vitest-environment happy-dom
/**
 * The command palette in a DOM (epic 26 story 3): Ctrl+K from the composer
 * opens it with the field focused and the empty query's groups; Ctrl+K again
 * or Esc closes it with focus back in the composer; nothing opens over
 * another dialog, and Ctrl+K in a terminal is the shell's. On Apple
 * devices Cmd+K opens (in a terminal too) and Ctrl+K is the field's;
 * elsewhere Meta+K is not the palette (happy-dom's user agent is Linux's).
 * The field is a combobox over a grouped listbox with the selected
 * option as its active descendant; `↑` `↓` wrap; Enter runs; the count is
 * announced; no match says so. Tickets show only with the Board on; "New
 * chat in..." lists projects and Esc or Backspace goes back; Show every step
 * switches the chat's level and returns focus; kbd hints only in Developer
 * mode. The router, the sidebar data and the REST reads are stand-ins.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pathname: '/',
  params: {} as { wsId?: string; sesId?: string },
  navigations: [] as unknown[],
  needsYou: [] as unknown[],
  boardOn: true,
  ticketReads: 0,
  ticketsFail: false,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (options: unknown) => {
    state.navigations.push(options);
    return Promise.resolve();
  },
  useParams: () => state.params,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: state.pathname } }),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  Outlet: () => null,
}));

const row = (wsId: string, sesId: string, title: string) => ({ sesId, wsId, title, userTitle: null, state: 'idle' as const, updatedAt: '2026-10-31T00:00:00.000Z', agentName: 'Claude Code' });
vi.mock('../src/shell/sidebar-data', () => ({
  useSidebarData: () => ({
    model: {
      groups: [
        { wsId: 'ws_a', name: 'Letterpress', rows: [row('ws_a', 'ses_1', 'Fix the login')], earlier: [], summary: [] },
        { wsId: 'ws_b', name: 'Billing', rows: [row('ws_b', 'ses_3', 'Invoice totals')], earlier: [], summary: [] },
      ],
      needsYou: state.needsYou,
    },
  }),
}));
vi.mock('../src/workspaces/workspace-settings-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchWorkspaceSettings: async () => ({ bmadPieces: state.boardOn ? ['board'] : [] }),
  fetchBmadPieces: async () => [{ piece: 'board', available: true }],
}));
vi.mock('../src/planning/planning-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchTickets: async () => {
    state.ticketReads++;
    if (state.ticketsFail) throw new Error('scripts not trusted');
    return { tickets: [{ ref: '1.1', title: 'Build the first thing' }, { ref: '1.2', title: 'Build the second thing' }], problems: [], folder: null, epics: [] };
  },
}));

const { CommandPalette, isPaletteKey } = await import('../src/palette/command-palette');
const { NewChatKeys } = await import('../src/shell/new-chat-keys');
const { NEW_CHAT_EVENT } = await import('../src/chat/new-chat');
const { openCommandPalette, closeCommandPalette } = await import('../src/palette/palette-store');
const { RECENT_CHATS_KEY } = await import('../src/palette/recent-chats');
const { AppearanceProvider } = await import('../src/appearance/appearance-provider');
const { chatDetailOf, resetChatDetailForTests, CHAT_DETAIL_KEY } = await import('../src/chat/detail-level');

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <textarea aria-label="Message Claude Code" data-testid="composer" />
        <div className="xterm">
          <textarea aria-label="Terminal input" data-testid="terminal" />
        </div>
        <div role="dialog" aria-label="Other">
          <button type="button" data-testid="other-dialog-button">
            Other
          </button>
        </div>
        <NewChatKeys />
        <CommandPalette />
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

const palette = () => screen.queryByTestId('command-palette');
const field = () => screen.getByRole('combobox');
const options = () => screen.queryAllByRole('option');
const groupHeadings = () => screen.queryAllByRole('group').map((group) => group.getAttribute('aria-labelledby')).map((id) => document.getElementById(id!)?.textContent);
const ctrlK = (target: Element) => fireEvent.keyDown(target, { key: 'k', ctrlKey: true });
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const composer = () => screen.getByTestId('composer');

beforeEach(() => {
  state.pathname = '/';
  state.params = {};
  state.navigations = [];
  state.needsYou = [];
  state.boardOn = true;
  state.ticketReads = 0;
  state.ticketsFail = false;
  localStorage.clear();
  resetChatDetailForTests();
});

afterEach(() => {
  act(() => closeCommandPalette());
  cleanup();
});

describe('opening and closing', () => {
  it('Ctrl+K in the composer opens it with the field focused on the empty query; Esc closes with focus back', async () => {
    localStorage.setItem(RECENT_CHATS_KEY, JSON.stringify([['ws_b', 'ses_3'], ['ws_x', 'ses_gone']]));
    mount();
    composer().focus();
    ctrlK(composer());
    await waitFor(() => expect(palette()).not.toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(groupHeadings()).toEqual(['Recent chats', 'Actions', 'Projects']);
    expect(within(screen.getByRole('group', { name: 'Recent chats' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Invoice totalsBilling']);
    fireEvent.keyDown(field(), { key: 'Escape' });
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('Ctrl+K while open closes it, focus back', async () => {
    mount();
    composer().focus();
    ctrlK(composer());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    ctrlK(field());
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('nothing opens over another dialog', async () => {
    mount();
    const button = screen.getByTestId('other-dialog-button');
    button.focus();
    ctrlK(button);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(palette()).toBeNull();
  });

  it('the K key on a non-Latin layout opens it; a Latin layout uses its own k', async () => {
    const base = { metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, isComposing: false, target: null };
    expect(isPaletteKey({ ...base, key: 'л', code: 'KeyK' })).toBe(true);
    expect(isPaletteKey({ ...base, key: 'κ', code: 'KeyK' })).toBe(true);
    // Dvorak: the K key types t, and k sits on KeyV.
    expect(isPaletteKey({ ...base, key: 't', code: 'KeyK' })).toBe(false);
    expect(isPaletteKey({ ...base, key: 'k', code: 'KeyV' })).toBe(true);
    mount();
    composer().focus();
    fireEvent.keyDown(composer(), { key: 'л', code: 'KeyK', ctrlKey: true });
    await waitFor(() => expect(palette()).not.toBeNull());
  });

  it('the desktop New Chat event outside a project opens "New chat in...", but never over another dialog', async () => {
    mount();
    screen.getByTestId('other-dialog-button').focus();
    act(() => void window.dispatchEvent(new Event(NEW_CHAT_EVENT)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(palette()).toBeNull();
    composer().focus();
    act(() => void window.dispatchEvent(new Event(NEW_CHAT_EVENT)));
    await waitFor(() => expect(palette()?.getAttribute('data-mode')).toBe('new-chat-in'));
  });

  it('Ctrl+K in a terminal is the shell kill line; Meta+K is not the palette off Apple devices', async () => {
    mount();
    const terminal = screen.getByTestId('terminal');
    terminal.focus();
    ctrlK(terminal);
    fireEvent.keyDown(terminal, { key: 'k', metaKey: true });
    fireEvent.keyDown(composer(), { key: 'k', metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(palette()).toBeNull();
  });

  it('on Apple devices Cmd+K is the key, in a terminal too, and Ctrl+K reaches the field', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
    const linux = 'Mozilla/5.0 (X11; Linux x86_64)';
    const xterm = document.createElement('div');
    xterm.className = 'xterm';
    const inTerminal = document.createElement('textarea');
    xterm.append(inTerminal);
    const base = { key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, target: null };
    expect(isPaletteKey({ ...base, metaKey: true }, mac)).toBe(true);
    expect(isPaletteKey({ ...base, metaKey: true, target: inTerminal }, mac)).toBe(true);
    expect(isPaletteKey({ ...base, ctrlKey: true }, mac)).toBe(false);
    expect(isPaletteKey({ ...base, ctrlKey: true }, linux)).toBe(true);
    expect(isPaletteKey({ ...base, ctrlKey: true, target: inTerminal }, linux)).toBe(false);
    expect(isPaletteKey({ ...base, metaKey: true }, linux)).toBe(false);
  });
});

describe('finding and running', () => {
  it('a combobox controlling a grouped listbox; arrows wrap; the count is announced', async () => {
    mount();
    act(() => openCommandPalette());
    await waitFor(() => expect(palette()).not.toBeNull());
    type('l');
    const listbox = screen.getByRole('listbox');
    expect(field().getAttribute('aria-controls')).toBe(listbox.id);
    const count = options().length;
    expect(count).toBeGreaterThan(2);
    expect(screen.getByTestId('command-palette-status').textContent).toBe(`${count} results`);
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field().getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
  });

  it('a chat in another project by a word of its title: its project shown, Enter opens it', async () => {
    state.params = { wsId: 'ws_a' };
    state.pathname = '/w/ws_a';
    mount();
    act(() => openCommandPalette());
    await waitFor(() => expect(palette()).not.toBeNull());
    type('INVOICE');
    const chats = screen.getByRole('group', { name: 'Chats' });
    expect(within(chats).getAllByRole('option').map((option) => option.textContent)).toEqual(['Invoice totalsBilling']);
    expect(chats.querySelector('[data-slot="command-palette-matched"]')?.textContent).toBe('Invoice');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(palette()).toBeNull());
    expect(state.navigations).toEqual([{ to: '/w/$wsId/s/$sesId', params: { wsId: 'ws_b', sesId: 'ses_3' } }]);
  });

  it('no match says so', async () => {
    mount();
    act(() => openCommandPalette());
    await waitFor(() => expect(palette()).not.toBeNull());
    type('zzzz');
    expect(options()).toHaveLength(0);
    expect(screen.getByTestId('command-palette-empty').textContent).toBe('Nothing matches “zzzz”.');
    expect(screen.getByTestId('command-palette-status').textContent).toBe('Nothing matches “zzzz”.');
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
    // The line is not inside the listbox (which is empty and hidden), and the combobox is collapsed.
    expect(screen.getByTestId('command-palette-empty').closest('[role="listbox"]')).toBeNull();
    expect(screen.getByTestId('command-palette-list').hidden).toBe(true);
    expect(field().getAttribute('aria-expanded')).toBe('false');
    type('');
    expect(field().getAttribute('aria-expanded')).toBe('true');
  });

  it('a run to the page already shown puts focus back where it was', async () => {
    state.pathname = '/settings/appearance';
    mount();
    composer().focus();
    ctrlK(composer());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    type('settings: appearance');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(palette()).toBeNull());
    expect(state.navigations).toEqual([{ to: '/settings/appearance' }]);
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('a ticket by its ref in a project with the Board on opens on the Board', async () => {
    state.params = { wsId: 'ws_a' };
    state.pathname = '/w/ws_a';
    mount();
    act(() => openCommandPalette());
    await waitFor(() => expect(palette()).not.toBeNull());
    type('1.2');
    const tickets = await screen.findByRole('group', { name: 'Tickets' });
    expect(within(tickets).getAllByRole('option').map((option) => option.textContent)).toEqual(['1.2 Build the second thing']);
    fireEvent.click(within(tickets).getAllByRole('option')[0]!);
    expect(state.navigations).toEqual([{ to: '/w/$wsId/board/$ref', params: { wsId: 'ws_a', ref: '1.2' } }]);
  });

  it('Board off, outside a project, or the tickets failing: no Tickets group', async () => {
    state.boardOn = false;
    state.params = { wsId: 'ws_a' };
    const first = mount();
    act(() => openCommandPalette());
    type('1.2');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('group', { name: 'Tickets' })).toBeNull();
    expect(state.ticketReads).toBe(0);
    act(() => closeCommandPalette());
    first.unmount();

    state.boardOn = true;
    state.params = {};
    const second = mount();
    act(() => openCommandPalette());
    type('1.2');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('group', { name: 'Tickets' })).toBeNull();
    expect(state.ticketReads).toBe(0);
    act(() => closeCommandPalette());
    second.unmount();

    state.ticketsFail = true;
    state.params = { wsId: 'ws_a' };
    mount();
    act(() => openCommandPalette());
    type('1.2');
    await waitFor(() => expect(state.ticketReads).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('group', { name: 'Tickets' })).toBeNull();
  });

  it('New chat in a project opens its draft', async () => {
    state.params = { wsId: 'ws_a' };
    mount();
    act(() => openCommandPalette());
    type('new chat');
    expect(options()[0]!.textContent).toBe('New chat');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(state.navigations).toEqual([{ to: '/w/$wsId/new', params: { wsId: 'ws_a' }, search: {} }]);
  });

  it('Go to Needs you opens the next item; with nothing waiting there is no such action', async () => {
    mount();
    act(() => openCommandPalette());
    type('needs');
    expect(options().map((option) => option.textContent)).not.toContain('Go to Needs you');
    act(() => closeCommandPalette());
    cleanup();
    state.needsYou = [{ id: 'req_1', kind: 'permission', wsId: 'ws_a', sesId: 'ses_1' }];
    mount();
    act(() => openCommandPalette());
    type('needs');
    expect(options()[0]!.textContent).toBe('Go to Needs you');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(state.navigations).toEqual([{ to: '/w/$wsId/s/$sesId', params: { wsId: 'ws_a', sesId: 'ses_1' }, hash: 'permission-req_1' }]);
  });

  it('Show every step on a chat switches its level and returns focus; next time it reads Show less detail', async () => {
    state.params = { wsId: 'ws_a', sesId: 'ses_1' };
    state.pathname = '/w/ws_a/s/ses_1';
    mount();
    composer().focus();
    ctrlK(composer());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    type('show every');
    expect(options()[0]!.textContent).toBe('Show every step');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(palette()).toBeNull());
    expect(chatDetailOf('ses_1')).toBe('verbose');
    expect(localStorage.getItem(CHAT_DETAIL_KEY)).toContain('ses_1');
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    act(() => openCommandPalette());
    type('detail');
    expect(options().map((option) => option.textContent)).toContain('Show less detail');
    // The chat on screen is recorded for Recent chats.
    expect(JSON.parse(localStorage.getItem(RECENT_CHATS_KEY)!)).toEqual([['ws_a', 'ses_1']]);
  });

  it('not on a chat: no detail action', async () => {
    state.params = { wsId: 'ws_a' };
    state.pathname = '/w/ws_a';
    mount();
    act(() => openCommandPalette());
    type('show');
    expect(options().map((option) => option.textContent)).not.toContain('Show every step');
  });

  it('kbd hints show in Developer mode only', async () => {
    state.params = { wsId: 'ws_a' };
    mount();
    act(() => openCommandPalette());
    type('new chat');
    expect(options()[0]!.querySelector('kbd')).toBeNull();
    act(() => closeCommandPalette());
    cleanup();
    localStorage.setItem('ogden-agents.appearance', JSON.stringify({ theme: 'system', density: 'compact', developerMode: true }));
    mount();
    act(() => openCommandPalette());
    type('new chat');
    expect([...options()[0]!.querySelectorAll('kbd')].map((kbd) => kbd.textContent)).toEqual(['g', 'n']);
  });
});

describe('New chat in...', () => {
  it('lists the projects; Enter opens that project draft', async () => {
    mount();
    act(() => openCommandPalette('new-chat-in'));
    await waitFor(() => expect(palette()).not.toBeNull());
    expect(screen.getByText('New chat in...')).toBeTruthy();
    expect(options().map((option) => option.textContent)).toEqual(['Letterpress', 'Billing']);
    type('bill');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(palette()).toBeNull());
    expect(state.navigations).toEqual([{ to: '/w/$wsId/new', params: { wsId: 'ws_b' }, search: {} }]);
  });

  it('Backspace on the empty field and Esc go back to everything; the full palette action goes there', async () => {
    mount();
    act(() => openCommandPalette('new-chat-in'));
    await waitFor(() => expect(palette()).not.toBeNull());
    fireEvent.keyDown(field(), { key: 'Backspace' });
    await waitFor(() => expect(palette()!.getAttribute('data-mode')).toBe('all'));
    type('new chat in');
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(palette()!.getAttribute('data-mode')).toBe('new-chat-in'));
    expect(field().getAttribute('value') ?? (field() as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(field(), { key: 'Escape' });
    await waitFor(() => expect(palette()!.getAttribute('data-mode')).toBe('all'));
    expect(palette()).not.toBeNull();
  });

  it('no projects: Nothing matches', async () => {
    mount();
    act(() => openCommandPalette('new-chat-in'));
    type('zzz');
    expect(screen.getByTestId('command-palette-empty').textContent).toBe('Nothing matches “zzz”.');
  });
});
