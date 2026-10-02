// @vitest-environment happy-dom
/**
 * BMad Method's setup panel (story 4.3), in a DOM: Plan's and Board's gate
 * shows the panel instead of the page when the lstat-only detection says
 * there is no `_bmad/` (and the page when there is, or while it loads); Set
 * up posts once, the progress list follows the workspace's `bmad.setup_*`
 * events (each step done, current or pending), a failure shows its plain
 * reason and Set up again, and a completed setup says "Ready to plan." and
 * makes the detection, status, catalog and tickets stale. A refused start
 * (`bmad_already_set_up`) says why. The REST calls go to a fake
 * `tabAuth.fetch`; the events come from a fake stream.
 */
import {
  BMAD_ALREADY_SET_UP_MESSAGE,
  BMAD_NOT_SET_UP_TEXT,
  BMAD_SETUP_DONE_TEXT,
  BMAD_SETUP_FAILURE_REASONS,
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_UNUSABLE_TEXT,
  type CoreEvent,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const state = vi.hoisted(() => ({
  hasBmad: false as boolean | 'pending',
  calls: [] as string[],
  post: undefined as undefined | { status: number; body: unknown },
  events: [] as CoreEvent[],
  listeners: new Set<() => void>(),
  caughtUp: true,
}));

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/bmad/detection')) {
        if (state.hasBmad === 'pending') return new Promise(() => {});
        return Response.json({ detection: { hasBmad: state.hasBmad, hasOutput: false, offerDismissed: false } });
      }
      if (path.endsWith('/bmad/setup') && method === 'POST') {
        const answer = state.post ?? { status: 202, body: { started: true, setup: { state: 'not_set_up', outputFolder: null, bundledVersion: '7.0.0', installedVersion: null, problems: [] } } };
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

vi.mock('@/events/event-stream', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useEventStream: () => {
      const events = useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () => state.events,
      );
      return { events, lastSeq: events.at(-1)?.seq ?? 0, caughtUp: state.caughtUp };
    },
  };
});

const { BmadSetupGate } = await import('../src/planning/bmad-setup-panel');
const { TooltipProvider } = await import('../src/ui/tooltip');

let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <BmadSetupGate wsId={WS}>
          <p data-testid="page-content">The page</p>
        </BmadSetupGate>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

let nextSeq = 1;
const emit = (...events: Array<{ type: string; payload: unknown }>) =>
  act(() => {
    state.events = [...state.events, ...events.map((event) => ({ ...event, seq: nextSeq++, workspaceId: WS, streamId: WS, ts: '2026-10-02T00:00:00.000Z' }) as unknown as CoreEvent)];
    for (const listener of state.listeners) listener();
  });

const steps = () => screen.getAllByTestId('bmad-setup-step').map((step) => step.getAttribute('data-state'));

beforeEach(() => {
  state.hasBmad = false;
  state.calls = [];
  state.post = undefined;
  state.events = [];
  state.listeners.clear();
  state.caughtUp = true;
});
afterEach(cleanup);

describe('BmadSetupGate (story 4.3)', () => {
  it('shows the page while the detection loads, and when the project has _bmad/', async () => {
    state.hasBmad = 'pending';
    mount();
    expect(screen.getByTestId('page-content')).toBeTruthy();
    cleanup();
    state.hasBmad = true;
    mount();
    await settle();
    expect(screen.getByTestId('page-content')).toBeTruthy();
    expect(screen.queryByTestId('bmad-setup-panel')).toBeNull();
  });

  it('without _bmad/: the sentence and Set up; the progress follows the events, then Ready to plan. and the queries go stale', async () => {
    mount();
    await settle();
    expect(screen.queryByTestId('page-content')).toBeNull();
    expect(screen.getByTestId('bmad-setup-text').textContent).toBe(BMAD_NOT_SET_UP_TEXT);
    fireEvent.click(screen.getByTestId('bmad-set-up'));
    await settle();
    expect(state.calls.filter((call) => call.startsWith('POST'))).toEqual([`POST /api/v1/workspaces/${WS}/bmad/setup`]);
    expect(screen.getByTestId('bmad-setup-panel').getAttribute('data-phase')).toBe('starting');
    // A second press while it starts sends nothing.
    fireEvent.click(screen.getByTestId('bmad-set-up'));
    expect(state.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);

    emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_progress', payload: { step: 'checking', label: BMAD_SETUP_STEP_LABELS.checking } });
    expect(steps()).toEqual(['current', 'pending', 'pending', 'pending']);
    emit(
      { type: 'bmad.setup_progress', payload: { step: 'copying_skills', label: BMAD_SETUP_STEP_LABELS.copying_skills } },
      { type: 'bmad.setup_progress', payload: { step: 'writing_config', label: BMAD_SETUP_STEP_LABELS.writing_config } },
    );
    expect(steps()).toEqual(['done', 'done', 'current', 'pending']);

    const invalidated: string[] = [];
    const original = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
      invalidated.push(String(filters?.queryKey?.[0]));
      return original(filters);
    }) as typeof client.invalidateQueries;
    // The setup wrote `_bmad/`: the detection the completion makes stale answers it.
    state.hasBmad = true;
    emit({ type: 'bmad.setup_completed', payload: { status: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } } });
    expect(screen.getByTestId('bmad-setup-done').textContent).toBe(BMAD_SETUP_DONE_TEXT);
    expect(invalidated.sort()).toEqual(['bmad-detection', 'bmad-setup', 'catalog', 'tickets']);
    // The page shows, with the done line above it.
    await settle();
    expect(screen.getByTestId('page-content')).toBeTruthy();
    expect(screen.getByTestId('bmad-setup-done').textContent).toBe(BMAD_SETUP_DONE_TEXT);
  });

  it('a failure shows its plain reason and Set up again, which posts again', async () => {
    mount();
    await settle();
    emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_progress', payload: { step: 'checking', label: BMAD_SETUP_STEP_LABELS.checking } });
    emit({ type: 'bmad.setup_failed', payload: { reason: BMAD_SETUP_FAILURE_REASONS.uv_missing } });
    expect(screen.getByTestId('bmad-setup-failed').textContent).toContain(BMAD_SETUP_FAILURE_REASONS.uv_missing);
    expect(steps()).toEqual(['failed', 'pending', 'pending', 'pending']);
    fireEvent.click(screen.getByTestId('bmad-set-up-again'));
    await settle();
    expect(state.calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);
  });

  it('a refused start (already set up: a _bmad link or file) says the setup is unusable and offers no Set up loop (Q7)', async () => {
    state.post = { status: 409, body: { error: { code: 'bmad_already_set_up', message: BMAD_ALREADY_SET_UP_MESSAGE } } };
    mount();
    await settle();
    fireEvent.click(screen.getByTestId('bmad-set-up'));
    await settle();
    expect(screen.getByTestId('bmad-setup-unusable').textContent).toContain(BMAD_SETUP_UNUSABLE_TEXT);
    expect(screen.queryByTestId('bmad-set-up')).toBeNull();
  });

  it('a setup that ended before this view (replayed history) shows no done or failed line (Q3)', async () => {
    state.caughtUp = false;
    state.hasBmad = true;
    mount();
    // The backlog replays a finished setup, then the stream is caught up.
    emit({ type: 'bmad.setup_started', payload: {} }, { type: 'bmad.setup_completed', payload: { status: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } } });
    state.caughtUp = true;
    emit({ type: 'workspace.settings_changed', payload: {} });
    await settle();
    expect(screen.getByTestId('page-content')).toBeTruthy();
    expect(screen.queryByTestId('bmad-setup-done')).toBeNull();
    cleanup();

    // A failure already in the window when the view opens: Set up, not the old failure.
    state.hasBmad = false;
    mount();
    await settle();
    expect(screen.queryByTestId('bmad-setup-failed')).toBeNull();
    expect(screen.getByTestId('bmad-set-up')).toBeTruthy();
  });
});
