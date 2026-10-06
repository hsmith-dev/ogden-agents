/**
 * Builds the manager proposes (epic 15, story 15.11) on a real server: the real board (a ticket store that reads the plan files), real git on
 * a fixture repo, the real builds with the fake ACP agent in build mode and a fixed sandbox, and the fake manager. The manager proposes
 * "Build ticket 1.1": it appears as a proposal, nothing starts in either mode, and no route of orchestration starts a build; the build the
 * person starts through `POST /builds` (the Build dialog's own path) is linked to the step by the person's own call, and the step then
 * follows the run (built, and read back to the manager as a capped masked summary), the Runs list shows it, and the person still decides on
 * the review page. No real agent, model, network, keychain or sandbox.
 */
import { join } from 'node:path';
import { createClaudeCodeAgent, createFixedSandbox, createMemoryManager } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort, TicketStorePort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BuildResponse,
  MANAGER_PLAN_VERSION,
  OrchestrationRunResponse,
  ReviewResponse,
  RunsResponse,
  WorkspaceResponse,
  type OrchestrationRunView,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_BUILD_REPO_FILES, fixtureGit } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import type { AgentWiring } from '../src/agent-wiring.js';
import { removeAfterTest, signIn, startTestServer, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const API_KEY_ONLY: AgentDescriptor['signInMethods'] = [{ id: 'fake-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['FAKE_AGENT_KEY'], format: 'Starts with fake-' } }];

/** An API key worker (Codex): the only kind an automatic run may send to, since the subscription agents are approve each only. */
function codexWorker(): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: 'codex' } });
  const agent: AgentPort = {
    displayName: 'Codex',
    permissionModes: ['ask', 'auto'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor('codex', agent, { signInMethods: API_KEY_ONLY }), agent, setup: undefined };
}

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: '_bmad-output/initiative-demo/epic-first/story-build-the-thing-plan.md' },
  { ref: '1.2', title: 'Build the next thing', plan: '_bmad-output/initiative-demo/epic-first/story-build-the-next-thing-plan.md', after: [1] },
];

const request = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });

const build = (id: string, ticket: string, extra: Record<string, unknown> = {}) => ({ id, build: { ticket }, reason: 'It is ready and has tests.', depends_on: [] as string[], ...extra });
const plan = (...steps: unknown[]) => ({ version: MANAGER_PLAN_VERSION, goal: 'Build the first ticket', steps });

async function setUp({ mode = 'approve_each', steps = [build('b1', '1.1')], buildsOn = true }: { mode?: 'approve_each' | 'automatic'; steps?: unknown[]; buildsOn?: boolean } = {}) {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_REPO_FILES, prefix: 'ogden-agents-build-repo-' });
  removeAfterTest(repo.path);
  fixtureGit(repo.path, 'config', 'core.hooksPath', '.husky');
  const manager = createMemoryManager({ plans: [plan(...steps)] });
  const server = await startTestServer({
    ticketStore: createPlanFileTicketStore(TICKETS) as unknown as TicketStorePort,
    sandbox: createFixedSandbox({ available: true, kind: 'test' }),
    extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '1' },
    manager,
    ...(mode === 'automatic' ? { extraAgents: [codexWorker()] } : {}),
  });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
  const settings = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await request(server, tab, 'PATCH', settings, { orchestrationEnabled: true, ...(mode === 'automatic' ? { orchestrationRoster: { worker: { kind: 'agent', agentId: 'codex' } } } : {}), ...(buildsOn ? { bmadPieces: ['board', 'builds'] } : {}), ...(mode === 'automatic' ? { orchestrationMode: 'automatic', confirm: true } : {}) })).status).toBe(200);
  if (buildsOn) expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const parse = async (reply: Response): Promise<OrchestrationRunView> => {
    const body: unknown = await reply.json();
    if (!reply.ok) throw new Error(`answered ${reply.status}: ${JSON.stringify(body)}`);
    return OrchestrationRunResponse.parse(body).run;
  };
  const runs = apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId });
  const start = async () => parse(await request(server, tab, 'POST', runs, { goal: 'Build the first ticket' }));
  const get = async (runId: string) => parse(await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId, runId })));
  const stepRoute = (route: keyof typeof API_ROUTES, runId: string, stepId: string) => apiPath(API_ROUTES[route], { wsId, runId, stepId });
  /** The Build dialog's own start path: the board's `POST /builds`. */
  const startBuild = async (ref: string) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref });
  const buildRuns = async () => RunsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()).runs;
  return { server, tab, wsId, manager, start, get, stepRoute, startBuild, buildRuns, repo };
}

describe('a build the manager proposes', () => {
  it('appears as a proposal for a ready ticket, the manager was told only the ready tickets, and nothing starts', async () => {
    const kit = await setUp();
    try {
      const view = await kit.start();
      expect(view.run.state).toBe('awaiting_user');
      expect(view.steps[0]).toMatchObject({ stepId: 'b1', state: 'proposed', sessionId: null, build: { ticketRef: '1.1', runId: null }, worker: 'claude-code' });
      expect(await kit.buildRuns()).toEqual([]);
      expect(kit.manager.calls.map((call) => call.method)).toEqual(['proposePlan']);
    } finally {
      await kit.server.close();
    }
  });

  it('is refused for a ticket that is not ready (its prerequisite is not done), and with builds off for the project', async () => {
    const waiting = await setUp({ steps: [build('b1', '1.2')] });
    try {
      const reply = await request(waiting.server, waiting.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId: waiting.wsId }), { goal: 'Build the next ticket' });
      expect(await refusalOf(reply)).toMatchObject({ status: 409, code: 'manager_failed', message: expect.stringContaining('not on the board or is not ready') });
    } finally {
      await waiting.server.close();
    }
    const off = await setUp({ buildsOn: false });
    try {
      const reply = await request(off.server, off.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId: off.wsId }), { goal: 'Build the first ticket' });
      expect((await refusalOf(reply)).code).toBe('manager_failed');
    } finally {
      await off.server.close();
    }
  });

  it('cannot be approved, edited or sent by any route, and no orchestration route starts a build', async () => {
    const kit = await setUp();
    try {
      const view = await kit.start();
      const runId = view.run.id;
      const before = kit.server.core.events.lastSeq();
      expect((await refusalOf(await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepApprove', runId, 'b1')))).code).toBe('step_not_proposed');
      expect((await refusalOf(await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepDispatch', runId, 'b1')))).code).toBe('step_not_approved');
      expect((await refusalOf(await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepEdit', runId, 'b1'), { instruction: 'Build it with everything allowed.' }))).code).toBe('step_not_changeable');
      // The one build route of the plan only records a run that exists: asking it to start one (a ticket, an agent, a mode) is refused.
      for (const body of [{ ref: '1.1' }, { ticket: '1.1', agent: 'claude-code', mode: 'unattended' }, { runId: 'run_01J00000000000000000000000', agent: 'claude-code' }, {}]) {
        const reply = await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepBuild', runId, 'b1'), body);
        expect(await refusalOf(reply)).toMatchObject({ status: 400, code: 'invalid_request' });
      }
      expect(await kit.buildRuns()).toEqual([]);
      expect(kit.server.core.events.readAfter(before).map((event) => event.type)).toEqual([]);
      expect((await kit.get(runId)).steps[0]).toMatchObject({ state: 'proposed', approvedBy: null });
    } finally {
      await kit.server.close();
    }
  });

  it('is waited at by an automatic run, with the plain reason, and starts nothing', async () => {
    const kit = await setUp({ mode: 'automatic' });
    try {
      const view = await kit.start();
      await waitFor(async () => (await kit.get(view.run.id)).waiting?.kind === 'build', 'the run to wait for the build');
      const waiting = await kit.get(view.run.id);
      expect(waiting).toMatchObject({ run: { state: 'awaiting_user', mode: 'automatic', stopReason: null }, waiting: { kind: 'build', stepId: 'b1', ticketRef: '1.1' } });
      expect(await kit.buildRuns()).toEqual([]);
      expect(kit.server.core.events.readAfter(0).filter((event) => event.type === 'orchestration.step_dispatched')).toHaveLength(0);
    } finally {
      await kit.server.close();
    }
  });
});

describe('the build the person starts in the Build dialog', () => {
  it('is linked to the step by the person, the step follows the run to built, the Runs list shows it, and the person still decides', async () => {
    const kit = await setUp({ steps: [build('b1', '1.1'), { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Summarise what was built.', mode: 'ask', depends_on: ['b1'] }] });
    try {
      const view = await kit.start();
      const runId = view.run.id;
      // The dialog's own path starts the build (a user action); nothing of the plan did.
      const started = await kit.startBuild('1.1');
      expect(started.status).toBe(201);
      const { run: built } = BuildResponse.parse(await started.json());

      // Another ticket's run, or a run the plan did not follow, is refused; the right one is linked.
      const linked = await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepBuild', runId, 'b1'), { runId: built.id });
      expect(linked.status).toBe(200);
      const after = OrchestrationRunResponse.parse(await linked.json()).run;
      expect(after.steps[0]).toMatchObject({ state: 'dispatched', approvedBy: 'user', build: { ticketRef: '1.1', runId: built.id } });

      await waitFor(async () => (await kit.get(runId)).steps[0]!.state === 'done', 'the build step to be built', 30_000);
      const done = await kit.get(runId);
      expect(done.steps[0]).toMatchObject({ state: 'done', buildRun: { outcome: 'verified', decision: null, checks: { passed: 3, failed: 0, notRun: 0 } } });
      expect(done.steps[0]!.report!.summary).toContain('ended built and verified');
      expect(done.steps[0]!.report!.summary).toContain('3 passed, 0 failed, 0 not run');
      // The manager read it back: it was asked what comes next with that summary and no code.
      await waitFor(async () => kit.manager.calls.filter((call) => call.method === 'decideNext').length >= 1, 'the manager to be asked what comes next');
      expect((await kit.get(runId)).decision).toMatchObject({ action: 'dispatch', stepId: 's2' });

      // The Runs list shows the build; the review page is where the person approves, and nothing here did.
      expect((await kit.buildRuns()).map((each) => [each.id, each.ticketRef, each.outcome, each.decision])).toEqual([[built.id, '1.1', 'verified', null]]);
      const review = ReviewResponse.parse(await (await request(kit.server, kit.tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId: kit.wsId, ref: '1.1' }))).json());
      expect(review.run).toMatchObject({ id: built.id, outcome: 'verified', decision: null });
      expect(kit.server.core.events.readAfter(0).filter((event) => event.type === 'run.decided')).toHaveLength(0);
    } finally {
      await kit.server.close();
    }
  }, 60_000);

  it('is refused when it is another ticket\'s build, and links nothing', async () => {
    const kit = await setUp({ steps: [build('b1', '1.1')] });
    try {
      const view = await kit.start();
      // Ticket 1.2 waits on 1.1, so build 1.1 here, then try to link a run that is not a build of the step's ticket.
      const started = BuildResponse.parse(await (await kit.startBuild('1.1')).json());
      const wrong = await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepBuild', view.run.id, 'b1'), { runId: 'run_01J00000000000000000000000' });
      expect(await refusalOf(wrong)).toMatchObject({ status: 400, code: 'invalid_request', message: expect.stringContaining('not a build of this ticket') });
      expect((await kit.get(view.run.id)).steps[0]).toMatchObject({ state: 'proposed', build: { runId: null } });
      // The real one still links, once.
      expect((await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepBuild', view.run.id, 'b1'), { runId: started.run.id })).status).toBe(200);
      expect((await refusalOf(await request(kit.server, kit.tab, 'POST', kit.stepRoute('workspaceOrchestrationStepBuild', view.run.id, 'b1'), { runId: started.run.id }))).code).toBe('step_not_proposed');
      await waitFor(async () => (await kit.get(view.run.id)).steps[0]!.state !== 'dispatched', 'the build to end', 30_000);
    } finally {
      await kit.server.close();
    }
  }, 60_000);
});
