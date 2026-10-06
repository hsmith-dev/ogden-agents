// @vitest-environment happy-dom
/**
 * The reviewer role on the Orchestrate page (epic 15, story 15.10): a review step says which step it asks about, says what the reviewer is sent
 * (the question and a short, masked summary, no files or changes), links to epic 5's review page when the reviewed step was a build run and to
 * the worker chat otherwise, keeps the question short when edited, and gives the page no way to approve or merge. The server decides every
 * rule; these tests only check what is shown.
 */
import { REVIEW_LIMITS, orchestrationReviewNote, type OrchestrationRunView } from '@ogden-agents/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const NO_DASH = /—|–| - /;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { sesId?: string; ref?: string } }) => (
    <a href={to.replace('$wsId', WS).replace('$sesId', params.sesId ?? '').replace('$ref', params.ref ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const { OrchestrateView } = await import('../src/orchestrate/orchestrate-view');

const step = (stepId: string, fields: Record<string, unknown> = {}) => ({
  runId: RUN,
  stepId,
  position: 0,
  worker: 'codex',
  chat: 'new',
  instruction: `Instruction ${stepId}`,
  dependsOn: [],
  state: 'proposed',
  approvedBy: null,
  sessionId: null,
  reviewOf: null,
  review: null,
  workerLabel: 'Codex',
  sessionState: null,
  report: null,
  ...fields,
});
const work = (fields: Record<string, unknown> = {}) => step('s1', { state: 'done', sessionId: SES, sessionState: 'idle', ...fields });
const review = (fields: Record<string, unknown> = {}) => step('s2', { worker: 'grok', workerLabel: 'Grok', dependsOn: ['s1'], reviewOf: 's1', instruction: 'Is the change safe?', ...fields });
const view = (steps: unknown[], state = 'awaiting_user'): OrchestrationRunView =>
  ({
    run: { id: RUN, workspaceId: WS, goal: 'Fix the login form', state, mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, stopReason: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
    steps,
  }) as unknown as OrchestrationRunView;

const mount = (run: OrchestrationRunView) => {
  const handlers = { onStart: vi.fn(), onApprove: vi.fn(), onSend: vi.fn(), onEdit: vi.fn(async () => true), onSkip: vi.fn(), onReorder: vi.fn(), onStop: vi.fn() };
  render(<OrchestrateView wsId={WS} managerReady run={run} busy={false} error={undefined} stopping={false} {...handlers} />);
  return handlers;
};
const stepEl = (id: string) => screen.getAllByTestId('orchestrate-step').find((each) => each.getAttribute('data-step-id') === id)!;

afterEach(cleanup);

describe('a review step', () => {
  it('says which step it reviews and what the reviewer is sent, and an ordinary step says neither', () => {
    mount(view([work(), review()]));
    const el = stepEl('s2');
    expect(within(el).getByTestId('orchestrate-step-review-badge').textContent).toBe('Review of step s1');
    const note = within(el).getByTestId('orchestrate-step-review-note').textContent!;
    expect(note).toBe(orchestrationReviewNote('s1'));
    expect(note).toContain('short summary of the result of step s1');
    expect(note).toContain('No files or code changes are sent');
    expect(note).toContain('only you can approve or merge');
    expect(note).not.toMatch(NO_DASH);
    expect(within(stepEl('s1')).queryByTestId('orchestrate-step-review')).toBeNull();
    expect(within(stepEl('s1')).queryByTestId('orchestrate-step-review-badge')).toBeNull();
  });

  it('links to the review page of the ticket when the reviewed step was a build run', () => {
    mount(view([work(), review({ review: { kind: 'build_review', ticketRef: '5.2' } })]));
    const link = within(stepEl('s2')).getByTestId('orchestrate-step-review-link');
    expect(link.getAttribute('href')).toBe(`/w/${WS}/review/5.2`);
    expect(link.getAttribute('data-review-kind')).toBe('build_review');
    expect(link.textContent).toBe('Open the review page for step s1');
  });

  it('links to the chat that did the work when the reviewed step was a plain chat', () => {
    mount(view([work(), review({ review: { kind: 'worker_chat', sessionId: SES } })]));
    const link = within(stepEl('s2')).getByTestId('orchestrate-step-review-link');
    expect(link.getAttribute('href')).toBe(`/w/${WS}/s/${SES}`);
    expect(link.getAttribute('data-review-kind')).toBe('worker_chat');
    expect(link.textContent).toBe('Open the chat that did step s1');
  });

  it('has no link before the reviewed step was sent', () => {
    mount(view([step('s1'), review()]));
    expect(within(stepEl('s2')).queryByTestId('orchestrate-step-review-link')).toBeNull();
    expect(within(stepEl('s2')).getByTestId('orchestrate-step-review-note')).not.toBeNull();
  });

  it('offers only the same user actions as any step and no way to approve or merge anything', () => {
    const handlers = mount(view([work(), review({ review: { kind: 'build_review', ticketRef: '5.2' } })]));
    const el = stepEl('s2');
    fireEvent.click(within(el).getByTestId('orchestrate-approve'));
    expect(handlers.onApprove).toHaveBeenCalledWith('s2');
    const wording = screen.getByTestId('orchestrate').textContent!.toLowerCase();
    expect(wording).not.toContain('merge it');
    expect(screen.queryByRole('button', { name: /merge/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
    // The only way to the page where a person decides is a link.
    expect(within(el).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([`/w/${WS}/review/5.2`]);
  });

  it('keeps the question to its cap while it is edited, and an ordinary step to the longer cap', () => {
    mount(view([work({ state: 'proposed', sessionId: null, sessionState: null }), review()]));
    fireEvent.click(within(stepEl('s2')).getByTestId('orchestrate-edit'));
    expect(within(stepEl('s2')).getByTestId('orchestrate-edit-text').getAttribute('maxlength')).toBe(String(REVIEW_LIMITS.maxQuestionChars));
    fireEvent.click(within(stepEl('s1')).getByTestId('orchestrate-edit'));
    expect(Number(within(stepEl('s1')).getByTestId('orchestrate-edit-text').getAttribute('maxlength'))).toBeGreaterThan(REVIEW_LIMITS.maxQuestionChars);
  });

  it('shows the reviewer\'s answer as the step\'s report once it came back', () => {
    mount(view([work(), review({ state: 'done', sessionId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4', sessionState: 'idle', report: { version: 'ogden.manager.status.v1', step_id: 's2', worker: 'grok', state: 'idle', summary: 'It looks safe.', truncated: false } })], 'finished'));
    expect(within(stepEl('s2')).getByTestId('orchestrate-step-report').textContent).toBe('It looks safe.');
  });
});
