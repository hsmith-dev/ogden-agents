// @vitest-environment happy-dom
/**
 * Story 5.8 in the web app: the build session's header (Stop while running or
 * queued, the plain reason and Retry when blocked, failed or stopped,
 * Continue at a checkpoint), Queued on a ticket's card, and the limits
 * fields (a changed valid value saves; an out-of-bounds one cannot).
 */
import { RunsResponse, TicketsResponse, type Run } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const base = {
  id: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W5',
  workspaceId: WS,
  sessionId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4',
  ticketRef: '1.1',
  worktreePath: '/data/w/abcdefgh',
  sandbox: 'seatbelt',
  deadline: null,
  outcome: 'running',
  reason: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};
const run = (fields: Record<string, unknown>): Run => ({ ...base, ...fields }) as unknown as Run;

const state = vi.hoisted(() => ({ calls: [] as string[], bodies: [] as unknown[], runs: undefined as unknown, limits: { maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 }, settings: { maxConcurrentRuns: 2, testCommand: null } }));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string; ref?: string } }) => (
    <a href={to.replace('$wsId', params.wsId).replace('$ref', params.ref ?? '')} {...props}>
      {children}
    </a>
  ),
}));
const answer = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (init.body !== undefined) state.bodies.push(JSON.parse(String(init.body)));
      if (path.endsWith('/tickets')) {
        return answer(TicketsResponse.parse({ tickets: [{ ref: '1.1', id: 1, epic: 'epic-first', title: 'First', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '' }], problems: [] }));
      }
      if (method === 'GET' && path.endsWith('/runs')) return answer(state.runs ?? { runs: [], queue: [] });
      if (method === 'POST' && (path.endsWith('/stop') || path.endsWith('/retry'))) return answer({ run: { ...base, outcome: 'running' } });
      if (path.endsWith('/run-limits')) {
        if (method === 'PATCH') {
          Object.assign(state.limits, init.body === undefined ? {} : JSON.parse(String(init.body)));
        }
        return answer({ settings: state.limits });
      }
      if (path.endsWith('/build-settings')) {
        if (method === 'PATCH') Object.assign(state.settings, JSON.parse(String(init.body)));
        return answer({ settings: state.settings });
      }
      return new Response('{}', { status: 404 });
    },
  },
}));

const { BuildRunHeader } = await import('../src/planning/build-run-header');
const { InstallBuildLimits, ProjectBuildLimit } = await import('../src/planning/build-limit-fields');
const { BoardTickets } = await import('../src/planning/board-tickets');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { AppearanceProvider } = await import('../src/appearance/appearance-provider');

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  state.calls.length = 0;
  state.bodies.length = 0;
  state.runs = undefined;
  state.limits = { maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 };
  state.settings = { maxConcurrentRuns: 2, testCommand: null };
});
afterEach(() => cleanup());

describe("a build session's header (story 5.8)", () => {
  it('shows Stop while it runs, and Stop calls the run', async () => {
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'running' })} />);
    expect(screen.getByTestId('build-run-outcome').textContent).toBe('Building');
    expect(screen.queryByTestId('build-run-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('build-run-stop'));
    await settle();
    expect(state.calls).toContain(`POST /api/v1/workspaces/${WS}/runs/${base.id}/stop`);
  });

  it('a queued run says Queued and can be stopped', () => {
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'running', queuePosition: 1, worktreePath: null })} />);
    expect(screen.getByTestId('build-run-outcome').textContent).toBe('Queued');
    expect(screen.getByTestId('build-run-stop')).toBeTruthy();
  });

  it('a blocked run shows its plain reason and Retry, which calls the run', async () => {
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'blocked', blockedCode: 'time_limit', reason: 'Stopped after 45 minutes without finishing.' })} />);
    expect(screen.getByTestId('build-run-outcome').textContent).toBe('Blocked');
    expect(screen.getByTestId('build-run-reason').textContent).toBe('Stopped after 45 minutes without finishing.');
    expect(screen.queryByTestId('build-run-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('build-run-retry'));
    await settle();
    expect(state.calls).toContain(`POST /api/v1/workspaces/${WS}/runs/${base.id}/retry`);
  });

  it('failed and stopped runs offer Retry; a checkpoint pause offers Continue the build; a run for review offers neither; a merge conflict is the review page\'s', () => {
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'failed', reason: '3 tests failed when re-run' })} />);
    expect(screen.getByTestId('build-run-retry').textContent).toBe('Retry');
    cleanup();
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'stopped', reason: 'You stopped this build.' })} />);
    expect(screen.getByTestId('build-run-outcome').textContent).toBe('Stopped');
    expect(screen.getByTestId('build-run-retry')).toBeTruthy();
    cleanup();
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'blocked', blockedCode: 'checkpoint_plan', reason: 'The plan is ready. Check it, then continue the build.' })} />);
    expect(screen.getByTestId('build-run-retry').textContent).toBe('Continue the build');
    expect(screen.queryByTestId('build-run-review')).toBeNull();
    cleanup();
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'verified' })} />);
    expect(screen.queryByTestId('build-run-retry')).toBeNull();
    expect(screen.getByTestId('build-run-review')).toBeTruthy();
    cleanup();
    mount(<BuildRunHeader wsId={WS} run={run({ outcome: 'blocked', blockedCode: 'merge_conflict', reason: 'x' })} />);
    expect(screen.queryByTestId('build-run-retry')).toBeNull();
  });
});

describe('Queued on a ticket card (story 5.8)', () => {
  it('a ticket whose build waits in the queue says Queued in place of Build', async () => {
    state.runs = RunsResponse.parse({ runs: [], queue: [{ runId: base.id, ticketRef: '1.1', position: 1 }] });
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    expect(screen.getByTestId('ticket-queued').textContent).toBe('Queued');
    expect(screen.queryByTestId('ticket-build')).toBeNull();
  });

  it('without a queue the card has Build', async () => {
    mount(<BoardTickets wsId={WS} builds={{ onStarted: () => {} }} />);
    await settle();
    expect(screen.getByTestId('ticket-build')).toBeTruthy();
    expect(screen.queryByTestId('ticket-queued')).toBeNull();
  });
});

describe('the limits (story 5.8)', () => {
  it('a changed valid install limit saves; one out of bounds cannot be saved', async () => {
    mount(<InstallBuildLimits />);
    await settle();
    const field = screen.getByTestId('run-limit-install') as HTMLInputElement;
    expect(field.value).toBe('3');
    expect((screen.getByTestId('run-limit-install-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: '25' } });
    expect((screen.getByTestId('run-limit-install-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('run-limit-install-save'));
    await settle();
    expect(state.bodies).toContainEqual({ maxConcurrentRunsPerInstall: 5 });
    expect(screen.getByTestId('run-limit-install-saved')).toBeTruthy();
    fireEvent.change(screen.getByTestId('run-limit-minutes'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('run-limit-minutes-save'));
    await settle();
    expect(state.bodies).toContainEqual({ maxRunMinutes: 90 });
  });

  it("a project's limit saves through the project's build settings", async () => {
    mount(<ProjectBuildLimit wsId={WS} />);
    await settle();
    fireEvent.change(screen.getByTestId('run-limit-project'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('run-limit-project-save'));
    await settle();
    expect(state.bodies).toContainEqual({ maxConcurrentRuns: 4 });
  });
});
