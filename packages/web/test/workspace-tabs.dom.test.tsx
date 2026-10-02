// @vitest-environment happy-dom
/**
 * The header's project tabs with their real queries (story 10.6): Chats alone
 * while the project's settings load or fail, including a refetch that fails
 * after a good load (the query keeps its last data then). Story 4.6: `g`
 * then a shown tab's key opens it (`g c`, `g p`, `g b`), a tab that isn't
 * shown has no shortcut, and a key with a modifier, a repeat, one handled
 * already, or one typed into a field (the composer, the terminal) opens
 * nothing. The REST call, the event stream, the appearance and the router
 * are stand-ins.
 */
import { API_ROUTES, apiPath, BMAD_COMING_SOON_REASON } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const fake = vi.hoisted(() => ({
  /** What the settings GET does: never answer, answer, or fail. */
  settings: 'pending' as 'pending' | 'ok' | 'fail',
  /** The project's pieces when the settings answer. */
  pieces: ['planning'] as string[],
  /** Whether Board ships on this install. */
  boardAvailable: false,
  /** Every `navigate` call. */
  navigations: [] as unknown[],
  developerMode: false,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => (options: unknown) => {
    fake.navigations.push(options);
    return Promise.resolve();
  },
  Link: ({ children, to: _to, params: _params, activeOptions: _activeOptions, ...props }: { children: ReactNode; to: string; params: unknown; activeOptions: unknown }) => (
    <a href="/" {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));
vi.mock('@/appearance/appearance-provider', () => ({ useAppearance: () => ({ appearance: { developerMode: fake.developerMode }, update: () => {} }) }));
vi.mock('@/chat/chat-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/chat-api')>()),
  call: async (_auth: unknown, path: string) => {
    if (path === API_ROUTES.bmadPieces) {
      return {
        pieces: [
          { piece: 'planning', available: true },
          fake.boardAvailable ? { piece: 'board', available: true } : { piece: 'board', available: false, reason: BMAD_COMING_SOON_REASON },
          { piece: 'builds', available: false, reason: BMAD_COMING_SOON_REASON },
          { piece: 'retrospectives', available: false, reason: BMAD_COMING_SOON_REASON },
        ],
      };
    }
    if (path === apiPath(API_ROUTES.workspaceSettings, { wsId: WS })) {
      if (fake.settings === 'pending') return new Promise(() => {});
      if (fake.settings === 'fail') throw new Error("Ogden Agents couldn't load this project's settings");
      return { settings: { cautionLevel: 'ask_every_time', bmadPieces: fake.pieces } };
    }
    throw new Error(`unexpected call ${path}`);
  },
}));

const { WorkspaceTabs, WORKSPACE_TAB_SLOTS } = await import('../src/shell/workspace-tabs');
const { TooltipProvider } = await import('../src/ui/tooltip');

/** The slots as story 4.1 fills them (Plan and Board have pages). */
const PLAN_FILLED = WORKSPACE_TAB_SLOTS;

/** Lets the queries settle and React Query's batched notifications (a timer) reach the component. */
async function flush() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorkspaceTabs wsId={WS} active="chats" slots={PLAN_FILLED} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await flush();
  return client;
}

const tabs = () => screen.getAllByRole('link').map((link) => link.textContent);

afterEach(() => {
  cleanup();
  fake.settings = 'pending';
  fake.pieces = ['planning'];
  fake.boardAvailable = false;
  fake.navigations = [];
  fake.developerMode = false;
});

describe('WorkspaceTabs with its queries (story 10.6)', () => {
  it('shows Chats only while the settings load', async () => {
    fake.settings = 'pending';
    await mount();
    expect(tabs()).toEqual(['Chats']);
  });

  it('shows Chats only when the settings fail', async () => {
    fake.settings = 'fail';
    await mount();
    expect(tabs()).toEqual(['Chats']);
  });

  it('shows the piece tab after a good load, and Chats only once a refetch fails', async () => {
    fake.settings = 'ok';
    const client = await mount();
    expect(tabs()).toEqual(['Chats', 'Plan']);
    fake.settings = 'fail';
    await act(async () => {
      await client.refetchQueries({ queryKey: ['workspace-settings', WS] });
    });
    await flush();
    expect(client.getQueryData(['workspace-settings', WS])).toBeDefined();
    expect(tabs()).toEqual(['Chats']);
  });
});

describe('the g shortcuts (story 4.6)', () => {
  const press = (key: string, init: Partial<KeyboardEventInit> = {}, target: Element = document.body) => fireEvent.keyDown(target, { key, bubbles: true, ...init });
  const go = (key: string) => {
    press('g');
    press(key);
  };
  const went = () => fake.navigations.map((options) => (options as { to: string }).to);

  beforeEach(() => {
    fake.settings = 'ok';
    fake.pieces = ['planning', 'board'];
    fake.boardAvailable = true;
  });

  it('with Planning and Board on, g p, g b and g c open Plan, Board and Chats', async () => {
    await mount();
    expect(tabs()).toEqual(['Chats', 'Plan', 'Board']);
    go('p');
    go('b');
    go('c');
    expect(went()).toEqual(['/w/$wsId/plan', '/w/$wsId/board', '/w/$wsId']);
    expect(fake.navigations[0]).toEqual({ to: '/w/$wsId/plan', params: { wsId: WS } });
  });

  it('with Planning off, g p does nothing (no tab, no shortcut); g r, with no Runs tab, neither', async () => {
    fake.pieces = ['board'];
    await mount();
    expect(tabs()).toEqual(['Chats', 'Board']);
    go('p');
    go('r');
    expect(went()).toEqual([]);
    go('b');
    expect(went()).toEqual(['/w/$wsId/board']);
  });

  it('ignores a key typed into a field, with a modifier, on repeat, or already handled; a lone p or a late one', async () => {
    await mount();
    const composer = document.createElement('textarea');
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    for (const field of [composer, input, editable]) document.body.append(field);
    try {
      // Typing "gp" in the composer (or the terminal's textarea), an input or an editable element.
      for (const field of [composer, input, editable]) {
        field.focus();
        press('g', {}, field);
        press('p', {}, field);
      }
      (document.activeElement as HTMLElement | null)?.blur();
      for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
        press('g', { [modifier]: true });
        press('p');
        press('g');
        press('p', { [modifier]: true });
      }
      press('g', { repeat: true });
      press('p');
      press('p');
      const handled = new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true });
      handled.preventDefault();
      document.body.dispatchEvent(handled);
      press('p');
      expect(went()).toEqual([]);

      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        press('g');
        vi.setSystemTime(Date.now() + 1600);
        press('p');
        expect(went()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
      go('p');
      expect(went()).toEqual(['/w/$wsId/plan']);
    } finally {
      for (const field of [composer, input, editable]) field.remove();
    }
  });

  it('ignores g shortcuts pressed inside an open dialog or menu', async () => {
    await mount();
    for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', role);
      const button = document.createElement('button');
      overlay.append(button);
      document.body.append(overlay);
      try {
        button.focus();
        press('g', {}, button);
        press('p', {}, button);
      } finally {
        overlay.remove();
      }
    }
    expect(went()).toEqual([]);
  });

  it('shows no hint with Developer mode off; in Developer mode a tab’s tooltip shows its keys on focus', async () => {
    await mount();
    expect(screen.getByTestId('workspace-tab-plan').getAttribute('title')).toBeNull();
    expect(screen.getByTestId('workspace-tab-plan').getAttribute('aria-keyshortcuts')).toBeNull();
    act(() => screen.getByTestId('workspace-tab-plan').focus());
    await flush();
    expect(screen.queryByTestId('workspace-tab-hint-plan')).toBeNull();
    cleanup();
    fake.developerMode = true;
    await mount();
    act(() => screen.getByTestId('workspace-tab-board').focus());
    await flush();
    const hint = screen.getByTestId('workspace-tab-hint-board');
    expect([...hint.querySelectorAll('kbd')].map((key) => key.textContent)).toEqual(['g', 'b']);
  });
});
