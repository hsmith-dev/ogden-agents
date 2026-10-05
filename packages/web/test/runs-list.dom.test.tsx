// @vitest-environment happy-dom
/** Story 11.1: the Runs page's list: every run with its outcome and sentence, the queue, links to the run view and the review, and the empty state. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const run = (id: string, ref: string, fields: Record<string, unknown>) => ({
  id: `run_01J9Z3K4M5N6P7Q8R9S0T1V2${id}`,
  workspaceId: WS,
  sessionId: `ses_01J9Z3K4M5N6P7Q8R9S0T1V2${id}`,
  ticketRef: ref,
  worktreePath: '/data/w/abcdefgh',
  sandbox: 'seatbelt',
  deadline: null,
  outcome: 'running',
  reason: null,
  blockedCode: null,
  queuePosition: null,
  decision: null,
  agent: null,
  branch: null,
  baseRevision: null,
  baseBranch: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
  ...fields,
});
const state = vi.hoisted(() => ({ runs: { runs: [], queue: [] } as unknown, fail: false }));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string; ref?: string; sesId?: string } }) => (
    <a href={to.replace('$wsId', params.wsId).replace('$ref', params.ref ?? '').replace('$sesId', params.sesId ?? '')} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string) => {
      if (path.endsWith('/tickets')) return new Response(JSON.stringify({ tickets: [{ ref: '1.1', id: 1, epic: 'e', title: 'First thing', type: 'story', status: 'blocked', state: 'in-progress', blocked_reason: '' }], problems: [] }));
      if (path.endsWith('/runs')) return state.fail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(state.runs));
      return new Response('{}', { status: 404 });
    },
  },
}));

const { RunsList } = await import('../src/planning/runs-list');

const mount = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RunsList wsId={WS} />
    </QueryClientProvider>,
  );
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
afterEach(() => cleanup());

describe('the Runs list (story 11.1)', () => {
  it('lists every run with its state, its plain sentence and its links; a run for review links to its review', async () => {
    state.runs = {
      runs: [
        run('A1', '1.1', { outcome: 'blocked', blockedCode: 'other', reason: 'x' }),
        run('A2', '1.2', { outcome: 'verified' }),
        run('A3', '1.3', { outcome: 'running', queuePosition: 1, worktreePath: null }),
      ],
      queue: [{ runId: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2A3', ticketRef: '1.3', position: 1 }],
    };
    await mount();
    const rows = screen.getAllByTestId('run-row');
    expect(rows.map((row) => row.getAttribute('data-phase'))).toEqual(['needs_you', 'built', 'queued']);
    expect(rows[0]!.textContent).toContain('First thing');
    expect(rows[0]!.textContent).toContain('The build stopped. Show details says why.');
    expect(rows[1]!.querySelector('[data-testid="run-row-review"]')?.getAttribute('href')).toBe('/w/' + WS + '/review/1.2');
    expect(rows[0]!.querySelector('[data-testid="run-row-review"]')).toBeNull();
    expect(rows[0]!.querySelector('[data-testid="run-row-open"]')?.getAttribute('href')).toBe(`/w/${WS}/s/ses_01J9Z3K4M5N6P7Q8R9S0T1V2A1`);
    expect(screen.getByTestId('runs-queue').textContent).toContain('1.3');
  });

  it('says so when there are no runs, and when they could not be loaded', async () => {
    state.runs = { runs: [], queue: [] };
    await mount();
    expect(screen.getByTestId('runs-empty')).toBeTruthy();
    cleanup();
    state.fail = true;
    await mount();
    expect(screen.getByTestId('runs-error').textContent).toBe("The runs couldn't be loaded. Try again.");
    state.fail = false;
  });
});
