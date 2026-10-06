// @vitest-environment happy-dom
/**
 * Routing rules in the screens (epic 15, story 15.12): the editor under Orchestration in the project's settings (add, edit, delete, move and
 * save, the server's refusals in its own words, the caps) and the badge and words on a plan step that followed a rule. The server decides
 * every rule; these tests check what is shown and what is sent.
 */
import { ORCHESTRATION_ROUTING_WORDS, ROUTING_LIMITS, type OrchestrationRunView } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const NO_DASH = /—|–| - /;

const fake = vi.hoisted(() => ({
  rules: [] as Array<{ id: string; text: string }>,
  saved: [] as unknown[],
  /** The refusal for the next save, in the server's words. */
  refuse: undefined as string | undefined,
  calls: [] as string[],
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }), useSessionEvents: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params: _params, ...props }: { children: ReactNode; to: string; params: unknown }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fake.calls.push(`${method} ${path}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (path.endsWith('/orchestration/routing') && method === 'GET') return json({ rules: fake.rules, maxRules: 10, maxRuleChars: 300 });
      if (path.endsWith('/orchestration/routing') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { rules: Array<{ id?: string; text: string }> };
        fake.saved.push(body);
        if (fake.refuse !== undefined) return json({ error: { code: 'invalid_request', message: fake.refuse } }, 400);
        let next = Math.max(0, ...fake.rules.map((rule) => Number(rule.id.slice(1))));
        fake.rules = body.rules.map((rule) => ({ id: rule.id ?? `r${(next += 1)}`, text: rule.text }));
        return json({ rules: fake.rules, maxRules: 10, maxRuleChars: 300 });
      }
      return json({}, 404);
    },
  },
}));

const { ProjectRoutingRules, RoutingEditorView, draftChanged, draftOf } = await import('../src/orchestrate/routing-editor');
const { OrchestrateView } = await import('../src/orchestrate/orchestrate-view');
const { TooltipProvider } = await import('../src/ui/tooltip');

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
const field = (index: number) => screen.getAllByTestId('routing-rule-text')[index] as HTMLInputElement;
const type = (index: number, text: string) => fireEvent.change(field(index), { target: { value: text } });
const press = async (testId: string) => {
  fireEvent.click(screen.getByTestId(testId));
  await settle();
};

beforeEach(() => {
  fake.rules = [];
  fake.saved = [];
  fake.refuse = undefined;
  fake.calls = [];
});
afterEach(cleanup);

describe('the routing rules editor', () => {
  it('says plainly what rules are and that they are only suggestions, and shows no rules and no save at first', async () => {
    await mount(<ProjectRoutingRules wsId={WS} />);
    expect(screen.getByText(ORCHESTRATION_ROUTING_WORDS.intro)).toBeTruthy();
    expect(ORCHESTRATION_ROUTING_WORDS.intro).toMatch(/suggestions only/);
    expect(screen.getByTestId('routing-none').textContent).toBe(ORCHESTRATION_ROUTING_WORDS.none);
    expect((screen.getByTestId('routing-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('routing-count').textContent).toBe('0 of 10 rules, up to 300 characters each');
    expect(screen.getByTestId('routing-editor').textContent).not.toMatch(NO_DASH);
  });

  it('adds rules, saves the whole list in order and shows it as saved', async () => {
    await mount(<ProjectRoutingRules wsId={WS} />);
    await press('routing-add');
    type(0, 'Tests go to the first agent');
    await press('routing-add');
    type(1, 'Reviews go to a different agent');
    expect((screen.getByTestId('routing-save') as HTMLButtonElement).disabled).toBe(false);
    await press('routing-save');
    expect(fake.saved).toEqual([{ rules: [{ text: 'Tests go to the first agent' }, { text: 'Reviews go to a different agent' }] }]);
    expect(screen.getByTestId('routing-saved').textContent).toBe('Saved');
    expect(screen.getAllByTestId('routing-rule').map((row) => row.getAttribute('data-rule-id'))).toEqual(['r1', 'r2']);
    expect((screen.getByTestId('routing-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits a saved rule keeping its id, moves one and deletes one, and nothing is sent until Save', async () => {
    fake.rules = [
      { id: 'r1', text: 'Tests go to the first agent' },
      { id: 'r2', text: 'Reviews go to a different agent' },
      { id: 'r3', text: 'Docs go to anyone' },
    ];
    await mount(<ProjectRoutingRules wsId={WS} />);
    expect(screen.getAllByTestId('routing-rule')).toHaveLength(3);
    type(0, 'Tests go to the second agent');
    fireEvent.click(screen.getAllByTestId('routing-rule-down')[1]!);
    fireEvent.click(screen.getAllByTestId('routing-rule-delete')[0]!);
    expect(fake.saved).toEqual([]);
    await press('routing-save');
    expect(fake.saved).toEqual([{ rules: [{ id: 'r3', text: 'Docs go to anyone' }, { id: 'r2', text: 'Reviews go to a different agent' }] }]);
  });

  it('can move the first rule only down and the last only up', async () => {
    fake.rules = [
      { id: 'r1', text: 'One' },
      { id: 'r2', text: 'Two' },
    ];
    await mount(<ProjectRoutingRules wsId={WS} />);
    expect((screen.getAllByTestId('routing-rule-up')[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByTestId('routing-rule-down')[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByTestId('routing-rule-up')[1]!);
    expect(field(0).value).toBe('Two');
    expect(field(1).value).toBe('One');
  });

  it('saves an empty list to delete every rule, and offers no save for an empty rule', async () => {
    fake.rules = [{ id: 'r1', text: 'One' }];
    await mount(<ProjectRoutingRules wsId={WS} />);
    await press('routing-add');
    expect((screen.getByTestId('routing-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('routing-empty-note').textContent).toBe('Fill in or delete the empty rule to save.');
    fireEvent.click(screen.getAllByTestId('routing-rule-delete')[1]!);
    fireEvent.click(screen.getAllByTestId('routing-rule-delete')[0]!);
    expect((screen.getByTestId('routing-save') as HTMLButtonElement).disabled).toBe(false);
    await press('routing-save');
    expect(fake.saved).toEqual([{ rules: [] }]);
    expect(screen.getByTestId('routing-none')).toBeTruthy();
  });

  it('holds the caps: a rule field stops at 300 characters and the add button stops at 10 rules', async () => {
    fake.rules = Array.from({ length: ROUTING_LIMITS.maxRules - 1 }, (_, index) => ({ id: `r${index + 1}`, text: `Rule ${index + 1}` }));
    await mount(<ProjectRoutingRules wsId={WS} />);
    expect(field(0).getAttribute('maxlength')).toBe('300');
    expect((screen.getByTestId('routing-add') as HTMLButtonElement).disabled).toBe(false);
    await press('routing-add');
    expect((screen.getByTestId('routing-add') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('routing-count').textContent).toBe('10 of 10 rules, up to 300 characters each');
  });

  it('shows the server\'s refusal in its own words, keeps what was typed and lets the person fix it', async () => {
    await mount(<ProjectRoutingRules wsId={WS} />);
    await press('routing-add');
    type(0, 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    fake.refuse = ORCHESTRATION_ROUTING_WORDS.secret;
    await press('routing-save');
    expect(screen.getByTestId('routing-error').textContent).toContain('looks like it holds a key or a secret');
    expect(field(0).value).toContain('sk-ant');
    expect(screen.queryByTestId('routing-saved')).toBeNull();
    fake.refuse = undefined;
    type(0, 'Tests go to the first agent');
    await press('routing-save');
    expect(screen.queryByTestId('routing-error')).toBeNull();
    expect(screen.getByTestId('routing-saved')).toBeTruthy();
  });

  it('compares a draft with what is saved by id, text and order', () => {
    const saved = [
      { id: 'r1', text: 'One' },
      { id: 'r2', text: 'Two' },
    ];
    expect(draftChanged(draftOf(saved), saved)).toBe(false);
    expect(draftChanged(draftOf(saved).reverse(), saved)).toBe(true);
    expect(draftChanged([...draftOf(saved), { text: 'Three', key: 'k' }], saved)).toBe(true);
    expect(draftChanged(draftOf(saved).map((row) => ({ ...row, text: `${row.text}!` })), saved)).toBe(true);
  });

  it('disables every control while saving', () => {
    const rows = draftOf([{ id: 'r1', text: 'One' }]);
    render(<RoutingEditorView rows={rows} saved={[]} maxRules={10} maxRuleChars={300} saving error={undefined} justSaved={false} onChange={() => {}} onSave={() => {}} />);
    for (const id of ['routing-add', 'routing-save', 'routing-rule-up', 'routing-rule-down', 'routing-rule-delete', 'routing-rule-text']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
  });
});

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
  rule: null,
  workerLabel: 'Codex',
  sessionState: null,
  report: null,
  ...fields,
});
const view = (steps: unknown[]): OrchestrationRunView =>
  ({
    run: { id: RUN, workspaceId: WS, goal: 'Add a contact form', state: 'awaiting_user', mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, stopReason: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' },
    steps,
  }) as unknown as OrchestrationRunView;
const stepEl = (id: string) => screen.getAllByTestId('orchestrate-step').find((each) => each.getAttribute('data-step-id') === id)!;

describe('a step that followed a rule', () => {
  const mountView = (run: OrchestrationRunView) =>
    render(<OrchestrateView wsId={WS} managerReady run={run} busy={false} error={undefined} stopping={false} onStart={vi.fn()} onApprove={vi.fn()} onSend={vi.fn()} onEdit={vi.fn(async () => true)} onSkip={vi.fn()} onReorder={vi.fn()} onStop={vi.fn()} />);

  it('shows which rule it followed, in the person\'s own words, as a suggestion they still decide', () => {
    mountView(view([step('s1', { rule: { id: 'r1', text: 'Tests go to the first agent' } }), step('s2')]));
    const badge = within(stepEl('s1')).getByTestId('orchestrate-step-rule');
    expect(badge.textContent).toBe('Followed your rule');
    expect(badge.getAttribute('data-rule-id')).toBe('r1');
    const words = within(stepEl('s1')).getByTestId('orchestrate-step-rule-text').textContent!;
    expect(words).toBe('Your rule: Tests go to the first agent (a suggestion the manager followed; you still decide)');
    expect(words).not.toMatch(NO_DASH);
  });

  it('shows nothing on a step that followed no rule, or one stored before rules existed', () => {
    mountView(view([step('s1'), step('s2', { rule: undefined })]));
    for (const id of ['s1', 's2']) {
      expect(within(stepEl(id)).queryByTestId('orchestrate-step-rule')).toBeNull();
      expect(within(stepEl(id)).queryByTestId('orchestrate-step-rule-text')).toBeNull();
    }
  });

  it('still lets the person approve it like any other step: the rule changes no action', () => {
    mountView(view([step('s1', { rule: { id: 'r1', text: 'Tests go to the first agent' } })]));
    expect(within(stepEl('s1')).getByTestId('orchestrate-approve')).toBeTruthy();
    expect(within(stepEl('s1')).getByTestId('orchestrate-step-mode').textContent).toBe('Mode: Ask');
  });
});
