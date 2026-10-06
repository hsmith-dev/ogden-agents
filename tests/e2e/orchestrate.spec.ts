/// <reference lib="dom" />
/**
 * Orchestrate in a real browser (epic 15, story 15.3, the tracer bullet), with
 * the fake agent as the worker and the fake manager (`createMemoryManager`) as
 * the manager: no model and no real agent runs. A project starts without it;
 * the user turns Orchestration on in the project's settings and an Orchestrate
 * tab appears; a goal makes a plan; Approve and send puts the instruction into
 * a new worker chat, whose transcript says it came from the manager at the
 * user's approval; and the worker's status reads back on the page. With the
 * piece off there is no tab and the page says so; with no manager the page says
 * "no manager yet".
 */
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
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
    await expect(page.getByTestId('orchestrate-no-manager')).toHaveText('There is no manager yet. A manager model comes with a later update, so a plan cannot be made here yet.');
    await expect(page.getByTestId('orchestrate-goal')).toBeDisabled();
    const refused = await fetch(`${origin}${apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId })}`, { method: 'POST', headers, body: JSON.stringify({ goal: 'Add a form' }) });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('manager_unavailable');
  });
});
