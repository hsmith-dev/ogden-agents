/**
 * The reviewer role (epic 15, story 15.10) on a real server: the real chat, core and database, fake Codex and Grok workers (the fake ACP agent
 * under their own ids, API key only) and the fake manager. Codex produces a result, the roster's reviewer (Grok) is asked a bounded question
 * about it (the manager's question and a capped, masked summary, never code or diffs), the answer comes back through the read-back capped and
 * masked, the review step links to the worker chat, and nothing in the flow approves, merges or marks anything done. No real agent, model,
 * network or keychain.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent, createMemoryManager } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort, ManagerPort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MANAGER_LIMITS,
  MANAGER_PLAN_VERSION,
  REVIEW_LIMITS,
  isReviewMessageFor,
  OrchestrationRunResponse,
  WorkspaceResponse,
  type OrchestrationRunView,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentWiring } from '../src/agent-wiring.js';
import { signIn, startTestServer, tempDataDir, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const API_KEY_ONLY: AgentDescriptor['signInMethods'] = [{ id: 'fake-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['FAKE_AGENT_KEY'], format: 'Starts with fake-' } }];

function worker(agentId: string, displayName: string): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: agentId } });
  const agent: AgentPort = {
    displayName,
    permissionModes: ['ask', 'auto'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor(agentId, agent, { signInMethods: API_KEY_ONLY }), agent, setup: undefined };
}
const WORKERS = [worker('codex', 'Codex'), worker('grok', 'Grok')];

const folders: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });
const agentRole = (agentId: string) => ({ kind: 'agent' as const, agentId });

interface Kit {
  server: TestServer;
  tab: SignedIn;
  wsId: string;
  repo: string;
}

/** Starts a server (on `dataDir` when given, as a restart does) and, on a fresh data folder, opens the project and turns Orchestration on. */
async function open({ dataDir, manager, mode, existing }: { dataDir: string; manager: ManagerPort; mode: 'approve_each' | 'automatic'; existing?: { wsId: string; repo: string } }): Promise<Kit> {
  const server = await startTestServer({ dataDir, extraAgents: WORKERS, manager });
  servers.push(server);
  const tab = await signIn(server);
  if (existing !== undefined) return { server, tab, ...existing };
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  folders.push(repo);
  const wsId = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const settings = apiPath(API_ROUTES.workspaceSettings, { wsId });
  const body = { orchestrationEnabled: true, orchestrationRoster: { worker: agentRole('codex'), reviewer: agentRole('grok') }, ...(mode === 'automatic' ? { orchestrationMode: 'automatic', confirm: true } : {}) };
  expect((await call(server, tab, 'PATCH', settings, body)).status).toBe(200);
  return { server, tab, wsId, repo };
}

const api = (kit: Kit) => {
  const runs = apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId: kit.wsId });
  const at = (runId: string) => apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId: kit.wsId, runId });
  const parse = async (reply: Response): Promise<OrchestrationRunView> => OrchestrationRunResponse.parse(await reply.json()).run;
  return {
    start: async () => {
      const reply = await call(kit.server, kit.tab, 'POST', runs, { goal: 'Do the work' });
      if (!reply.ok) throw new Error(`start failed: ${await reply.text()}`);
      return parse(reply);
    },
    get: async (runId: string) => parse(await call(kit.server, kit.tab, 'GET', at(runId))),
    approve: (runId: string, stepId: string) => call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepApprove, { wsId: kit.wsId, runId, stepId })),
    send: async (runId: string, stepId: string) => parse(await call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId: kit.wsId, runId, stepId }))),
    answer: (runId: string, answer: string) => call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationAnswer, { wsId: kit.wsId, runId }), { answer }),
    /** The user's answer on a worker's own card. */
    card: (sessionId: string, requestId: string, decisionOf: 'allow_once' | 'deny') => call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId: kit.wsId, sesId: sessionId, requestId }), { decision: decisionOf }),
    requestOf: (sessionId: string): string => {
      const asked = kit.server.core.events.readAfter(0).find((event) => event.type === 'permission.requested' && event.streamId === sessionId);
      return asked?.type === 'permission.requested' ? asked.payload.requestId : '';
    },
  };
};

const stateOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!.state;
const sessionOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!.sessionId!;
const eventsOf = (kit: Kit, type: string) => kit.server.core.events.readAfter(0).filter((event) => event.type === type);

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const QUESTION = 'review-echo Is the change safe, and did it miss anything?';
/** The work step's result: a secret, a fenced file and a diff the reviewer must never be sent. */
const WORK = `reply-with Fixed the login form. The key is {{SECRET}}.\n\`\`\`ts\nexport const privateFile = 2;\n\`\`\`\ndiff --git a/src/login.ts b/src/login.ts\n--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1 +1 @@\n-const a = 1;\n+const secretChange = 2;\n\nAll the tests pass.`;

function reviewPlan(overrides: Record<string, unknown> = {}) {
  return {
    version: MANAGER_PLAN_VERSION,
    goal: 'Fix the login form',
    steps: [
      { id: 's1', worker: 'codex', chat: 'new', instruction: WORK, mode: 'ask', depends_on: [] },
      { id: 's2', worker: 'grok', chat: 'new', instruction: QUESTION, mode: 'ask', depends_on: ['s1'], review_of: 's1', ...overrides },
      { id: 's3', worker: 'codex', chat: 'new', instruction: 'Apply what the reviewer found.', mode: 'ask', depends_on: ['s2'] },
    ],
  };
}

describe('the reviewer role on a real server', () => {
  it('has the roster\'s reviewer asked a bounded question about the work, and the answer comes back masked and capped', async () => {
    const memory = createMemoryManager({ plans: [reviewPlan()] });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'approve_each' });
    const { start, get, approve, send } = api(kit);
    const run = await start();
    expect(run.steps.map((step) => [step.stepId, step.reviewOf])).toEqual([
      ['s1', null],
      ['s2', 's1'],
      ['s3', null],
    ]);
    expect((await approve(run.run.id, 's1')).status).toBe(200);
    const sent = await send(run.run.id, 's1');
    await waitFor(async () => stateOf(await get(run.run.id), 's1') === 'done', 'the work to finish', 8000);
    await waitFor(async () => (await get(run.run.id)).decision?.action === 'dispatch', 'the manager to suggest the review', 8000);

    // The page can link to the chat that did the work.
    const before = await get(run.run.id);
    expect(before.steps[1]!.review).toEqual({ kind: 'worker_chat', sessionId: sessionOf(sent, 's1') });

    expect((await approve(run.run.id, 's2')).status).toBe(200);
    await send(run.run.id, 's2');
    await waitFor(async () => stateOf(await get(run.run.id), 's2') === 'done', 'the reviewer to answer', 8000);
    const done = await get(run.run.id);

    // What the reviewer was sent: its own question, the framing and the summary; capped, masked, no file contents or diffs.
    const report = done.steps.find((step) => step.stepId === 's2')!.report!;
    const received = /RECEIVED<<([\s\S]*?)>>RECEIVED/.exec(report.summary)![1]!;
    expect(received.startsWith(QUESTION)).toBe(true);
    expect(isReviewMessageFor(received, QUESTION)).toBe(true);
    expect(received.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxMessageChars);
    expect(received).toContain('Fixed the login form.');
    expect(received).toContain('All the tests pass.');
    for (const never of ['sk-ant', 'privateFile', 'secretChange', 'diff --git']) expect(received).not.toContain(never);
    // It was sent into a new chat of the reviewer, as the manager's instruction, in the chat's own mode.
    const reviewerChat = sessionOf(done, 's2');
    expect(reviewerChat).not.toBe(sessionOf(done, 's1'));
    const marks = kit.server.core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.streamId === reviewerChat && event.payload.role === 'user');
    expect(marks.map((event) => (event.type === 'session.message_completed' ? event.payload.origin : ''))).toEqual(['manager']);

    // The answer: a long reply that held a secret is capped and masked for the page and for the manager.
    expect(report.summary.length).toBeLessThanOrEqual(MANAGER_LIMITS.maxSummaryChars);
    expect(report.truncated).toBe(true);
    expect(report.summary).not.toContain('sk-ant');
    const reads = eventsOf(kit, 'orchestration.result_read').map((event) => (event.type === 'orchestration.result_read' ? event.payload.report : undefined));
    const stored = reads.find((each) => each?.step_id === 's2')!;
    expect(stored.summary.length).toBeLessThanOrEqual(MANAGER_LIMITS.maxSummaryChars);
    expect(JSON.stringify(stored)).not.toContain('sk-ant');
    // The manager was asked what comes next, and suggests the step after the review.
    await waitFor(async () => (await get(run.run.id)).decision?.stepId === 's3', 'the manager to suggest the next step', 8000);
  });

  it('refuses a plan whose review step is not for the reviewer, does not wait for the work, or asks too long a question', async () => {
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ worker: 'codex' }, /reviewer/],
      [{ depends_on: [] }, /wait for the step it reviews/],
      [{ instruction: `review-echo ${'q'.repeat(REVIEW_LIMITS.maxQuestionChars)}` }, /at most 600 characters/],
    ];
    for (const [overrides, words] of bad) {
      const kit = await open({ dataDir: tempDataDir(), manager: createMemoryManager({ plans: [reviewPlan(overrides)] }), mode: 'approve_each' });
      const refused = await refusalOf(await call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId: kit.wsId }), { goal: 'Fix the login form' }));
      expect(refused).toMatchObject({ status: 409, code: 'manager_failed' });
      expect(refused.message).toMatch(words);
      expect(eventsOf(kit, 'orchestration.step_dispatched')).toHaveLength(0);
    }
  });

  it('refuses the review when the user changes the roster so that Grok is a worker but not the reviewer, and nothing is created', async () => {
    const kit = await open({ dataDir: tempDataDir(), manager: createMemoryManager({ plans: [reviewPlan()] }), mode: 'approve_each' });
    const { start, get, approve, send } = api(kit);
    const run = await start();
    await approve(run.run.id, 's1');
    await send(run.run.id, 's1');
    await waitFor(async () => stateOf(await get(run.run.id), 's1') === 'done', 'the work to finish', 8000);
    await approve(run.run.id, 's2');
    const settings = apiPath(API_ROUTES.workspaceSettings, { wsId: kit.wsId });
    expect((await call(kit.server, kit.tab, 'PATCH', settings, { orchestrationRoster: { worker: agentRole('grok'), reviewer: agentRole('codex') } })).status).toBe(200);
    const refused = await call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId: kit.wsId, runId: run.run.id, stepId: 's2' }));
    expect(await refusalOf(refused)).toMatchObject({ status: 409, code: 'dispatch_refused', details: { reason: 'not_the_reviewer' } });
    expect(eventsOf(kit, 'orchestration.step_dispatched')).toHaveLength(1);
  });

  it('gives the manager and the reviewer no way to approve, merge or mark a ticket done: nothing in the flow decides a run or a ticket', async () => {
    const memory = createMemoryManager({ plans: [reviewPlan()] });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'approve_each' });
    const { start, get, approve, send } = api(kit);
    const run = await start();
    for (const stepId of ['s1', 's2']) {
      await approve(run.run.id, stepId);
      await send(run.run.id, stepId);
      await waitFor(async () => stateOf(await get(run.run.id), stepId) === 'done', `${stepId} to finish`, 8000);
    }
    const types = kit.server.core.events.readAfter(0).map((event) => event.type);
    for (const never of ['run.decided', 'ticket.changed', 'run.created', 'run.outcome_changed']) expect(types).not.toContain(never);
    // The orchestration routes hold nothing that builds, approves, rejects, merges or marks.
    const names = Object.keys(API_ROUTES).filter((name) => name.startsWith('workspaceOrchestration'));
    expect(names.length).toBeGreaterThan(8);
    for (const name of names) expect(name).not.toMatch(/Build|Ticket|Merge|Reject|Done|Mark/);
    // The review page's own routes answer a person only: the manager's run does not reach them, and an unknown ticket has no review.
    const review = await call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId: kit.wsId, ref: '5.2' }), { revision: 'abc' });
    expect(review.status).toBeGreaterThanOrEqual(400);
    expect(eventsOf(kit, 'run.decided')).toHaveLength(0);
  });
});
