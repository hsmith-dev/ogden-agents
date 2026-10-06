// @vitest-environment happy-dom
/**
 * Orchestrate (epic 15, story 15.3), the tracer's page: with the piece off the
 * page says so and asks the server for nothing; with it on, a goal makes a
 * plan, each step shows who gets it, Approve and send approves then sends, a
 * failed send leaves Send to try again, and the worker's state and capped
 * report show once it was sent. With no manager the page says so in plain
 * words. The Switch in project settings turns the piece on and off. The REST
 * calls, the event stream and the router are stand-ins.
 */
import { MANAGER_STATE_WORDS, ORCHESTRATION_NO_MANAGER_MESSAGE, ORCHESTRATION_OFF_MESSAGE, type OrchestrationRunView } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const step = (stepId: string, fields: Record<string, unknown> = {}) => ({
  runId: RUN,
  stepId,
  position: 0,
  worker: 'claude-code',
  chat: 'new',
  instruction: `Instruction ${stepId}`,
  dependsOn: [],
  state: 'proposed',
  approvedBy: null,
  sessionId: null,
  workerLabel: 'Claude Code',
  sessionState: null,
  report: null,
  ...fields,
});
const view = (steps: unknown[], state = 'awaiting_user'): OrchestrationRunView =>
  ({
    run: { id: RUN, workspaceId: WS, goal: 'Add a contact form', state, mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, stopReason: null, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' },
    steps,
  }) as unknown as OrchestrationRunView;

const fake = vi.hoisted(() => ({
  enabled: true,
  managerReady: true,
  /** The manager's state as the server words it (absent: an older server). */
  manager: undefined as undefined | { state: string; message: string },
  /** The project's roster as saved, and the body of the last roster change. */
  roster: { manager: null, planner: null, worker: null, reviewer: null } as Record<string, unknown>,
  rosterSaved: undefined as undefined | Record<string, unknown>,
  servers: [] as unknown[],
  runs: [] as unknown[],
  calls: [] as string[],
  /** What the next dispatch does. */
  dispatchFails: false,
  /** The view each action answers. */
  next: undefined as unknown,
  switchSaved: undefined as boolean | undefined,
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
vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fake.calls.push(`${method} ${path}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (path.endsWith('/settings') && method === 'GET') return json({ settings: { cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false, orchestrationEnabled: fake.enabled, orchestrationRoster: fake.roster } });
      if (path.endsWith('/settings') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { orchestrationEnabled?: boolean; orchestrationRoster?: Record<string, unknown> };
        if (body.orchestrationRoster !== undefined) {
          fake.rosterSaved = body.orchestrationRoster;
          fake.roster = body.orchestrationRoster;
        } else fake.switchSaved = body.orchestrationEnabled;
        return json({ settings: { cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false, orchestrationEnabled: fake.switchSaved ?? fake.enabled, orchestrationRoster: fake.roster } });
      }
      if (path.endsWith('/orchestration')) return json({ settings: { mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, roster: { manager: null, planner: null, worker: null, reviewer: null }, managerReady: fake.managerReady, ...(fake.manager === undefined ? {} : { manager: fake.manager }) } });
      if (path === '/api/v1/local-endpoints') return json({ endpoints: fake.servers, defaultEndpointId: null });
      if (path.endsWith('/models')) return json({ state: 'ready', message: 'Ready. 2 models are available.', models: [{ id: 'model-a', cautions: [] }, { id: 'model-b', cautions: [] }], model: null, missing: null });
      if (path.endsWith('/orchestration/runs') && method === 'GET') return json({ runs: fake.runs });
      if (path.endsWith('/orchestration/runs') && method === 'POST') {
        fake.runs = [fake.next];
        return json({ run: fake.next }, 201);
      }
      if (path.endsWith('/approve')) {
        fake.runs = [fake.next];
        return json({ run: fake.next });
      }
      if (path.endsWith('/dispatch')) {
        if (fake.dispatchFails) return json({ error: { code: 'agent_signed_out', message: 'Claude Code is signed out.' } }, 409);
        fake.runs = [fake.next];
        return json({ run: fake.next });
      }
      return json({}, 404);
    },
  },
}));

const { WorkspaceOrchestratePage } = await import('../src/routes/workspace-orchestrate-page');
const { ManagerModelView, OrchestrationSection, OrchestrationSectionView } = await import('../src/workspaces/orchestration-section');
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
  fake.enabled = true;
  fake.managerReady = true;
  fake.manager = undefined;
  fake.roster = { manager: null, planner: null, worker: null, reviewer: null };
  fake.rosterSaved = undefined;
  fake.servers = [];
  fake.runs = [];
  fake.calls = [];
  fake.dispatchFails = false;
  fake.next = undefined;
  fake.switchSaved = undefined;
});
afterEach(cleanup);

describe('the Orchestrate page', () => {
  it('with the piece off says so, links to the settings, and asks the server for nothing of Orchestration', async () => {
    fake.enabled = false;
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-feature-off').textContent).toContain(ORCHESTRATION_OFF_MESSAGE);
    expect(screen.queryByTestId('orchestrate')).toBeNull();
    expect(fake.calls.filter((call) => call.includes('/orchestration'))).toEqual([]);
  });

  it('with no manager says so in plain words and cannot make a plan', async () => {
    fake.managerReady = false;
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate-no-manager').textContent).toBe(ORCHESTRATION_NO_MANAGER_MESSAGE);
    expect((screen.getByTestId('orchestrate-goal') as HTMLInputElement).disabled).toBe(true);
    expect(fake.calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('says which state the manager is in, in the server\'s own plain words, and cannot make a plan until it is ready', async () => {
    for (const state of ['not_chosen', 'endpoint_missing', 'host_not_confirmed'] as const) {
      cleanup();
      fake.managerReady = false;
      fake.manager = { state, message: MANAGER_STATE_WORDS[state] };
      await mount(<WorkspaceOrchestratePage />);
      expect(screen.getByTestId('orchestrate-no-manager').textContent, state).toBe(MANAGER_STATE_WORDS[state]);
      expect((screen.getByTestId('orchestrate-goal') as HTMLInputElement).disabled, state).toBe(true);
    }
  });

  it('says where a ready manager runs, and lets a goal be written', async () => {
    fake.manager = { state: 'ready', message: 'The manager is model-a on this computer, on My Mac.' };
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.queryByTestId('orchestrate-no-manager')).toBeNull();
    expect(screen.getByTestId('orchestrate-manager').textContent).toBe('The manager is model-a on this computer, on My Mac.');
    expect((screen.getByTestId('orchestrate-goal') as HTMLInputElement).disabled).toBe(false);
  });

  it('makes a plan from a goal and lists its steps with who gets each', async () => {
    fake.next = view([step('s1'), step('s2', { dependsOn: ['s1'], position: 1 })]);
    await mount(<WorkspaceOrchestratePage />);
    fireEvent.change(screen.getByTestId('orchestrate-goal'), { target: { value: 'Add a contact form' } });
    fireEvent.submit(screen.getByTestId('orchestrate-goal-form'));
    await settle();
    expect(fake.calls).toContain(`POST /api/v1/workspaces/${WS}/orchestration/runs`);
    expect(screen.getByTestId('orchestrate-run-goal').textContent).toBe('Add a contact form');
    const rows = screen.getAllByTestId('orchestrate-step');
    expect(rows.map((row) => row.getAttribute('data-step-id'))).toEqual(['s1', 's2']);
    expect(screen.getAllByTestId('orchestrate-step-worker').map((node) => node.textContent)).toEqual(['Claude Code', 'Claude Code']);
    // Only the first can be approved; the second waits for it.
    expect(screen.getAllByTestId('orchestrate-approve')).toHaveLength(1);
    expect(screen.getByTestId('orchestrate-step-waits').textContent).toBe('Waits for s1 to finish.');
  });

  it('Approve and send approves then sends, and the worker\'s state and report show', async () => {
    fake.runs = [view([step('s1')])];
    fake.next = view([step('s1', { state: 'done', approvedBy: 'user', sessionId: SES, sessionState: 'idle', report: { version: 'ogden.manager.status.v1', step_id: 's1', worker: 'claude-code', state: 'idle', summary: 'All done here.', truncated: true } })], 'awaiting_user');
    await mount(<WorkspaceOrchestratePage />);
    fireEvent.click(screen.getByTestId('orchestrate-approve'));
    await settle();
    const posts = fake.calls.filter((call) => call.startsWith('POST'));
    expect(posts).toEqual([`POST /api/v1/workspaces/${WS}/orchestration/runs/${RUN}/steps/s1/approve`, `POST /api/v1/workspaces/${WS}/orchestration/runs/${RUN}/steps/s1/dispatch`]);
    expect(screen.getByTestId('orchestrate-step-report').textContent).toBe('All done here.');
    expect(screen.getByTestId('orchestrate-step-truncated').textContent).toContain('Open the chat');
    expect(screen.getByTestId('orchestrate-step-chat').getAttribute('href')).toBe('/w/$wsId/s/$sesId');
    expect(screen.queryByTestId('orchestrate-approve')).toBeNull();
  });

  it('a send that fails says why and leaves the step approved with Send to try again', async () => {
    fake.runs = [view([step('s1')])];
    fake.next = view([step('s1', { state: 'approved', approvedBy: 'user' })]);
    fake.dispatchFails = true;
    await mount(<WorkspaceOrchestratePage />);
    fireEvent.click(screen.getByTestId('orchestrate-approve'));
    await settle();
    expect(screen.getByTestId('orchestrate-error').textContent).toContain('Claude Code is signed out.');
    // What the server holds is approved, not sent: the step offers Send, and it works once the cause is fixed.
    expect(screen.queryByTestId('orchestrate-approve')).toBeNull();
    expect(screen.getByTestId('orchestrate-step-state').textContent).toBe('Approved, not sent yet');
    fake.dispatchFails = false;
    fake.next = view([step('s1', { state: 'dispatched', approvedBy: 'user', sessionId: SES, sessionState: 'working' })], 'running');
    fireEvent.click(screen.getByTestId('orchestrate-send'));
    await settle();
    expect(screen.getByTestId('orchestrate-step-session-state').textContent).toBe('The worker is working.');
    expect(screen.queryByTestId('orchestrate-error')).toBeNull();
  });

  it('shows Send for an approved step and sends it', async () => {
    fake.runs = [view([step('s1', { state: 'approved', approvedBy: 'user' })])];
    fake.next = view([step('s1', { state: 'dispatched', approvedBy: 'user', sessionId: SES, sessionState: 'working', report: null })], 'running');
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.queryByTestId('orchestrate-approve')).toBeNull();
    fireEvent.click(screen.getByTestId('orchestrate-send'));
    await settle();
    expect(fake.calls.filter((call) => call.startsWith('POST'))).toEqual([`POST /api/v1/workspaces/${WS}/orchestration/runs/${RUN}/steps/s1/dispatch`]);
    expect(screen.getByTestId('orchestrate-step-session-state').textContent).toBe('The worker is working.');
  });

  it('uses no dashes in what it says', async () => {
    fake.runs = [view([step('s1')])];
    await mount(<WorkspaceOrchestratePage />);
    expect(screen.getByTestId('orchestrate').textContent).not.toMatch(/[–—]| - /);
  });
});

describe('the project settings switch', () => {
  it('shows the switch off by default and saves a change at once', async () => {
    fake.enabled = false;
    await mount(<OrchestrationSection wsId={WS} />);
    const toggle = screen.getByTestId('orchestration-use');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await settle();
    expect(fake.switchSaved).toBe(true);
  });

  it('says why a change failed', () => {
    render(
      <TooltipProvider>
        <OrchestrationSectionView enabled={false} saving={false} error="Orchestration isn't in this version of Ogden Agents yet, so it can't be turned on." onChange={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('orchestration-error').textContent).toContain("isn't in this version");
  });
});

const SERVER = { id: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', label: 'My Mac', baseUrl: 'http://localhost:1234/v1', preset: null, auth: 'none', model: null, remoteConfirmedFor: null, createdAt: '2026-10-05T00:00:00.000Z', host: 'localhost:1234', loopback: true, needsConfirmation: false, insecureRemote: false, keySaved: false };

describe('the manager model setting', () => {
  it('shows nothing about a manager while the piece is off', async () => {
    fake.enabled = false;
    await mount(<OrchestrationSection wsId={WS} />);
    expect(screen.queryByTestId('manager-model')).toBeNull();
  });

  it('says no manager is chosen and offers the user\'s servers, with where each runs', async () => {
    fake.servers = [SERVER, { ...SERVER, id: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W4', label: 'Company gateway', loopback: false, host: 'gateway.example.com' }];
    await mount(<OrchestrationSection wsId={WS} />);
    expect(screen.getByTestId('manager-model-current').textContent).toBe('No manager is chosen yet.');
    expect(screen.getAllByTestId('manager-show-models')).toHaveLength(2);
    expect(screen.getByTestId(`manager-server-${SERVER.id}`).textContent).toContain('My Mac (on this computer)');
    expect(screen.getByTestId('manager-server-lep_01J9Z3K4M5N6P7Q8R9S0T1V2W4').textContent).toContain('Company gateway (on another computer)');
    expect(screen.queryByTestId('manager-clear')).toBeNull();
  });

  it('sends the user to Settings when no server is set up', async () => {
    await mount(<OrchestrationSection wsId={WS} />);
    expect(screen.getByTestId('manager-model-no-servers').textContent).toContain('Add one in Settings');
  });

  it('reads a server\'s models, saves the chosen one as a model manager keeping the other roles, and shows it', async () => {
    fake.servers = [SERVER];
    fake.roster = { manager: null, planner: null, worker: { kind: 'agent', agentId: 'claude-code' }, reviewer: null };
    await mount(<OrchestrationSection wsId={WS} />);
    fireEvent.click(screen.getByTestId('manager-show-models'));
    await settle();
    expect(fake.calls).toContain(`GET /api/v1/local-endpoints/${SERVER.id}/models`);
    fireEvent.click(screen.getByTestId('manager-use-model-b'));
    await settle();
    expect(fake.rosterSaved).toEqual({ manager: { kind: 'model', endpointId: SERVER.id, model: 'model-b' }, planner: null, worker: { kind: 'agent', agentId: 'claude-code' }, reviewer: null });
    expect(screen.getByTestId('manager-model-current').textContent).toBe('The manager is model-b on My Mac.');
    expect(screen.getByTestId('manager-model').textContent).not.toMatch(/[–—]| - /);
  });

  it('clears the manager, and says so when the chosen server is gone', async () => {
    fake.servers = [SERVER];
    fake.roster = { manager: { kind: 'model', endpointId: SERVER.id, model: 'model-a' }, planner: null, worker: null, reviewer: null };
    await mount(<OrchestrationSection wsId={WS} />);
    fireEvent.click(screen.getByTestId('manager-clear'));
    await settle();
    expect(fake.rosterSaved).toEqual({ manager: null, planner: null, worker: null, reviewer: null });
    expect(screen.getByTestId('manager-model-current').textContent).toBe('No manager is chosen yet.');
    cleanup();
    fake.servers = [];
    fake.roster = { manager: { kind: 'model', endpointId: SERVER.id, model: 'model-a' }, planner: null, worker: null, reviewer: null };
    await mount(<OrchestrationSection wsId={WS} />);
    expect(screen.getByTestId('manager-model-current').textContent).toBe('The manager is model-a, on a server that is not set up any more.');
  });

  it('says why a choice failed', () => {
    render(
      <TooltipProvider>
        <ManagerModelView chosen={null} servers={[SERVER as never]} models={undefined} loading={undefined} saving={false} error="The manager must be a model on one of your servers, not an agent." onShowModels={() => {}} onChoose={() => {}} onClear={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('manager-model-error').textContent).toContain('The manager must be a model on one of your servers, not an agent.');
  });
});

describe('the worker chat\'s transcript', () => {
  it('shows an instruction from the manager with who sent it and who approved it', () => {
    render(<Message agentName="Claude Code" message={{ id: 'msg_1', role: 'user', text: 'Write the failing test first.', streaming: false, origin: 'manager' } as never} />);
    expect(screen.getByTestId('message-user').textContent).toBe('Write the failing test first.');
    expect(screen.getByTestId('message-origin').textContent).toBe('Sent by the manager, approved by you');
    expect(screen.getByTestId('message-from-manager')).toBeTruthy();
  });
});
