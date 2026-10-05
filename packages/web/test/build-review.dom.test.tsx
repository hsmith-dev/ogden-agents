// @vitest-environment happy-dom
/**
 * The designed review page (story 5.9): the plain summary, the three checks
 * (a failing one a cross with its detail), the findings, the diff behind
 * Show the code changes (N files), and the sticky bar: Approve and merge
 * (disabled until every check passes; a watched build's untested check does
 * not hold it back), Update and retry for a conflicting merge, and Reject
 * and retry with an optional note.
 */
import { ReviewResponse } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = {
  id: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W5',
  workspaceId: WS,
  sessionId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4',
  ticketRef: '1.1',
  worktreePath: '/data/w/abcdefgh',
  sandbox: 'seatbelt',
  deadline: null,
  outcome: 'verified',
  reason: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  updatedAt: '2026-10-05T00:00:00.000Z',
};
const checks = (results: Array<'pass' | 'fail' | 'not_run'>, details: Array<string | null> = [null, null, null]) =>
  ['plan_built', 'tests_pass', 'code_changed'].map((id, index) => ({ id, result: results[index], detail: details[index] }));
const verification = (results: Array<'pass' | 'fail' | 'not_run'>, extra: Record<string, unknown> = {}, details?: Array<string | null>) => ({
  outcome: results.every((result) => result === 'pass') || extra.attended === true ? 'verified' : 'failed',
  checks: checks(results, details),
  testCommand: 'npm test',
  testOutputTail: null,
  checkedAt: '2026-10-05T00:00:00.000Z',
  ...extra,
});
const review = (fields: Record<string, unknown>) =>
  ReviewResponse.parse({ run: RUN, outcome: 'verified', reason: null, diff: 'diff --git a/x b/x\n', truncated: false, files: ['src/x.ts', 'README.md'], merged: false, headRevision: 'b'.repeat(40), summary: 'Ticket 1.1 changed 2 files.', verification: verification(['pass', 'pass', 'pass']), findings: [], diffStats: { files: 2, insertions: 3, deletions: 1 }, ...fields });

const state = vi.hoisted(() => ({ review: undefined as unknown, calls: [] as string[], bodies: [] as unknown[] }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { wsId: string; ref?: string; sesId?: string } }) => (
    <a href={to.replace('$wsId', params.wsId)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (init.body !== undefined) state.bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(method === 'POST' && path.endsWith('/retry') ? { run: RUN } : state.review), { status: 200 });
    },
  },
}));
const { BuildReview, canApproveReview } = await import('../src/planning/build-review');
const { TooltipProvider } = await import('../src/ui/tooltip');

function mount(node: ReactNode) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
beforeEach(() => {
  state.calls.length = 0;
  state.bodies.length = 0;
});
afterEach(() => cleanup());

describe('canApproveReview (story 5.9)', () => {
  it('needs a verified, unmerged run with every check passing; a watched build may leave its tests unrun', () => {
    const base = review({});
    expect(canApproveReview(base)).toBe(true);
    expect(canApproveReview({ ...base, merged: true })).toBe(false);
    expect(canApproveReview({ ...base, headRevision: null })).toBe(false);
    expect(canApproveReview({ ...base, outcome: 'failed' })).toBe(false);
    expect(canApproveReview(review({ verification: verification(['pass', 'fail', 'pass']) }))).toBe(false);
    expect(canApproveReview(review({ verification: verification(['pass', 'not_run', 'pass']) }))).toBe(false);
    expect(canApproveReview(review({ verification: verification(['pass', 'not_run', 'pass'], { attended: true }) }))).toBe(true);
  });
});

describe('the review page (story 5.9)', () => {
  it('leads with the summary and the three checks, then the findings, then the diff behind its summary line; Approve is enabled', async () => {
    state.review = review({ findings: [{ kind: 'finding', severity: 'medium', text: 'A check was missing.' }, { kind: 'deferred', severity: 'low', text: 'Tidy later.' }] });
    mount(<BuildReview wsId={WS} ticketRef="1.1" />);
    await settle();
    expect(screen.getByTestId('review-summary').textContent).toBe('Ticket 1.1 changed 2 files.');
    expect(screen.getAllByTestId('review-check').map((item) => item.getAttribute('data-result'))).toEqual(['pass', 'pass', 'pass']);
    expect(screen.getAllByTestId('review-finding').map((item) => item.getAttribute('data-kind'))).toEqual(['finding', 'deferred']);
    expect(screen.getByText('Show the code changes (2 files)')).toBeTruthy();
    expect((screen.getByTestId('review-approve') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a failing check is a cross with its detail, and Approve and merge is disabled', async () => {
    state.review = review({ outcome: 'failed', reason: '3 tests failed when re-run', verification: verification(['pass', 'fail', 'pass'], {}, [null, '3 tests failed when re-run', null]) });
    mount(<BuildReview wsId={WS} ticketRef="1.1" />);
    await settle();
    const failed = screen.getAllByTestId('review-check')[1]!;
    expect(failed.getAttribute('data-result')).toBe('fail');
    expect(failed.textContent).toContain('3 tests failed when re-run');
    expect(screen.queryByTestId('review-approve')).toBeNull();
  });

  it('a merge conflict offers Update and retry, which asks for the rebase', async () => {
    state.review = review({ outcome: 'blocked', reason: 'conflict', run: { ...RUN, outcome: 'blocked', blockedCode: 'merge_conflict' } });
    mount(<BuildReview wsId={WS} ticketRef="1.1" />);
    await settle();
    fireEvent.click(screen.getByTestId('review-update'));
    await settle();
    expect(state.calls).toContain(`POST /api/v1/workspaces/${WS}/runs/${RUN.id}/retry`);
    expect(state.bodies).toContainEqual({ mode: 'rebase' });
  });

  it('Reject and retry asks for an optional note, then sends it with retry', async () => {
    state.review = review({});
    mount(<BuildReview wsId={WS} ticketRef="1.1" />);
    await settle();
    fireEvent.click(screen.getByTestId('review-reject'));
    fireEvent.change(screen.getByTestId('review-note'), { target: { value: '  Use the blue one.  ' } });
    fireEvent.click(screen.getByTestId('review-reject-confirm'));
    await settle();
    expect(state.calls).toContain(`POST /api/v1/workspaces/${WS}/builds/1.1/reject`);
    expect(state.bodies).toContainEqual({ retry: true, note: 'Use the blue one.' });
  });

  it('a merged run says so and offers neither Approve nor Reject', async () => {
    state.review = review({ merged: true });
    mount(<BuildReview wsId={WS} ticketRef="1.1" />);
    await settle();
    expect(screen.getByTestId('review-merged')).toBeTruthy();
    expect(screen.queryByTestId('review-approve')).toBeNull();
    expect(screen.queryByTestId('review-reject')).toBeNull();
  });
});
