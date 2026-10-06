// @vitest-environment happy-dom
/**
 * Orchestration mode, Stop and per-run limits in the UI (epic 15, story 15.8): the project's two modes plainly labelled with Dispatch
 * automatically asking once, the install's default and limits for new projects, the Orchestrate page's mode line, instruction
 * counter, stop reasons, the wait for the user at an agent that signs in with the account, the activity log, and the transcript mark for
 * an instruction sent automatically. The server decides every rule; these tests only check what is asked and shown. The REST calls,
 * the event stream and the router are stand-ins.
 */
import { ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS, ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE, ORCHESTRATION_MANAGER_AUTO_MARK, ORCHESTRATION_NEEDS_YOUR_APPROVAL, type OrchestrationRunView } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const NO_DASH = /—|–| - /;

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
const view = (steps: unknown[], state = 'awaiting_user', run: Record<string, unknown> = {}): OrchestrationRunView =>
  ({
    run: { id: RUN, workspaceId: WS, goal: 'Add a contact form', state, mode: 'automatic', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, stopReason: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', ...run },
    steps,
  }) as unknown as OrchestrationRunView;

const fake = vi.hoisted(() => ({
  /** The project's settings as the server would read them, and the bodies of its changes. */
  project: {} as Record<string, unknown>,
  patches: [] as Array<Record<string, unknown>>,
  /** A refusal for the next project change. */
  refuse: undefined as undefined | { status: number; code: string; message: string },
  defaults: { mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } } as { mode: string; limits: Record<string, number> },
  puts: [] as Array<Record<string, unknown>>,
  refuseDefaults: undefined as undefined | string,
  runs: [] as unknown[],
  activity: [] as unknown[],
  mode: 'approve_each' as string,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ wsId: WS }),
  Link: ({ children, to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/orchestrate/roster-editor', () => ({ ProjectRoster: () => null, DefaultRoster: () => null }));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      const settings = () => ({ settings: { cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false, orchestrationEnabled: true, ...fake.project } });
      if (path.endsWith('/settings') && method === 'GET') return json(settings());
      if (path.endsWith('/settings') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        fake.patches.push(body);
        if (fake.refuse !== undefined) return json({ error: { code: fake.refuse.code, message: fake.refuse.message } }, fake.refuse.status);
        if (body.orchestrationMode === 'automatic') fake.project = { ...fake.project, orchestrationMode: 'automatic', orchestrationAutomaticConfirmed: true };
        else delete fake.project.orchestrationMode;
        return json(settings());
      }
      if (path === '/api/v1/settings/orchestration' && method === 'GET') return json({ defaults: fake.defaults });
      if (path === '/api/v1/settings/orchestration' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { mode?: string; limits?: Record<string, number> };
        fake.puts.push(body as Record<string, unknown>);
        if (fake.refuseDefaults !== undefined) return json({ error: { code: 'invalid_request', message: fake.refuseDefaults } }, 400);
        fake.defaults = { mode: body.mode ?? fake.defaults.mode, limits: { ...fake.defaults.limits, ...body.limits } };
        return json({ defaults: fake.defaults });
      }
      if (path.endsWith('/orchestration/activity')) return json({ entries: fake.activity });
      if (path.endsWith('/orchestration')) return json({ settings: { mode: fake.mode, limits: fake.defaults.limits, roster: { manager: null, planner: null, worker: null, reviewer: null }, managerReady: true, manager: { state: 'ready', message: 'The manager runs on this computer.' } } });
      if (path.endsWith('/orchestration/runs') && method === 'GET') return json({ runs: fake.runs });
      return json({}, 404);
    },
  },
}));

const { WorkspaceOrchestratePage } = await import('../src/routes/workspace-orchestrate-page');
const { ModeChoiceView, ProjectMode, OrchestrationDefaultsSection } = await import('../src/orchestrate/mode-section');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { Message } = await import('../src/chat/transcript-parts');

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const mount = async (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
  await settle();
};

beforeEach(() => {
  fake.project = {};
  fake.patches = [];
  fake.refuse = undefined;
  fake.defaults = { mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } };
  fake.puts = [];
  fake.refuseDefaults = undefined;
  fake.runs = [];
  fake.activity = [];
  fake.mode = 'approve_each';
});
afterEach(cleanup);

describe('the mode choice', () => {
  const choice = (props: Partial<Parameters<typeof ModeChoiceView>[0]> = {}) => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <ModeChoiceView value="approve_each" confirmed={false} saving={false} error={undefined} onChange={onChange} testId="mode" title="How instructions are sent" description="Change it at any time." {...props} />
      </TooltipProvider>,
    );
    return onChange;
  };

  it('labels both modes plainly, with Approve each instruction in force', () => {
    choice();
    expect(screen.getByTestId('mode-approve_each').getAttribute('data-state')).toBe('checked');
    expect(screen.getByTestId('mode-section').textContent).toContain('Approve each instruction');
    expect(screen.getByTestId('mode-section').textContent).toContain('You see every instruction and approve, edit or skip it before an agent gets it.');
    expect(screen.getByTestId('mode-section').textContent).toContain('Dispatch automatically');
    expect(screen.getByTestId('mode-section').textContent).toContain('The manager sends each instruction on its own, within limits. You can stop it at any time.');
    expect(screen.getByTestId('mode-section').textContent).not.toMatch(NO_DASH);
  });

  it('asks the question before Dispatch automatically, and does nothing on Cancel', async () => {
    const onChange = choice();
    fireEvent.click(screen.getByTestId('mode-automatic'));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    const dialog = screen.getByTestId('mode-confirm');
    expect(dialog.textContent).toContain(ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS);
    expect(dialog.textContent).toContain('You will not be asked again in this project.');
    fireEvent.click(screen.getByTestId('mode-confirm-cancel'));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mode-confirm')).toBeNull();
  });

  it('sends the answer with the choice when the user confirms', async () => {
    const onChange = choice();
    fireEvent.click(screen.getByTestId('mode-automatic'));
    await settle();
    fireEvent.click(screen.getByTestId('mode-confirm-button'));
    await settle();
    expect(onChange).toHaveBeenCalledWith('automatic', true);
  });

  it('does not ask again where the user already confirmed, and never asks to go back to Approve each instruction', async () => {
    const onChange = choice({ confirmed: true });
    fireEvent.click(screen.getByTestId('mode-automatic'));
    await settle();
    expect(screen.queryByTestId('mode-confirm')).toBeNull();
    expect(onChange).toHaveBeenCalledWith('automatic', false);
    cleanup();
    const back = choice({ value: 'automatic', confirmed: true });
    fireEvent.click(screen.getByTestId('mode-approve_each'));
    await settle();
    expect(back).toHaveBeenCalledWith('approve_each', false);
  });

  it('is held while saving and shows the server\'s refusal in its own words', () => {
    const onChange = choice({ saving: true, error: 'Codex cannot be the worker in this mode.' });
    expect(screen.getByTestId('mode-error').textContent).toContain('Codex cannot be the worker in this mode.');
    fireEvent.click(screen.getByTestId('mode-automatic'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the project\'s mode in its settings', () => {
  it('saves Approve each instruction and Dispatch automatically at once, asks once, and records no second question', async () => {
    await mount(<ProjectMode wsId={WS} />);
    expect(screen.getByTestId('orchestration-mode-approve_each').getAttribute('data-state')).toBe('checked');
    fireEvent.click(screen.getByTestId('orchestration-mode-automatic'));
    await settle();
    fireEvent.click(screen.getByTestId('orchestration-mode-confirm-button'));
    await settle();
    expect(fake.patches).toEqual([{ orchestrationMode: 'automatic', confirm: true }]);
    expect(screen.getByTestId('orchestration-mode-automatic').getAttribute('data-state')).toBe('checked');
    // Back at any time, with nothing asked.
    fireEvent.click(screen.getByTestId('orchestration-mode-approve_each'));
    await settle();
    expect(fake.patches[1]).toEqual({ orchestrationMode: 'approve_each' });
    // On again: the project already confirmed, so no question and no confirm.
    fireEvent.click(screen.getByTestId('orchestration-mode-automatic'));
    await settle();
    expect(screen.queryByTestId('orchestration-mode-confirm')).toBeNull();
    expect(fake.patches[2]).toEqual({ orchestrationMode: 'automatic' });
  });

  it('shows the server\'s refusal in its own words and keeps the mode it had', async () => {
    fake.refuse = { status: 409, code: 'invalid_request', message: 'Claude Code takes instructions only one by one, so Dispatch automatically is not offered with it as the worker.' };
    await mount(<ProjectMode wsId={WS} />);
    fireEvent.click(screen.getByTestId('orchestration-mode-automatic'));
    await settle();
    fireEvent.click(screen.getByTestId('orchestration-mode-confirm-button'));
    await settle();
    expect(screen.getByTestId('orchestration-mode-error').textContent).toContain('Claude Code takes instructions only one by one');
    expect(screen.getByTestId('orchestration-mode-approve_each').getAttribute('data-state')).toBe('checked');
  });

  it('says the limits in force, and that a project starts on Approve each instruction when the install default is automatic', async () => {
    fake.defaults = { mode: 'automatic', limits: { maxInstructions: 5, maxDepth: 2, maxMinutes: 10 } };
    await mount(<ProjectMode wsId={WS} />);
    expect(screen.getByTestId('orchestration-limits').textContent).toContain('A run stops at 5 instructions, 2 steps deep, or 10 minutes, whichever comes first.');
    expect(screen.getByTestId('orchestration-default-automatic-note').textContent).toBe(ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE);
  });

  it('does not show that note once the project confirmed, or when the default is Approve each instruction', async () => {
    fake.defaults = { mode: 'automatic', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } };
    fake.project = { orchestrationAutomaticConfirmed: true };
    await mount(<ProjectMode wsId={WS} />);
    expect(screen.queryByTestId('orchestration-default-automatic-note')).toBeNull();
    cleanup();
    fake.defaults = { mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } };
    fake.project = {};
    await mount(<ProjectMode wsId={WS} />);
    expect(screen.queryByTestId('orchestration-default-automatic-note')).toBeNull();
  });
});

describe('the default mode and the limits for new projects', () => {
  it('shows the limits with their bounds, saves a change, and says it was saved', async () => {
    await mount(<OrchestrationDefaultsSection />);
    const instructions = screen.getByTestId('orchestration-limit-maxInstructions') as HTMLInputElement;
    expect(instructions.value).toBe('20');
    expect(instructions.min).toBe('1');
    expect(instructions.max).toBe('20');
    expect((screen.getByTestId('orchestration-limit-maxDepth') as HTMLInputElement).max).toBe('5');
    expect((screen.getByTestId('orchestration-limit-maxMinutes') as HTMLInputElement).max).toBe('120');
    expect(screen.getByTestId('orchestration-defaults').textContent).toContain('These are safety limits, not a budget. Nothing here tracks money.');
    fireEvent.change(instructions, { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('orchestration-limits-save'));
    await settle();
    expect(fake.puts).toEqual([{ limits: { maxInstructions: 5, maxDepth: 3, maxMinutes: 30 } }]);
    expect(screen.getByTestId('orchestration-defaults-status').textContent).toBe('Saved.');
    expect((screen.getByTestId('orchestration-limit-maxInstructions') as HTMLInputElement).value).toBe('5');
  });

  it('shows the server\'s refusal of a limit in its own words', async () => {
    fake.refuseDefaults = 'The time limit can be at most 120.';
    await mount(<OrchestrationDefaultsSection />);
    fireEvent.change(screen.getByTestId('orchestration-limit-maxMinutes'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('orchestration-limits-save'));
    await settle();
    expect(screen.getByTestId('orchestration-default-mode-error').textContent).toContain('The time limit can be at most 120.');
  });

  it('asks before Dispatch automatically becomes the default, and says each project still confirms for itself', async () => {
    await mount(<OrchestrationDefaultsSection />);
    expect(screen.getByTestId('orchestration-default-mode-section').textContent).toContain('A project you add starts on Approve each instruction whatever you choose here.');
    fireEvent.click(screen.getByTestId('orchestration-default-mode-automatic'));
    await settle();
    expect(fake.puts).toEqual([]);
    fireEvent.click(screen.getByTestId('orchestration-default-mode-confirm-button'));
    await settle();
    expect(fake.puts).toEqual([{ mode: 'automatic', confirm: true }]);
    expect(screen.getByTestId('orchestration-default-mode-automatic').getAttribute('data-state')).toBe('checked');
  });
});

describe('the Orchestrate page under each mode', () => {
  it('names the mode in force, in plain words with no dash', async () => {
    fake.mode = 'automatic';
    await mount(<WorkspaceOrchestratePage />);
    const line = screen.getByTestId('orchestrate-mode');
    expect(line.getAttribute('data-mode')).toBe('automatic');
    expect(line.textContent).toContain('Dispatch automatically');
    expect(line.textContent).not.toMatch(NO_DASH);
    cleanup();
    fake.mode = 'approve_each';
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-mode').textContent).toContain('Approve each instruction');
  });

  it('shows the instruction counter against the limit, and no money', async () => {
    fake.runs = [view([step('s1', { state: 'done', sessionId: SES, approvedBy: 'mode' }), step('s2', { state: 'dispatched', sessionId: SES, approvedBy: 'mode' }), step('s3')], 'running', { limits: { maxInstructions: 5, maxDepth: 3, maxMinutes: 30 } })];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-run-counter').textContent).toBe('2 of 5 instructions sent. Dispatching automatically.');
    expect(screen.getByTestId('orchestrate-run').textContent).not.toMatch(/\$|cost|price|budget|token/i);
    expect(screen.getAllByTestId('orchestrate-step-approver').map((each) => each.textContent)).toEqual(['Sent automatically', 'Sent automatically']);
    expect(screen.getByTestId('orchestrate-stop')).toBeTruthy();
  });

  it('says plainly why a run ended at a limit, and why one stopped for a refused instruction', async () => {
    fake.runs = [view([step('s1', { state: 'done', sessionId: SES })], 'stopped', { stopReason: 'instruction_limit', limits: { maxInstructions: 1, maxDepth: 3, maxMinutes: 30 } })];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-stop-reason').textContent).toBe('The run stopped because it sent 1 instructions, the limit. Nothing more was sent.');
    expect(screen.queryByTestId('orchestrate-stopped-note')).toBeNull();
    expect(screen.queryByTestId('orchestrate-stop')).toBeNull();
    cleanup();
    fake.runs = [view([step('s1')], 'stopped', { stopReason: 'dispatch_refused' })];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-stop-reason').textContent).toBe('The run stopped because an instruction could not be sent. The activity log says why. The manager was told.');
    cleanup();
    fake.runs = [view([step('s1')], 'stopped', { stopReason: 'time_limit', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 12 } })];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-stop-reason').textContent).toContain('ran for 12 minutes, the limit');
  });

  it('keeps the user\'s own Stop note for a run the user stopped', async () => {
    fake.runs = [view([step('s1')], 'stopped', { stopReason: 'user', mode: 'approve_each' })];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-stopped-note').textContent).toContain('You stopped this run.');
    expect(screen.queryByTestId('orchestrate-stop-reason')).toBeNull();
  });

  it('says an agent that signs in with the account waits for the user, in an automatic run', async () => {
    fake.runs = [view([step('s1', { state: 'done', sessionId: SES }), step('s2', { worker: 'claude-code', workerLabel: 'Claude Code', dependsOn: ['s1'] })], 'awaiting_user')];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-needs-approval').textContent).toBe(ORCHESTRATION_NEEDS_YOUR_APPROVAL);
    // The user's own approval is still there to press.
    expect(screen.getByTestId('orchestrate-approve')).toBeTruthy();
  });

  it('does not say that in a run the user approves each instruction of', async () => {
    fake.runs = [view([step('s1')], 'awaiting_user', { mode: 'approve_each' })];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.queryByTestId('orchestrate-needs-approval')).toBeNull();
  });
});

describe('the activity log', () => {
  const entry = (fields: Record<string, unknown>) => ({
    at: '2026-10-06T10:05:00.000Z',
    runId: RUN,
    stepId: 's1',
    kind: 'sent',
    worker: 'codex',
    workerLabel: 'Codex',
    sessionId: SES,
    chat: 'new',
    approvedBy: 'mode',
    instruction: 'Write the failing test first.',
    result: 'working',
    note: '',
    ...fields,
  });

  it('says nothing was sent when nothing was', async () => {
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-activity-empty').textContent).toBe('Nothing has been sent yet.');
  });

  it('lists each instruction sent or refused: worker, chat, who approved, result, time and why', async () => {
    fake.activity = [
      entry({ stepId: 's3', kind: 'refused', sessionId: null, approvedBy: null, result: 'refused', note: "Codex is not on this project's team any more, so the instruction was not sent." }),
      entry({ stepId: 's2', approvedBy: 'user', result: 'finished', chat: 'existing', workerLabel: 'Grok' }),
      entry({ stepId: 's1', approvedBy: 'mode', result: 'working' }),
    ];
    await mount(<WorkspaceOrchestratePage />);
    const rows = screen.getAllByTestId('orchestrate-activity-entry');
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual(['refused', 'sent', 'sent']);
    expect(within(rows[0]!).getByTestId('orchestrate-activity-result').textContent).toBe('Not sent');
    expect(within(rows[0]!).getByTestId('orchestrate-activity-who').textContent).toBe('Not sent');
    expect(within(rows[0]!).getByTestId('orchestrate-activity-note').textContent).toContain("Codex is not on this project's team any more");
    expect(within(rows[0]!).queryByTestId('orchestrate-activity-chat')).toBeNull();
    expect(within(rows[1]!).getByTestId('orchestrate-activity-worker').textContent).toBe('Grok');
    expect(within(rows[1]!).getByTestId('orchestrate-activity-who').textContent).toBe('Approved by you, sent to an existing chat');
    expect(within(rows[1]!).getByTestId('orchestrate-activity-result').textContent).toBe('Finished');
    expect(within(rows[2]!).getByTestId('orchestrate-activity-who').textContent).toBe('Approved by the mode, automatically, sent to a new chat');
    expect(within(rows[2]!).getByTestId('orchestrate-activity-result').textContent).toBe('The worker is on it');
    expect(within(rows[2]!).getByTestId('orchestrate-activity-instruction').textContent).toBe('Write the failing test first.');
    expect(within(rows[2]!).getByTestId('orchestrate-activity-chat')).toBeTruthy();
    expect(within(rows[2]!).getByTestId('orchestrate-activity-when').textContent).not.toBe('');
    expect(screen.getByTestId('orchestrate-activity').textContent).not.toMatch(NO_DASH);
    expect(screen.getByTestId('orchestrate-activity').textContent).not.toMatch(/\$|cost|price|budget/i);
  });
});

describe('the worker chat\'s transcript', () => {
  it('says an instruction was sent automatically, not approved by the user', () => {
    render(<Message agentName="Codex" message={{ id: 'msg_1', role: 'user', text: 'Write the failing test first.', streaming: false, origin: 'manager_auto' } as never} />);
    expect(screen.getByTestId('message-origin').textContent).toBe(ORCHESTRATION_MANAGER_AUTO_MARK);
    expect(screen.getByTestId('message-from-manager')).toBeTruthy();
  });
});
