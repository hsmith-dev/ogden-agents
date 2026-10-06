// @vitest-environment happy-dom
/**
 * The loop on the Orchestrate page (epic 15, story 15.9): why a run waits (a worker's permission card with a link to that chat, the manager's
 * question with an answer box, a worker the restart cut off), what the manager decided (its suggestion, done, stop, no usable decision, what it
 * said when told of a Deny), and why a run stopped. The server decides every rule; these tests only check what is shown and what is asked.
 */
import { orchestrationStopWords, type OrchestrationRunView } from '@ogden-agents/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const NO_DASH = /—|–| - /;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children: ReactNode; to: string; params: { sesId?: string } }) => (
    <a href={to.replace('$sesId', params.sesId ?? '')} {...props}>
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
  workerLabel: 'Codex',
  sessionState: null,
  report: null,
  ...fields,
});
const view = (steps: unknown[], state: string, extra: Record<string, unknown> = {}, run: Record<string, unknown> = {}): OrchestrationRunView =>
  ({
    run: { id: RUN, workspaceId: WS, goal: 'Add a contact form', state, mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, stopReason: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', ...run },
    steps,
    ...extra,
  }) as unknown as OrchestrationRunView;

const mount = (run: OrchestrationRunView, extra: Record<string, unknown> = {}) => {
  const handlers = { onStart: vi.fn(), onApprove: vi.fn(), onSend: vi.fn(), onEdit: vi.fn(async () => true), onSkip: vi.fn(), onReorder: vi.fn(), onStop: vi.fn(), onAnswer: vi.fn(async () => true) };
  render(<OrchestrateView wsId={WS} managerReady run={run} busy={false} error={undefined} stopping={false} {...handlers} {...extra} />);
  return handlers;
};

afterEach(cleanup);

describe('why a run waits', () => {
  it('says a worker is waiting for the user\'s answer on its permission card, links to that chat and offers no Approve or Send meanwhile', () => {
    mount(view([step('s1', { state: 'dispatched', sessionId: SES, sessionState: 'waiting' }), step('s2')], 'paused', { waiting: { kind: 'permission_card', stepId: 's1', sessionId: SES } }));
    expect((screen.getByTestId('orchestrate-run-state')).textContent).toContain('Paused, waiting for you');
    const note = screen.getByTestId('orchestrate-waiting');
    expect((note).getAttribute('data-waiting')).toBe('permission_card');
    expect((within(note).getByTestId('orchestrate-waiting-words')).textContent).toContain('A worker is waiting for your answer on its permission card, so the run is paused. Answer the card in the worker\'s chat and the run goes on.');
    expect((within(note).getByTestId('orchestrate-waiting-chat')).getAttribute('href')).toBe(`/w/$wsId/s/${SES}`);
    expect(screen.queryByTestId('orchestrate-approve')).toBeNull();
    expect(screen.queryByTestId('orchestrate-send')).toBeNull();
    // Stop is always there, and the manager has no button to answer a card here.
    expect(screen.getByTestId('orchestrate-stop')).not.toBeNull();
    expect(note.textContent).not.toMatch(NO_DASH);
  });

  it('shows the manager\'s question with an answer box, sends the answer and clears the box once it was kept', async () => {
    const handlers = mount(view([step('s1', { state: 'done', sessionId: SES, sessionState: 'idle' }), step('s2')], 'awaiting_user', { waiting: { kind: 'question', question: 'Which database should it use?' }, decision: { action: 'ask_user', reason: 'It needs to know.', question: 'Which database should it use?', at: '2026-10-06T00:00:00.000Z' } }));
    expect((screen.getByTestId('orchestrate-waiting')).getAttribute('data-waiting')).toBe('question');
    expect((screen.getByTestId('orchestrate-question')).textContent).toContain('Which database should it use?');
    const box = screen.getByTestId('orchestrate-answer') as HTMLInputElement;
    // Nothing is sent while the box is empty.
    fireEvent.submit(screen.getByTestId('orchestrate-answer-form'));
    expect(handlers.onAnswer).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'SQLite please' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('orchestrate-answer-form'));
    });
    expect(handlers.onAnswer).toHaveBeenCalledWith('SQLite please');
    expect(box.value).toBe('');
  });

  it('keeps the answer in the box when the server refused it', async () => {
    const handlers = mount(view([step('s1', { state: 'done', sessionId: SES })], 'awaiting_user', { waiting: { kind: 'question', question: 'Why?' } }));
    handlers.onAnswer.mockResolvedValueOnce(false);
    const box = screen.getByTestId('orchestrate-answer') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Because' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('orchestrate-answer-form'));
    });
    expect(box.value).toBe('Because');
  });

  it('says a restart cut a worker off, links to its chat and sends nothing again', () => {
    mount(view([step('s1', { state: 'dispatched', sessionId: SES, sessionState: 'idle' })], 'awaiting_user', { waiting: { kind: 'interrupted', stepId: 's1', sessionId: SES } }));
    const note = screen.getByTestId('orchestrate-waiting');
    expect((note).getAttribute('data-waiting')).toBe('interrupted');
    expect((note).textContent).toContain('Ogden Agents was restarted while a worker was in the middle of its turn. Nothing was sent again.');
    expect((within(note).getByTestId('orchestrate-waiting-chat')).getAttribute('href')).toBe(`/w/$wsId/s/${SES}`);
    expect(note.textContent).not.toMatch(NO_DASH);
  });

  it('says the manager is thinking while it works out the next decision, and the user can still act', () => {
    mount(view([step('s1', { state: 'done', sessionId: SES }), step('s2')], 'awaiting_user', { thinking: true }));
    expect(screen.getByTestId('orchestrate-thinking')).not.toBeNull();
    expect(screen.getByTestId('orchestrate-approve')).not.toBeNull();
  });
});

describe('what the manager decided', () => {
  const at = '2026-10-06T00:00:00.000Z';
  it('shows its suggestion and marks the step it suggests', () => {
    mount(view([step('s1', { state: 'done', sessionId: SES }), step('s2'), step('s3')], 'awaiting_user', { decision: { action: 'dispatch', reason: 'It builds on the first.', stepId: 's2', at } }));
    expect((screen.getByTestId('orchestrate-decision')).textContent).toContain('The manager suggests step s2 next. It builds on the first.');
    const rows = screen.getAllByTestId('orchestrate-step');
    expect(within(rows[1]!).getByTestId('orchestrate-step-suggested')).not.toBeNull();
    expect(within(rows[2]!).queryByTestId('orchestrate-step-suggested')).toBeNull();
    // It is only a suggestion: the user still approves.
    expect(within(rows[1]!).getByTestId('orchestrate-approve')).not.toBeNull();
  });

  it('says when the manager could not suggest a step, and the choice is the user\'s', () => {
    mount(view([step('s1', { state: 'done', sessionId: SES }), step('s2')], 'awaiting_user', { decision: { action: 'unavailable', reason: 'The manager took too long to answer.', at } }));
    expect((screen.getByTestId('orchestrate-decision')).textContent).toContain('The manager could not suggest the next step, so the choice is yours.');
  });

  it('says the manager finished the run, leaves the steps never sent as not needed, and offers nothing more', () => {
    mount(view([step('s1', { state: 'done', sessionId: SES }), step('s2')], 'finished', { decision: { action: 'done', reason: 'The first step was enough.', at } }));
    expect((screen.getByTestId('orchestrate-decision')).textContent).toContain('The manager says the goal is done. The first step was enough.');
    expect((screen.getAllByTestId('orchestrate-step-state')[1]!).textContent).toContain('Not needed, the manager said the goal is done');
    expect(screen.queryByTestId('orchestrate-approve')).toBeNull();
  });

  it('says why a run the manager stopped stopped', () => {
    mount(view([step('s1', { state: 'done', sessionId: SES }), step('s2')], 'stopped', { decision: { action: 'stop', reason: 'It will not work.', at } }, { stopReason: 'manager_stopped' }));
    expect((screen.getByTestId('orchestrate-stop-reason')).textContent).toContain(orchestrationStopWords('manager_stopped', { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }));
    expect((screen.getByTestId('orchestrate-decision')).textContent).toContain('The manager chose to stop. It will not work.');
  });

  it('shows a Deny: the step as denied, the stop reason, and what the manager said when told', () => {
    mount(
      view([step('s1', { state: 'failed', sessionId: SES, sessionState: 'working' }), step('s2')], 'stopped', { decision: { action: 'stop', reason: 'Denied, so I stop.', told: 'denied', at } }, { stopReason: 'permission_denied' }),
    );
    expect((screen.getAllByTestId('orchestrate-step-state')[0]!).textContent).toContain('Denied, the step ended');
    expect((screen.getByTestId('orchestrate-stop-reason')).getAttribute('data-stop-reason')).toBe('permission_denied');
    expect((screen.getByTestId('orchestrate-stop-reason')).textContent).toContain('denied, so that step ended and the run stopped. The manager was told.');
    expect((screen.getByTestId('orchestrate-decision')).textContent).toContain('The manager was told the permission was denied. It said: stop. Denied, so I stop.');
  });

  it('says a refused instruction stopped the run and the manager was told', () => {
    mount(view([step('s1', { state: 'done', sessionId: SES }), step('s2')], 'stopped', { decision: { action: 'stop', reason: 'It could not be sent.', told: 'refused', at } }, { stopReason: 'dispatch_refused' }));
    expect((screen.getByTestId('orchestrate-decision')).textContent).toContain('The manager was told the instruction could not be sent.');
  });

  it('says a run that was making its plan when the app restarted ended, in plain words', () => {
    mount(view([], 'failed', {}, { stopReason: 'restarted' }));
    expect((screen.getByTestId('orchestrate-stop-reason')).textContent).toContain('Ogden Agents was restarted while the manager was making the plan, so the run stopped. Start it again.');
  });

  it('uses no dashes in anything it shows about the loop', () => {
    for (const reason of ['permission_denied', 'manager_stopped', 'restarted', 'dispatch_refused'] as const) {
      expect(orchestrationStopWords(reason, { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 })).not.toMatch(NO_DASH);
    }
  });
});
