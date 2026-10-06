/// <reference lib="dom" />
/**
 * Needs you and webhooks in a real browser (story 11.4): a webhook added in
 * Settings, Notifications (its address typed once, shown back by its domain
 * only) with Send test and its result inline; a blocked run and a run ready
 * for review each reach Needs you with the tab title's count and each send one
 * payload to a subscribed webhook (to a recording notifier, never the
 * network); nothing for a project with builds off.
 *
 * Real `git`; a ticket store that reads and writes the plan files; a fixed
 * sandbox answer; no real `claude`, keychain or network.
 */
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];
const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };
const SECRET_URL = 'https://hooks.example.com/services/T0K3N-SECRET';

/** A notifier that records every send and answers what the test says; nothing leaves the machine. */
function recordingNotifier() {
  const sent: Array<{ url: string; payload: { event: string; text: string; ticket: { ref: string; title: string } | null } }> = [];
  const answer = { current: { ok: true, status: 204, failure: null as string | null, message: 'The webhook answered with HTTP 204.' } };
  return { sent, answer, notifier: { send: async (url: string, payload: never) => (sent.push({ url, payload }), answer.current) } };
}

async function prepare(page: import('@playwright/test').Page, repo: string, pieces: string[] = ['board', 'builds']) {
  fixtureGit(repo, 'init', '-q', '--initial-branch=main');
  fixtureGit(repo, 'config', 'core.autocrlf', 'false');
  fixtureGit(repo, 'config', 'user.name', 'Fixture');
  fixtureGit(repo, 'config', 'user.email', 'fixture@example.com');
  fixtureGit(repo, 'add', '-A');
  fixtureGit(repo, 'commit', '-q', '--no-verify', '-m', 'The fixture');
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const wsId = ((await (await call('POST', API_ROUTES.workspaces, { path: repo })).json()) as { workspace: { id: string } }).workspace.id;
  expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: pieces })).status).toBe(200);
  expect((await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  return { call, wsId };
}

test('a webhook is added in Settings, shown by its domain only, and Send test shows the result inline', async ({ page }) => {
  const fake = recordingNotifier();
  await withChatServer(
    page,
    async ({ server }) => {
      await page.goto(`${server.url}/settings/notifications`);
      await expect(page.getByTestId('webhooks-none')).toBeVisible();
      await page.getByTestId('webhook-url').fill('http://hooks.example.com/x');
      await page.getByTestId('webhook-add').click();
      await expect(page.getByTestId('webhook-add-error')).toBeVisible();
      await page.getByTestId('webhook-url').fill(SECRET_URL);
      await page.getByTestId('webhook-add').click();
      await expect(page.getByTestId('webhook-host')).toHaveText('Sends to example.com');
      expect(await page.content()).not.toMatch(/T0K3N|hooks\.example/);
      await page.getByTestId('webhook-test').click();
      await expect(page.getByTestId('webhook-test-result')).toContainText('Test sent. The webhook answered with HTTP 204.');
      expect(fake.sent).toHaveLength(1);
      expect(fake.sent[0]).toMatchObject({ url: SECRET_URL, payload: { event: 'test' } });
      fake.answer.current = { ok: false, status: 500, failure: 'http', message: 'The webhook answered with HTTP 500.' };
      await page.getByTestId('webhook-test').click();
      await expect(page.getByTestId('webhook-test-result')).toContainText('The test failed. The webhook answered with HTTP 500.');
      // It stays after a reload, still without its address.
      await page.reload();
      await expect(page.getByTestId('webhook-host')).toHaveText('Sends to example.com');
      expect(await page.content()).not.toMatch(/T0K3N|hooks\.example/);
    },
    { files: FILES, extra: { notifier: fake.notifier as never } },
  );
});

test('a blocked run reaches Needs you, the tab title count and the webhook', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  const fake = recordingNotifier();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const added = await call('POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['blocked', 'ready_for_review'] });
      expect(added.status).toBe(201);
      await page.goto(`${server.url}/w/${wsId}/board`);
      await page.getByRole('button', { name: 'Build this story 1.1' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Blocked', { timeout: 60_000 });
      // Needs you has the row, the tab title counts it, and the webhook got one payload.
      const row = page.getByTestId('needs-you-item').filter({ hasText: 'Build 1.1 is blocked' });
      await expect(row).toBeVisible();
      await expect(page).toHaveTitle('(1) Ogden Agents');
      await expect.poll(() => fake.sent.filter((entry) => entry.payload.event === 'blocked').length).toBe(1);
      expect(fake.sent[0]).toMatchObject({ url: SECRET_URL, payload: { ticket: { ref: '1.1', title: 'Build the thing' } } });
      expect(JSON.stringify(fake.sent[0]!.payload)).not.toMatch(/T0K3N|worktree|\/tmp\//);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, notifier: fake.notifier as never, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_OUTCOME: 'blocked' } } },
  );
});

test('a run ready for review is in Needs you with a link to its review, and sends its webhook', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  const fake = recordingNotifier();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      expect((await call('POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['ready_for_review'] })).status).toBe(201);
      await page.goto(`${server.url}/w/${wsId}/board`);
      await page.getByRole('button', { name: 'Build this story 1.1' }).click();
      const row = page.getByTestId('needs-you-item').filter({ hasText: 'Build 1.1 is ready for review' });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => fake.sent.filter((entry) => entry.payload.event === 'ready_for_review').length).toBe(1);
      expect(fake.sent[0]!.payload.text).toBe('Build 1.1 is ready for review.');
      await row.click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/review/1\\.1$`));
      // Approving it clears the need.
      await page.getByTestId('review-approve').click();
      await expect(page.getByTestId('review-merged')).toBeVisible();
      await expect(page.getByTestId('needs-you-item').filter({ hasText: 'Build 1.1' })).toHaveCount(0);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, notifier: fake.notifier as never, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});

test('with Unattended builds off there is no build need and nothing is sent', async ({ page }) => {
  test.setTimeout(90_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  const fake = recordingNotifier();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      expect((await call('POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['blocked', 'ready_for_review'] })).status).toBe(201);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as { run: { id: string } };
      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] })).status).toBe(200);
      await expect.poll(async () => server.core.entities.getRun(started.run.id as never)?.outcome, { timeout: 60_000 }).toBe('verified');
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('ticket-card').first()).toBeVisible();
      await expect(page.getByTestId('needs-you-item')).toHaveCount(0);
      await expect(page).toHaveTitle('Ogden Agents');
      expect(fake.sent).toEqual([]);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, notifier: fake.notifier as never, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});
