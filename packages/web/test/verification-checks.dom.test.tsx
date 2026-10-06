// @vitest-environment happy-dom
/** Story 11.2: the checks with each detail, the test output behind Show details, Check again, the card's failing check. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const state = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: Record<string, string> }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      state.calls.push(`${init.method ?? 'GET'} ${path}`);
      return new Response('{}', { status: 404 });
    },
  },
}));

const { VerificationChecks, CheckAgainButton, canCheckAgain } = await import('../src/planning/verification-checks');
const { TicketCard } = await import('../src/planning/ticket-card');

const verification = {
  outcome: 'failed',
  checks: [
    { id: 'plan_built', result: 'pass', detail: null },
    { id: 'tests_pass', result: 'fail', detail: '3 tests failed when re-run' },
    { id: 'code_changed', result: 'pass', detail: null },
  ],
  testCommand: 'npm test',
  testOutputTail: 'Tests: 3 failed, 2 passed, 5 total\n',
  attended: false,
  checkedAt: '2026-10-05T00:00:00.000Z',
} as never;

afterEach(() => cleanup());
const mount = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe('the verification report (story 11.2)', () => {
  it('shows each check with its detail, and the command and the output tail only behind Show details', () => {
    mount(<VerificationChecks verification={verification} idPrefix="t" />);
    expect(screen.getAllByTestId('review-check')).toHaveLength(3);
    expect(screen.getByText('3 tests failed when re-run')).toBeTruthy();
    expect(screen.queryByTestId('verification-test-output')).toBeNull();
    fireEvent.click(screen.getByTestId('verification-details-toggle'));
    expect(screen.getByTestId('verification-test-output').textContent).toContain('Tests: 3 failed');
    expect(screen.getByTestId('verification-test-command').textContent).toBe('npm test');
  });

  it('Check again is offered for a failed or ready run that is not decided, and posts to the run', async () => {
    const run = { id: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W5', outcome: 'failed', decision: null, worktreePath: '/w/x' } as never;
    expect(canCheckAgain(run)).toBe(true);
    expect(canCheckAgain({ outcome: 'failed', decision: 'rejected', worktreePath: '/w/x' })).toBe(false);
    expect(canCheckAgain({ outcome: 'running', decision: null, worktreePath: '/w/x' })).toBe(false);
    expect(canCheckAgain({ outcome: 'blocked', decision: null, worktreePath: '/w/x' })).toBe(false);
    mount(<CheckAgainButton wsId={WS} run={run} />);
    fireEvent.click(screen.getByTestId('check-again'));
    await act(async () => {
      for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state.calls).toContain(`POST /api/v1/workspaces/${WS}/runs/run_01J9Z3K4M5N6P7Q8R9S0T1V2W5/check-again`);
  });

  it('a card names the failing check of its latest build', () => {
    const row = { ref: '1.1', id: 1, epic: 'e', title: 'First', type: 'story', status: 'built', state: 'review', blocked_reason: '', after: [] } as never;
    mount(<TicketCard wsId={WS} row={row} status={{ kind: 'column', text: 'In review' } as never} highlighted={false} buildFailure="3 tests failed when re-run" />);
    expect(screen.getByTestId('ticket-build-failure').textContent).toBe('Build failed: 3 tests failed when re-run');
  });
});
