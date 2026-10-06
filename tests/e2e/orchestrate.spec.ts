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
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

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
