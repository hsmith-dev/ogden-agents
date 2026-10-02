// @vitest-environment happy-dom
/**
 * The header's project tabs with their real queries (story 10.6): Chats alone
 * while the project's settings load or fail, including a refetch that fails
 * after a good load (the query keeps its last data then). The REST call, the
 * event stream and the router's Link are stand-ins.
 */
import { API_ROUTES, apiPath, BMAD_COMING_SOON_REASON } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const fake = vi.hoisted(() => ({
  /** What the settings GET does: never answer, answer, or fail. */
  settings: 'pending' as 'pending' | 'ok' | 'fail',
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to: _to, params: _params, activeOptions: _activeOptions, ...props }: { children: ReactNode; to: string; params: unknown; activeOptions: unknown }) => (
    <a href="/" {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [] }) }));
vi.mock('@/chat/chat-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/chat/chat-api')>()),
  call: async (_auth: unknown, path: string) => {
    if (path === API_ROUTES.bmadPieces) {
      return {
        pieces: [
          { piece: 'planning', available: true },
          { piece: 'board', available: false, reason: BMAD_COMING_SOON_REASON },
          { piece: 'builds', available: false, reason: BMAD_COMING_SOON_REASON },
          { piece: 'retrospectives', available: false, reason: BMAD_COMING_SOON_REASON },
        ],
      };
    }
    if (path === apiPath(API_ROUTES.workspaceSettings, { wsId: WS })) {
      if (fake.settings === 'pending') return new Promise(() => {});
      if (fake.settings === 'fail') throw new Error("Ogden Agents couldn't load this project's settings");
      return { settings: { cautionLevel: 'ask_every_time', bmadPieces: ['planning'] } };
    }
    throw new Error(`unexpected call ${path}`);
  },
}));

const { WorkspaceTabs, WORKSPACE_TAB_SLOTS } = await import('../src/shell/workspace-tabs');

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
      <WorkspaceTabs wsId={WS} active="chats" slots={PLAN_FILLED} />
    </QueryClientProvider>,
  );
  await flush();
  return client;
}

const tabs = () => screen.getAllByRole('link').map((link) => link.textContent);

afterEach(() => {
  cleanup();
  fake.settings = 'pending';
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
