// @vitest-environment happy-dom
/**
 * The app shortcut banner shows once (epic 26, 26.5), in a DOM: the first
 * load with the offer pending shows it and marks the offer answered on the
 * server with one plain call, and it stays for that load; Not now and a
 * working Add close it; never on Welcome, on a first run on its way there,
 * or where the shortcut is unsupported. Help lists Keyboard shortcuts, the
 * shortcut tip (only when supported and not installed; it shows the banner
 * again) and Welcome. The REST calls go to a fake `tabAuth.fetch`; the
 * router is a stand-in.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: { platform: 'darwin', supported: true, installed: false, offerPending: true },
  welcomeCompleted: true,
  pathname: '/',
  calls: [] as string[],
  markFails: false,
}));

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/app-shortcut/offer')) {
        if (state.markFails) return new Response(JSON.stringify({ error: { code: 'internal', message: 'Not saved.' } }), { status: 500 });
        state.status = { ...state.status, offerPending: false };
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/app-shortcut') && method === 'POST') {
        state.status = { ...state.status, installed: true, offerPending: false };
        return Response.json(state.status, { status: 201 });
      }
      if (path.endsWith('/app-shortcut')) return Response.json(state.status);
      if (path.endsWith('/onboarding')) return Response.json({ welcomeCompleted: state.welcomeCompleted });
      return new Response('{}', { status: 404 });
    },
  },
}));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: state.pathname } }),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const { AppShortcutOffer, resetAppShortcutOffer } = await import('../src/shell/app-shortcut-offer');
const { HelpMenu, HELP_ITEMS } = await import('../src/shell/help-menu');
const { keyboardShortcuts } = await import('../src/shell/keyboard-shortcuts');
const { SidebarProvider } = await import('../src/ui/sidebar');
const { TooltipProvider } = await import('../src/ui/tooltip');

const marks = () => state.calls.filter((call) => call === 'DELETE /api/v1/app-shortcut/offer').length;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <HelpMenu />
          <AppShortcutOffer />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const openHelp = () => fireEvent.pointerDown(screen.getByTestId('help-menu'), { button: 0, ctrlKey: false, pointerType: 'mouse' });

beforeEach(() => {
  state.status = { platform: 'darwin', supported: true, installed: false, offerPending: true };
  state.welcomeCompleted = true;
  state.pathname = '/';
  state.calls = [];
  state.markFails = false;
  resetAppShortcutOffer();
});

afterEach(cleanup);

describe('the shortcut banner shows once (26.5)', () => {
  it('first load: shows, marks the offer answered once, and stays shown', async () => {
    mount();
    expect(await screen.findByTestId('app-shortcut-offer')).toBeTruthy();
    await waitFor(() => expect(marks()).toBe(1));
    expect(screen.getByTestId('app-shortcut-offer').textContent).toContain('Open Ogden Agents from your apps menu next time.');
  });

  it('a load after it was seen has no banner', async () => {
    state.status = { ...state.status, offerPending: false };
    mount();
    await waitFor(() => expect(state.calls).toContain('GET /api/v1/onboarding'));
    await act(async () => {});
    expect(screen.queryByTestId('app-shortcut-offer')).toBeNull();
    expect(marks()).toBe(0);
  });

  it('a failed mark still shows the banner', async () => {
    state.markFails = true;
    mount();
    expect(await screen.findByTestId('app-shortcut-offer')).toBeTruthy();
    await waitFor(() => expect(marks()).toBe(1));
    expect(screen.getByTestId('app-shortcut-offer')).toBeTruthy();
  });

  it('Not now closes it', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('app-shortcut-offer')).toBeNull();
  });

  it('a working Add closes it', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add shortcut' }));
    await waitFor(() => expect(screen.queryByTestId('app-shortcut-offer')).toBeNull());
    expect(state.calls).toContain('POST /api/v1/app-shortcut');
  });

  it('never on Welcome, nor on a first run on its way there, and nothing is marked', async () => {
    state.pathname = '/welcome';
    const view = mount();
    await waitFor(() => expect(state.calls).toContain('GET /api/v1/app-shortcut'));
    await act(async () => {});
    expect(screen.queryByTestId('app-shortcut-offer')).toBeNull();
    view.unmount();

    state.pathname = '/';
    state.welcomeCompleted = false;
    mount();
    await waitFor(() => expect(state.calls).toContain('GET /api/v1/onboarding'));
    await act(async () => {});
    expect(screen.queryByTestId('app-shortcut-offer')).toBeNull();
    expect(marks()).toBe(0);
  });

  it('never where the shortcut is unsupported (the desktop app)', async () => {
    state.status = { platform: 'darwin', supported: false, installed: false, offerPending: false };
    mount();
    await waitFor(() => expect(state.calls).toContain('GET /api/v1/onboarding'));
    await act(async () => {});
    expect(screen.queryByTestId('app-shortcut-offer')).toBeNull();
    expect(marks()).toBe(0);
  });
});

describe('Help (26.5)', () => {
  it('lists Keyboard shortcuts, the shortcut tip and Welcome; the tip shows the banner again', async () => {
    state.status = { ...state.status, offerPending: false };
    mount();
    await waitFor(() => expect(state.calls).toContain('GET /api/v1/app-shortcut'));
    await act(async () => {});
    openHelp();
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([HELP_ITEMS.shortcuts, HELP_ITEMS.appShortcut, HELP_ITEMS.welcome]);
    expect(within(menu).getByRole('menuitem', { name: 'Welcome' }).getAttribute('href')).toBe('/welcome');
    expect(screen.queryByTestId('app-shortcut-offer')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: HELP_ITEMS.appShortcut }));
    expect(await screen.findByTestId('app-shortcut-offer')).toBeTruthy();
  });

  it('has no tip once the shortcut is installed, or where it is unsupported', async () => {
    for (const status of [
      { platform: 'darwin', supported: true, installed: true, offerPending: false },
      { platform: 'darwin', supported: false, installed: false, offerPending: false },
    ]) {
      state.status = status;
      state.calls = [];
      const view = mount();
      await waitFor(() => expect(state.calls).toContain('GET /api/v1/app-shortcut'));
      await act(async () => {});
      openHelp();
      const menu = await screen.findByRole('menu');
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([HELP_ITEMS.shortcuts, HELP_ITEMS.welcome]);
      view.unmount();
    }
  });

  it('Keyboard shortcuts opens a dialog with the table', async () => {
    mount();
    openHelp();
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: HELP_ITEMS.shortcuts }));
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getAllByRole('table').map((table) => table.querySelector('caption')?.textContent)).toEqual(['Go to', 'Sidebar', 'Chat']);
    expect(within(dialog).getByText('Rename the chat')).toBeTruthy();
  });

  it('the shortcuts table has the shortcuts that exist, with no dashes in its words', () => {
    const rows = keyboardShortcuts('Macintosh').flatMap((group) => group.shortcuts);
    expect(rows.map((row) => row.keys.map((press) => press.join('+')).join(' '))).toEqual(['⌘K', 'g n', '⌘N', 'g c', 'g s', 'g p', 'g b', 'g r', 'g o', 'g t', 'g y', ']', '[', 'F2', 'Enter', '1', '2', '3', '⌘.']);
    expect(keyboardShortcuts('Windows').at(-1)?.shortcuts.at(-1)?.keys).toEqual([['Ctrl+.']]);
    // 26.3: the palette and both New chat ways in, spelled for the platform.
    expect(keyboardShortcuts('Windows')[0]!.shortcuts.slice(0, 3).map((row) => [row.keys, row.action, row.where])).toEqual([
      [[['Ctrl+K']], 'Command palette', undefined],
      [[['g'], ['n']], 'New chat', 'In a project; elsewhere opens the palette'],
      [[['Ctrl+N']], 'New chat', 'In the desktop app; a browser tab keeps it'],
    ]);
    for (const row of rows) expect(`${row.action} ${row.where ?? ''}`).not.toMatch(/[–—]/);
  });
});
