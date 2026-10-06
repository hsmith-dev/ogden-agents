/// <reference lib="dom" />
/**
 * Orchestrate in a real browser (epic 15, story 15.3, the tracer bullet), with
 * the fake agent as the worker and the fake manager (`createMemoryManager`) as
 * the manager: no model and no real agent runs. A project starts without it;
 * the user turns Orchestration on in the project's settings and an Orchestrate
 * tab appears; a goal makes a plan; Approve and send puts the instruction into
 * a new worker chat, whose transcript says it came from the manager at the
 * user's approval; and the worker's status reads back on the page. With the
 * piece off there is no tab and the page says so; with no manager chosen the
 * page says so. Story 15.4: the user picks a model on one of their servers as
 * the project's manager in the settings, and a goal becomes a plan from that
 * model (the fake OpenAI-compatible server, on this computer).
 */
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { startFakeServer } from '../fixtures/fake-openai-server.mjs';
import { API_ROUTES, fakeSecondAgent, serverModule, startServer } from '../support.js';
import { withChatServer } from './chat-server.js';
import { openConnected, storedToken } from './tab.js';

/** Opens the project at `repo` through the REST API, with this tab's token, as the app does. */
async function addProject(page: Page, repo: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo }),
  });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

test('a goal becomes a plan, an approved instruction reaches a worker chat as the manager\'s, and the status reads back', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      await page.goto(`${server.url}/w/${wsId}`);
      // A new project is plain chats: no Orchestrate tab, and the page says it is off.
      await expect(page.getByTestId('workspace-tabs')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-orchestrate')).toHaveCount(0);
      await page.goto(`${server.url}/w/${wsId}/orchestrate`);
      await expect(page.getByTestId('orchestrate-feature-off')).toContainText('Orchestration is off in this project');

      // Turn it on in the project's settings: the tab appears.
      await page.getByTestId('orchestrate-open-settings').click();
      const toggle = page.getByRole('switch', { name: 'Use Orchestration in this project' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await page.goto(`${server.url}/w/${wsId}`);
      await page.getByTestId('workspace-tab-orchestrate').click();
      await expect(page.getByTestId('orchestrate')).toBeVisible();

      // A goal makes a plan.
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      const first = page.getByTestId('orchestrate-step').first();
      await expect(first).toHaveAttribute('data-state', 'proposed');
      await expect(first.getByTestId('orchestrate-step-worker')).toHaveText('Claude Code');
      await expect(first.getByTestId('orchestrate-step-instruction')).toHaveText('Work on the goal as Claude Code.');

      // Approve and send: the worker's chat gets it and the status reads back.
      await first.getByTestId('orchestrate-approve').click();
      await expect(first).toHaveAttribute('data-state', 'done');
      await expect(first.getByTestId('orchestrate-step-report')).toHaveText('Hello from the fake agent.');

      // The worker chat shows the instruction as the manager's, sent at the user's approval.
      await first.getByTestId('orchestrate-step-chat').click();
      await expect(page.getByTestId('message-from-manager')).toBeVisible();
      await expect(page.getByTestId('message-user').first()).toHaveText('Work on the goal as Claude Code.');
      await expect(page.getByTestId('message-origin')).toHaveText('Sent by the manager, approved by you');
      await expect(page.getByTestId('message-agent').last()).toContainText('Hello from the fake agent.');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    },
    { extra: { manager: createMemoryManager() } },
  );
});

test('with no manager set up the page says so, and a direct call to send an unapproved step is refused', async ({ page }) => {
  await withChatServer(page, async ({ server, repo }) => {
    const wsId = await addProject(page, repo);
    const origin = server.url;
    const token = (await storedToken(page))!;
    const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
    await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
    await page.goto(`${origin}/w/${wsId}/orchestrate`);
    await expect(page.getByTestId('orchestrate-no-manager')).toHaveText("No manager is chosen yet. Choose a model for the manager in this project's settings.");
    await expect(page.getByTestId('orchestrate-goal')).toBeDisabled();
    const refused = await fetch(`${origin}${apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId })}`, { method: 'POST', headers, body: JSON.stringify({ goal: 'Add a form' }) });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('manager_unavailable');
  });
});

test('the user picks a model on their own server as the manager, and a goal becomes a plan from it', async ({ page }) => {
  const plan = { version: 'ogden.manager.plan.v1', goal: 'Add a contact form', steps: [{ id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] }] };
  const model = await startFakeServer({ models: ['model-a', 'model-b'], managerCases: { e2e: { replies: [JSON.stringify(plan)] } } });
  try {
    await withChatServer(page, async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
      // The user's own server, on this computer.
      const added = await fetch(`${origin}${API_ROUTES.localEndpoints}`, { method: 'POST', headers, body: JSON.stringify({ label: 'My Mac', baseUrl: `http://127.0.0.1:${model.port}/v1` }) });
      expect(added.status).toBeLessThan(300);

      // Nothing is chosen yet: the page says so and the goal box is off.
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await expect(page.getByTestId('orchestrate-no-manager')).toContainText('No manager is chosen yet');
      await expect(page.getByTestId('orchestrate-goal')).toBeDisabled();

      // In the project's settings: read the server's models and use one as the manager.
      await page.goto(`${origin}/w/${wsId}/settings`);
      await expect(page.getByTestId('roster-holder-manager')).toHaveText(/^No model is ready to be the manager/);
      await page.getByTestId('roster-choose-model-manager').click();
      await page.getByRole('button', { name: 'Choose a model on My Mac for the manager' }).click();
      await page.getByRole('button', { name: 'Use model-b as the manager' }).click();
      await expect(page.getByTestId('roster-holder-manager')).toHaveText('model-b on this computer, on My Mac (your choice).');

      // Orchestrate says where the manager runs, and a goal becomes a plan from that model.
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await expect(page.getByTestId('orchestrate-manager')).toHaveText('The manager is model-b on this computer, on My Mac.');
      await page.getByTestId('orchestrate-goal').fill('Add a contact form MANAGER_CASE:e2e');
      await page.getByTestId('orchestrate-plan').click();
      const first = page.getByTestId('orchestrate-step').first();
      await expect(first).toHaveAttribute('data-state', 'proposed');
      await expect(first.getByTestId('orchestrate-step-instruction')).toHaveText('Write the failing test first.');
      // The model was asked on this computer, with no tools and no streaming.
      const asked = model.log.filter((entry) => entry.path.endsWith('/chat/completions'));
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((entry) => (entry.tools ?? []).length === 0 && entry.stream === false && entry.model === 'model-b')).toBe(true);
    });
  } finally {
    await model.close();
  }
});

test('the user assigns agents and models to the four roles, sees why an agent cannot take one, and a direct call that breaks a rule is refused', async ({ page }) => {
  const model = await startFakeServer({ models: ['model-a', 'model-b'] });
  try {
    // Grok is listed but not signed in on this server, so it is not ready: the roster says why.
    await withChatServer(
      page,
      async ({ server, repo }) => {
        const wsId = await addProject(page, repo);
        const origin = server.url;
        const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
        await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
        const added = await fetch(`${origin}${API_ROUTES.localEndpoints}`, { method: 'POST', headers, body: JSON.stringify({ label: 'My Mac', baseUrl: `http://127.0.0.1:${model.port}/v1` }) });
        expect(added.status).toBeLessThan(300);

        await page.goto(`${origin}/w/${wsId}/settings`);
        // The defaults: Claude Code works, nobody reviews (the only other agent is not ready), nobody manages (no model was set up with the server).
        await expect(page.getByTestId('roster-holder-worker')).toHaveText('Claude Code (the default).');
        await expect(page.getByTestId('roster-holder-reviewer')).toContainText('no second agent ready to review');
        await expect(page.getByTestId('roster-holder-manager')).toContainText('No model is ready to be the manager');
        await expect(page.getByTestId('roster-workers')).toHaveText('The manager may address: Claude Code (worker).');
        // The reasons: Claude Code is never the manager, and Grok is not ready, and a subscription agent is marked.
        await expect(page.getByTestId('roster-role-manager')).toContainText('The manager must be a model on one of your servers, not an agent.');
        await expect(page.getByTestId('roster-role-worker')).toContainText('Grok is not ready');
        await expect(page.getByTestId('roster-option-worker-agent:grok')).toBeDisabled();
        await expect(page.getByTestId('roster-note-worker')).toContainText('only takes instructions you approve one by one');

        // Assign: a model as the manager, and Claude Code as the planner, the worker and the reviewer (one holder, several roles).
        await page.getByTestId('roster-choose-model-manager').click();
        await page.getByRole('button', { name: 'Choose a model on My Mac for the manager' }).click();
        await page.getByRole('button', { name: 'Use model-a as the manager' }).click();
        await expect(page.getByTestId('roster-holder-manager')).toHaveText('model-a on this computer, on My Mac (your choice).');
        for (const role of ['planner', 'worker', 'reviewer']) {
          await page.getByTestId(`roster-option-${role}-agent:claude-code`).click();
          await expect(page.getByTestId(`roster-holder-${role}`)).toHaveText('Claude Code (your choice).');
        }
        await expect(page.getByTestId('roster-workers')).toHaveText('The manager may address: Claude Code (worker).');

        // It is kept: a reload shows the same team, and the server has it.
        await page.reload();
        await expect(page.getByTestId('roster-holder-reviewer')).toHaveText('Claude Code (your choice).');
        const stored = (await (await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { headers })).json()) as { settings: { orchestrationRoster: Record<string, { kind: string; model?: string; agentId?: string }> } };
        expect(stored.settings.orchestrationRoster).toMatchObject({ manager: { kind: 'model', model: 'model-a' }, planner: { agentId: 'claude-code' }, worker: { agentId: 'claude-code' }, reviewer: { agentId: 'claude-code' } });

        // A role goes back to the default.
        await page.getByTestId('roster-option-planner-default').click();
        await expect(page.getByTestId('roster-holder-planner')).toContainText('No model is ready to be the planner');

        // The server is the gate: a direct call that breaks a rule is refused with the reason, and nothing changes.
        const settingsUrl = `${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`;
        const asManager = await fetch(settingsUrl, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationRoster: { manager: { kind: 'agent', agentId: 'claude-code' } } }) });
        expect(asManager.status).toBe(400);
        expect(((await asManager.json()) as { error: { message: string } }).error.message).toBe('The manager must be a model on one of your servers, not an agent.');
        const notReady = await fetch(settingsUrl, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationRoster: { worker: { kind: 'agent', agentId: 'grok' } } }) });
        expect(notReady.status).toBe(400);
        expect(((await notReady.json()) as { error: { message: string } }).error.message).toContain('Grok is not ready');
        await page.reload();
        await expect(page.getByTestId('roster-holder-worker')).toHaveText('Claude Code (your choice).');
      },
      { extra: { grok: {} } },
    );
  } finally {
    await model.close();
  }
});

test('the team for new projects is set in Settings, and a project added afterwards starts with it', async ({ page }) => {
  await withChatServer(page, async ({ server, repo, tempFolder }) => {
    const origin = server.url;
    const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
    const before = await addProject(page, repo);
    await page.goto(`${origin}/settings/new-projects`);
    await expect(page.getByTestId('new-projects-team')).toBeVisible();
    await page.getByTestId('roster-option-reviewer-agent:claude-code').click();
    await expect(page.getByTestId('roster-holder-reviewer')).toHaveText('Claude Code (your choice).');
    const saved = (await (await fetch(`${origin}${API_ROUTES.teamRosterDefault}`, { headers })).json()) as { stored: { reviewer: { agentId: string } | null } };
    expect(saved.stored.reviewer).toEqual({ kind: 'agent', agentId: 'claude-code' });
    // A project that was there before keeps its own (none chosen); one added now starts with the team.
    const after = await addProject(page, tempFolder('ogden-agents-e2e-second-'));
    const rosterOf = async (wsId: string) => ((await (await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { headers })).json()) as { settings: { orchestrationRoster?: { reviewer: unknown } } }).settings.orchestrationRoster?.reviewer;
    expect(await rosterOf(after)).toEqual({ kind: 'agent', agentId: 'claude-code' });
    expect(await rosterOf(before)).toBeUndefined();
  });
});

test('the user reviews a three step plan: an edit needs a fresh approval, a skipped step never sends and its dependents wait, a bad reorder is refused, and Stop halts the run', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  const plan = {
    version: 'ogden.manager.plan.v1',
    goal: 'Add a contact form',
    steps: [
      { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] },
      { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: [] },
      { id: 's3', worker: 'claude-code', chat: 'new', instruction: 'Wire the form to the page.', mode: 'ask', depends_on: ['s2'] },
    ],
  };
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
      const call = (method: string, path: string, body?: unknown) => fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const refusal = async (reply: Response) => ({ status: reply.status, code: ((await reply.json()) as { error: { code: string } }).error.code });
      const chats = async () => ((await (await call('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()) as { sessions: unknown[] }).sessions.length;

      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      const rows = page.getByTestId('orchestrate-step');
      await expect(rows).toHaveCount(3);
      const order = () => rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-step-id')));
      const row = (id: string) => page.locator(`[data-testid="orchestrate-step"][data-step-id="${id}"]`);

      // Every step shows its worker, chat, instruction, mode and prerequisites.
      await expect(row('s3').getByTestId('orchestrate-step-worker')).toHaveText('Claude Code');
      await expect(row('s3').getByTestId('orchestrate-step-target')).toHaveText('Goes to a new chat');
      await expect(row('s3').getByTestId('orchestrate-step-mode')).toHaveText('Mode: Ask');
      await expect(row('s3').getByTestId('orchestrate-step-needs')).toHaveText('Needs s2 first');
      await expect(row('s1').getByTestId('orchestrate-step-needs')).toHaveText('Needs nothing first');

      // A reorder that puts a step before its prerequisite is refused, in plain words, and nothing moves. One that keeps them is taken.
      await page.getByRole('button', { name: 'Move step s3 up' }).click();
      await expect(page.getByTestId('orchestrate-error')).toContainText('Step s3 needs step s2 first, so it cannot come before it.');
      expect(await order()).toEqual(['s1', 's2', 's3']);
      await page.getByRole('button', { name: 'Move step s2 up' }).click();
      await expect.poll(order).toEqual(['s2', 's1', 's3']);
      await expect(page.getByTestId('orchestrate-error')).toHaveCount(0);

      // An edit of an approved step takes the approval back. The approval here is a direct call, as the page would make it.
      const runs = (await (await call('GET', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }))).json()) as { runs: Array<{ run: { id: string } }> };
      const runId = runs.runs[0]!.run.id;
      const stepPath = (key: 'workspaceOrchestrationStepApprove' | 'workspaceOrchestrationStepDispatch', stepId: string) => apiPath(API_ROUTES[key], { wsId, runId, stepId });
      expect((await call('POST', stepPath('workspaceOrchestrationStepApprove', 's1'))).status).toBe(200);
      await expect(row('s1').getByTestId('orchestrate-step-state')).toHaveText('Approved, not sent yet');
      await row('s1').getByTestId('orchestrate-edit').click();
      await expect(row('s1').getByTestId('orchestrate-edit-note')).toContainText('you will need to approve it again');
      await row('s1').getByTestId('orchestrate-edit-text').fill('Write two failing tests first.');
      await row('s1').getByTestId('orchestrate-edit-save').click();
      await expect(row('s1').getByTestId('orchestrate-step-state')).toHaveText('Waiting for you');
      await expect(row('s1').getByTestId('orchestrate-step-instruction')).toHaveText('Write two failing tests first.');
      await expect(row('s1').getByTestId('orchestrate-send')).toHaveCount(0);
      // The old approval cannot send the new text: a direct send is refused and no chat appears.
      expect(await refusal(await call('POST', stepPath('workspaceOrchestrationStepDispatch', 's1')))).toEqual({ status: 409, code: 'step_not_approved' });
      expect(await chats()).toBe(0);
      // A fresh approval sends the edited text.
      await row('s1').getByTestId('orchestrate-approve').click();
      await expect(row('s1')).toHaveAttribute('data-state', 'done');
      await row('s1').getByTestId('orchestrate-step-chat').click();
      await expect(page.getByTestId('message-user').first()).toHaveText('Write two failing tests first.');
      await page.goBack();
      await expect(page.getByTestId('orchestrate-steps')).toBeVisible();
      expect(await chats()).toBe(1);

      // A skipped step never sends, and the step that needs it waits.
      await row('s2').getByTestId('orchestrate-skip').click();
      await expect(row('s2')).toHaveAttribute('data-state', 'skipped');
      await expect(row('s3').getByTestId('orchestrate-step-waits')).toContainText('s2 was skipped, so this step will not go ahead');
      await expect(row('s3').getByTestId('orchestrate-approve')).toHaveCount(0);
      expect(await refusal(await call('POST', stepPath('workspaceOrchestrationStepApprove', 's2')))).toEqual({ status: 409, code: 'step_not_proposed' });
      expect(await refusal(await call('POST', stepPath('workspaceOrchestrationStepApprove', 's3')))).toEqual({ status: 409, code: 'step_not_proposed' });
      expect(await refusal(await call('POST', stepPath('workspaceOrchestrationStepDispatch', 's2')))).toEqual({ status: 409, code: 'step_not_approved' });
      expect(await refusal(await call('POST', stepPath('workspaceOrchestrationStepDispatch', 's3')))).toEqual({ status: 409, code: 'step_not_approved' });
      expect(await chats()).toBe(1);

      // Stop halts the run: nothing more can be approved or sent, and the page offers nothing more.
      await page.getByTestId('orchestrate-stop').click();
      await expect(page.getByTestId('orchestrate-run-state')).toHaveText('Stopped');
      await expect(page.getByTestId('orchestrate-stop')).toHaveCount(0);
      await expect(page.getByTestId('orchestrate-approve')).toHaveCount(0);
      await expect(page.getByTestId('orchestrate-edit')).toHaveCount(0);
      await expect(row('s3').getByTestId('orchestrate-step-state')).toHaveText('Not sent. The run was stopped.');
      expect(await refusal(await call('POST', stepPath('workspaceOrchestrationStepApprove', 's3')))).toEqual({ status: 409, code: 'step_not_proposed' });
      expect(await chats()).toBe(1);
    },
    { extra: { manager: createMemoryManager({ plans: [plan] }) } },
  );
});

/** The fake agent as a worker that signs in with an API key (like Codex and Grok), for the automatic mode; a subscription agent never is. */
async function apiKeyWorker(agentId: string, displayName: string) {
  const worker = await fakeSecondAgent({ agentId, displayName });
  return {
    ...worker,
    descriptor: { ...worker.descriptor, signInMethods: [{ id: 'fake-key', kind: 'api_key' as const, label: 'Use an API key', apiKey: { envNames: ['FAKE_AGENT_KEY'] as [string, ...string[]], format: 'Starts with fake-' } }] },
  };
}

const rosterOf = (worker: string, reviewer: string) => ({ worker: { kind: 'agent', agentId: worker }, reviewer: { kind: 'agent', agentId: reviewer } });

test('the user switches a project to Dispatch automatically with one confirmation, an automatic run goes within its limits, and the activity log lists what was sent', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  const plan = {
    version: 'ogden.manager.plan.v1',
    goal: 'Add a contact form',
    steps: [
      { id: 's1', worker: 'fake-codex', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] },
      { id: 's2', worker: 'fake-grok', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: ['s1'] },
      { id: 's3', worker: 'fake-codex', chat: 'new', instruction: 'Wire the form to the page.', mode: 'ask', depends_on: ['s2'] },
    ],
  };
  await withChatServer(
    page,
    async ({ server, repo, tempFolder }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      const settingsUrl = `${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`;
      const settings = async () => ((await (await fetch(settingsUrl, { headers })).json()) as { settings: { orchestrationMode?: string; orchestrationAutomaticConfirmed?: boolean } }).settings;
      expect((await fetch(settingsUrl, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true, orchestrationRoster: rosterOf('fake-codex', 'fake-grok') }) })).status).toBe(200);

      // The mode, plainly labelled, with Approve each instruction in force.
      await page.goto(`${origin}/w/${wsId}/settings`);
      const approveEach = page.getByTestId('orchestration-mode-approve_each');
      const automatic = page.getByTestId('orchestration-mode-automatic');
      await expect(approveEach).toHaveAttribute('data-state', 'checked');
      await expect(page.getByTestId('orchestration-mode-section')).toContainText('Dispatch automatically');
      await expect(page.getByTestId('orchestration-mode-section')).toContainText('You see every instruction and approve, edit or skip it before an agent gets it.');

      // Dispatch automatically asks once: Cancel changes nothing, the answer switches it, and it is on the record.
      await automatic.click();
      await expect(page.getByTestId('orchestration-mode-confirm')).toContainText('Your agents still ask you before they run a command or change a file.');
      await page.getByTestId('orchestration-mode-confirm-cancel').click();
      await expect(approveEach).toHaveAttribute('data-state', 'checked');
      expect((await settings()).orchestrationMode).toBeUndefined();
      await automatic.click();
      await page.getByTestId('orchestration-mode-confirm-button').click();
      await expect(automatic).toHaveAttribute('data-state', 'checked');
      expect(await settings()).toMatchObject({ orchestrationMode: 'automatic', orchestrationAutomaticConfirmed: true });
      // Back at any time, and on again without a second question.
      await approveEach.click();
      await expect(approveEach).toHaveAttribute('data-state', 'checked');
      await automatic.click();
      await expect(page.getByTestId('orchestration-mode-confirm')).toHaveCount(0);
      await expect(automatic).toHaveAttribute('data-state', 'checked');
      // The server is the gate: another project asks for itself, and a direct call without the answer is refused.
      const other = await addProject(page, tempFolder('ogden-agents-e2e-other-'));
      const direct = await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId: other })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationMode: 'automatic' }) });
      expect(direct.status).toBe(400);
      expect(((await direct.json()) as { error: { code: string } }).error.code).toBe('confirmation_required');

      // The limits are set in Settings for new projects: two instructions.
      await page.goto(`${origin}/settings/new-projects`);
      await page.getByTestId('orchestration-limit-maxInstructions').fill('2');
      await page.getByTestId('orchestration-limits-save').click();
      await expect(page.getByTestId('orchestration-defaults-status')).toHaveText('Saved.');

      // An automatic run: the manager's plan is sent step by step with nobody pressing anything, and stops at its limit.
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await expect(page.getByTestId('orchestrate-mode')).toContainText('Dispatch automatically');
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'stopped', { timeout: 20_000 });
      await expect(page.getByTestId('orchestrate-stop-reason')).toHaveText('The run stopped because it sent 2 instructions, the limit. Nothing more was sent.');
      await expect(page.getByTestId('orchestrate-run-counter')).toHaveText('2 of 2 instructions sent. Dispatching automatically.');
      const row = (id: string) => page.locator(`[data-testid="orchestrate-step"][data-step-id="${id}"]`);
      await expect(row('s1').getByTestId('orchestrate-step-state')).toHaveText('Finished');
      await expect(row('s2').getByTestId('orchestrate-step-state')).toHaveText('Finished');
      await expect(row('s1').getByTestId('orchestrate-step-approver')).toHaveText('Sent automatically');
      await expect(row('s3').getByTestId('orchestrate-step-state')).toHaveText('Not sent. The run was stopped.');
      await expect(page.getByTestId('orchestrate-stop')).toHaveCount(0);

      // The activity log lists each instruction that was sent: worker, who approved it, chat and result, newest first.
      const entries = page.getByTestId('orchestrate-activity-entry');
      await expect(entries).toHaveCount(2);
      await expect(entries.nth(0).getByTestId('orchestrate-activity-worker')).toHaveText('Fake Grok');
      await expect(entries.nth(1).getByTestId('orchestrate-activity-worker')).toHaveText('Fake Codex');
      await expect(entries.nth(0).getByTestId('orchestrate-activity-who')).toHaveText('Approved by the mode, automatically, sent to a new chat');
      await expect(entries.nth(0).getByTestId('orchestrate-activity-result')).toHaveText('Finished');
      await expect(entries.nth(1).getByTestId('orchestrate-activity-instruction')).toHaveText('Write the failing test first.');

      // The worker's transcript says the manager sent it automatically.
      await entries.nth(1).getByTestId('orchestrate-activity-chat').click();
      await expect(page.getByTestId('message-origin')).toHaveText('Sent by the manager automatically');
      await expect(page.getByTestId('message-user').first()).toHaveText('Write the failing test first.');
    },
    { extra: { manager: createMemoryManager({ plans: [plan] }), extraAgents: [await apiKeyWorker('fake-codex', 'Fake Codex'), await apiKeyWorker('fake-grok', 'Fake Grok')] } },
  );
});

test('Stop halts an automatic run, cancels the worker\'s turn and sends nothing more, and still works with the piece switched off', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  const plan = {
    version: 'ogden.manager.plan.v1',
    goal: 'Add a contact form',
    steps: [
      { id: 's1', worker: 'fake-codex', chat: 'new', instruction: 'hold', mode: 'ask', depends_on: [] },
      { id: 's2', worker: 'fake-grok', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: ['s1'] },
    ],
  };
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      const call = (method: string, path: string, body?: unknown) => fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const sessions = async () => ((await (await call('GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()) as { sessions: Array<{ id: string; state: string; agentId: string }> }).sessions;
      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { orchestrationEnabled: true, orchestrationRoster: rosterOf('fake-codex', 'fake-grok'), orchestrationMode: 'automatic', confirm: true })).status).toBe(200);

      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      const first = page.locator('[data-testid="orchestrate-step"][data-step-id="s1"]');
      // The first instruction went by itself and the worker is holding on it.
      await expect(first.getByTestId('orchestrate-step-state')).toHaveText('Sent, the worker is on it');
      await expect(first.getByTestId('orchestrate-step-session-state')).toHaveAttribute('data-session-state', 'working');
      expect((await sessions()).filter((session) => session.state === 'working')).toHaveLength(1);

      // Stop: the run ends, the worker's turn is cancelled, and the next step is never sent.
      await page.getByTestId('orchestrate-stop').click();
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'stopped');
      await expect(page.getByTestId('orchestrate-stopped-note')).toContainText('You stopped this run.');
      await expect.poll(async () => (await sessions()).map((session) => session.state)).toEqual(['idle']);
      await expect(page.locator('[data-testid="orchestrate-step"][data-step-id="s2"]').getByTestId('orchestrate-step-state')).toHaveText('Not sent. The run was stopped.');
      await expect(page.getByTestId('orchestrate-stop')).toHaveCount(0);
      expect(await sessions()).toHaveLength(1);
      // The instruction it sent is in the activity log, and nothing says money.
      await expect(page.getByTestId('orchestrate-activity-entry')).toHaveCount(1);
      await expect(page.getByTestId('orchestrate')).not.toContainText(/\$|cost|budget/i);
    },
    { extra: { manager: createMemoryManager({ plans: [plan] }), extraAgents: [await apiKeyWorker('fake-codex', 'Fake Codex'), await apiKeyWorker('fake-grok', 'Fake Grok')] } },
  );
});

test('a Stop cannot be blocked: with the piece switched off the run still stops, and in the default mode a direct send of an unapproved step is refused', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      const call = (method: string, path: string, body?: unknown) => fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { orchestrationEnabled: true });
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      await expect(page.getByTestId('orchestrate-step')).toHaveCount(1);
      const runId = ((await (await call('GET', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }))).json()) as { runs: Array<{ run: { id: string } }> }).runs[0]!.run.id;
      // In the default mode a send nobody approved is refused in code.
      const unapproved = await call('POST', apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId, stepId: 's1' }));
      expect(unapproved.status).toBe(409);
      expect(((await unapproved.json()) as { error: { code: string } }).error.code).toBe('step_not_approved');

      // The piece is switched off: the page is gone and every call is refused as off, but Stop still ends the run.
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { orchestrationEnabled: false });
      expect((await call('GET', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }))).status).toBe(409);
      const stopped = await call('POST', apiPath(API_ROUTES.workspaceOrchestrationStop, { wsId, runId }));
      expect(stopped.status).toBe(200);
      expect(((await stopped.json()) as { run: { run: { state: string; stopReason: string } } }).run.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
      // Turned on again, the run reads as stopped.
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { orchestrationEnabled: true });
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'stopped');
    },
    { extra: { manager: createMemoryManager() } },
  );
});


// ---- the loop (15.9) ----

const claudePlan = {
  version: 'ogden.manager.plan.v1',
  goal: 'Add a contact form',
  steps: [
    { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'permission', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: ['s1'] },
  ],
};
const row = (page: Page, id: string) => page.locator(`[data-testid="orchestrate-step"][data-step-id="${id}"]`);

test('a requested shell command waits on its card: the run pauses with a link to that chat, the user answers on the worker\'s own card, and the run goes on with the manager\'s suggestion', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      await row(page, 's1').getByTestId('orchestrate-approve').click();

      // The worker asks to run a command: the run pauses, plainly, with a link to the chat that holds the card.
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'paused');
      await expect(page.getByTestId('orchestrate-run-state')).toHaveText('Paused, waiting for you');
      await expect(page.getByTestId('orchestrate-waiting-words')).toHaveText("A worker is waiting for your answer on its permission card, so the run is paused. Answer the card in the worker's chat and the run goes on.");
      // Nothing answers it here, and nothing else is offered meanwhile (only Stop).
      await expect(page.getByTestId('orchestrate-approve')).toHaveCount(0);
      await expect(page.getByTestId('orchestrate-stop')).toBeVisible();
      await page.waitForTimeout(800);
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'paused');

      // The user answers on the worker's own card.
      await page.getByTestId('orchestrate-waiting-chat').click();
      await expect(page.getByTestId('permission-card')).toBeVisible();
      await expect(page.getByTestId('permission-command')).toHaveText('npm test');
      await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
      await expect(page.getByTestId('message-agent').last()).toContainText('Ran npm test.');
      await page.goBack();

      // The run goes on: the step finished, and the manager suggests the next one, which still waits for the user.
      await expect(row(page, 's1').getByTestId('orchestrate-step-state')).toHaveText('Finished');
      await expect(page.getByTestId('orchestrate-decision')).toContainText('The manager suggests step s2 next.');
      await expect(row(page, 's2').getByTestId('orchestrate-step-suggested')).toBeVisible();
      await expect(row(page, 's2').getByTestId('orchestrate-step-state')).toHaveText('Waiting for you');
      await row(page, 's2').getByTestId('orchestrate-approve').click();
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'finished');
    },
    { extra: { manager: createMemoryManager({ plans: [claudePlan] }) } },
  );
});

test('Deny on the worker\'s card ends the step, stops the run, and the manager is told it was denied', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  const manager = createMemoryManager({ plans: [claudePlan], decisions: [{ version: 'ogden.manager.decision.v1', action: 'stop', reason: 'The command was denied, so I stop.' }] });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      await row(page, 's1').getByTestId('orchestrate-approve').click();
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'paused');
      await page.getByTestId('orchestrate-waiting-chat').click();
      await page.getByTestId('permission-card').getByRole('button', { name: 'Deny' }).click();
      await expect(page.getByTestId('permission-record')).toContainText('Denied: npm test');
      await page.goBack();

      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'stopped');
      await expect(row(page, 's1').getByTestId('orchestrate-step-state')).toHaveText('Denied, the step ended');
      await expect(page.getByTestId('orchestrate-stop-reason')).toHaveAttribute('data-stop-reason', 'permission_denied');
      await expect(row(page, 's2').getByTestId('orchestrate-step-state')).toHaveText('Not sent. The run was stopped.');
      // The manager was told, and what it said is shown.
      await expect(page.getByTestId('orchestrate-decision')).toContainText('The manager was told the permission was denied. It said: stop. The command was denied, so I stop.');
      expect(manager.calls.filter((call) => call.method === 'decideNext')).toHaveLength(1);
      await expect(page.getByTestId('orchestrate-activity-entry').first().getByTestId('orchestrate-activity-result')).toHaveText('Denied, the step ended');
    },
    { extra: { manager } },
  );
});

test('the manager\'s question waits for the user, and the answer reaches the manager before it decides', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  const plan = { ...claudePlan, steps: [{ ...claudePlan.steps[0]!, instruction: 'Write the failing test first.' }, claudePlan.steps[1]!] };
  const manager = createMemoryManager({
    plans: [plan],
    decisions: [
      { version: 'ogden.manager.decision.v1', action: 'ask_user', reason: 'It needs a choice.', question: 'Which fields should the form have?' },
      { version: 'ogden.manager.decision.v1', action: 'done', reason: 'The test is enough for now.' },
    ],
  });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const origin = server.url;
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' };
      await fetch(`${origin}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true }) });
      await page.goto(`${origin}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      await row(page, 's1').getByTestId('orchestrate-approve').click();
      await expect(page.getByTestId('orchestrate-question')).toHaveText('Which fields should the form have?');
      await expect(page.getByTestId('orchestrate-run-state')).toHaveText('Waiting for you');
      await page.getByTestId('orchestrate-answer').fill('Name and email');
      await page.getByTestId('orchestrate-answer-send').click();
      // The manager decides with the answer; here it says the goal is done.
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'finished');
      await expect(page.getByTestId('orchestrate-decision')).toContainText('The manager says the goal is done. The test is enough for now.');
      await expect(row(page, 's2').getByTestId('orchestrate-step-state')).toHaveText('Not needed, the manager said the goal is done');
    },
    { extra: { manager } },
  );
});

test('a restart in the middle of an automatic run picks it up without a second dispatch, and it goes on when the worker finishes', async ({ page }) => {
  const { createMemoryManager } = await serverModule();
  const plan = {
    version: 'ogden.manager.plan.v1',
    goal: 'Add a contact form',
    steps: [
      { id: 's1', worker: 'fake-codex', chat: 'new', instruction: 'permission', mode: 'ask', depends_on: [] },
      { id: 's2', worker: 'fake-grok', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: ['s1'] },
    ],
  };
  const manager = createMemoryManager({ plans: [plan] });
  const extra = { manager, extraAgents: [await apiKeyWorker('fake-codex', 'Fake Codex'), await apiKeyWorker('fake-grok', 'Fake Grok')] };
  await withChatServer(
    page,
    async ({ server, repo, dataDir }) => {
      const wsId = await addProject(page, repo);
      const headers = { authorization: `Bearer ${(await storedToken(page))!}`, origin: server.url, 'content-type': 'application/json' };
      expect((await fetch(`${server.url}${apiPath(API_ROUTES.workspaceSettings, { wsId })}`, { method: 'PATCH', headers, body: JSON.stringify({ orchestrationEnabled: true, orchestrationRoster: rosterOf('fake-codex', 'fake-grok'), orchestrationMode: 'automatic', confirm: true }) })).status).toBe(200);
      await page.goto(`${server.url}/w/${wsId}/orchestrate`);
      await page.getByTestId('orchestrate-goal').fill('Add a contact form');
      await page.getByTestId('orchestrate-plan').click();
      // The first instruction went by itself and its worker waits on a card.
      await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'paused');
      await expect(page.getByTestId('orchestrate-waiting')).toHaveAttribute('data-waiting', 'permission_card');
      await server.close();

      // The app starts again on the same data folder.
      const second = await startServer(dataDir, 0, extra);
      try {
        await openConnected(page, `/w/${wsId}/orchestrate`, second.launchUrl);
        await expect(page.getByTestId('orchestrate-waiting')).toHaveAttribute('data-waiting', 'interrupted');
        await expect(page.getByTestId('orchestrate-waiting-words')).toContainText('Ogden Agents was restarted while a worker was in the middle of its turn. Nothing was sent again.');
        await expect(page.getByTestId('orchestrate-run-counter')).toHaveText('1 of 20 instructions sent. Dispatching automatically.');
        await expect(row(page, 's1').getByTestId('orchestrate-step-state')).toHaveText('Sent, the worker is on it');
        await expect(row(page, 's2').getByTestId('orchestrate-step-state')).toHaveText('Waiting for you');

        // The user lets the worker carry on in its own chat; when it finishes, the run goes on by itself, and the first instruction is never sent again.
        await page.getByTestId('orchestrate-waiting-chat').click();
        const composer = page.getByRole('textbox', { name: 'Message Fake Codex' });
        await composer.fill('Please carry on.');
        await composer.press('Enter');
        await expect(composer).toHaveValue('');
        await expect(page.getByTestId('message-agent').last()).toContainText('Hello from the fake agent.');
        await page.goBack();
        await expect(page.getByTestId('orchestrate-run')).toHaveAttribute('data-run-state', 'finished', { timeout: 20_000 });
        await expect(page.getByTestId('orchestrate-run-counter')).toHaveText('2 of 20 instructions sent. Dispatching automatically.');
        await expect(page.getByTestId('orchestrate-activity-entry')).toHaveCount(2);
        const origins = await page.evaluate(
          async ({ url, wsId: ws, token }) => {
            const list = (await (await fetch(`${url}/api/v1/workspaces/${ws}/sessions`, { headers: { authorization: `Bearer ${token}` } })).json()) as { sessions: unknown[] };
            return list.sessions.length;
          },
          { url: second.url, wsId, token: (await storedToken(page))! },
        );
        expect(origins).toBe(2);
      } finally {
        await second.close();
      }
    },
    { extra },
  );
});
