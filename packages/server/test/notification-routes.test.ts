/**
 * Story 11.4 over REST, on a real server with the fake ACP agent and a
 * recording notifier (nothing is sent anywhere): adding a webhook (its URL
 * only in the keychain, listed back by its masked host), Send test, and the
 * payloads a blocked run and a run ready for review send. A webhook URL never
 * appears in an answer, a log line or an event.
 */
import { createMemoryNotifier, createMemorySecretStore } from '@ogden-agents/adapters';
import { SecretsUnavailableError, type TicketStorePort } from '@ogden-agents/core';
import { createFixedSandbox } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, apiPath, BuildResponse, NotificationSettingsResponse, ReviewResponse, WebhookTestResult, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';

// Real git and a real build per test: a loaded runner needs more than the default 5 seconds.
vi.setConfig({ testTimeout: 60_000 });
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type TestServer, type SignedIn } from './helpers.js';

const SECRET_URL = 'https://hooks.example.com/services/T0K3N-SECRET';
const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setup(env: Record<string, string> = {}, options: { keychain?: boolean } = {}) {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_REPO_FILES, prefix: 'ogden-agents-notify-repo-' });
  removeAfterTest(repo.path);
  const notifier = createMemoryNotifier();
  const secrets = createMemorySecretStore();
  const lines: string[] = [];
  const server = await startTestServer({
    lines,
    notifier,
    secrets:
      options.keychain === false
        ? { backend: 'none', get: async () => undefined, set: async () => Promise.reject(new SecretsUnavailableError()), delete: async () => undefined }
        : secrets,
    ticketStore: createPlanFileTicketStore(TICKETS) as unknown as TicketStorePort,
    sandbox: createFixedSandbox({ available: true, kind: 'test' }),
    extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '1', ...env },
  });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  return { server, tab, wsId, notifier, secrets, lines };
}

describe('the notification settings (story 11.4)', () => {
  it('adds a webhook (201, host masked, no URL), lists it, edits its events, tests it and removes it; the URL is only in the keychain', async () => {
    const s = await setup();
    const added = await request(s.server, s.tab, 'POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['blocked'] });
    expect(added.status).toBe(201);
    const text = await added.text();
    expect(text).not.toMatch(/T0K3N|hooks\.example/);
    const settings = NotificationSettingsResponse.parse(JSON.parse(text)).settings;
    expect(settings.webhooks[0]).toMatchObject({ host: 'example.com', events: ['blocked'] });
    const id = settings.webhooks[0]!.id;
    expect(await s.secrets.get(`webhook:${id}`)).toBe(SECRET_URL);
    expect(NotificationSettingsResponse.parse(await (await request(s.server, s.tab, 'GET', API_ROUTES.notificationSettings)).json()).settings.webhooks).toHaveLength(1);
    const edited = await request(s.server, s.tab, 'PATCH', apiPath(API_ROUTES.notificationWebhook, { webhookId: id }), { events: ['blocked', 'ready_for_review'] });
    expect(NotificationSettingsResponse.parse(await edited.json()).settings.webhooks[0]!.events).toEqual(['blocked', 'ready_for_review']);
    expect(NotificationSettingsResponse.parse(await (await request(s.server, s.tab, 'PATCH', API_ROUTES.notificationSettings, { browserNotifications: true })).json()).settings.browserNotifications).toBe(true);

    const tested = WebhookTestResult.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.notificationWebhookTest, { webhookId: id }))).json());
    expect(tested).toMatchObject({ ok: true, status: 204 });
    expect(s.notifier.sent).toHaveLength(1);
    expect(s.notifier.sent[0]).toMatchObject({ url: SECRET_URL, payload: { event: 'test' } });
    s.notifier.answers.set(SECRET_URL, { ok: false, status: 500, failure: 'http', message: 'The webhook answered with HTTP 500.' });
    expect(WebhookTestResult.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.notificationWebhookTest, { webhookId: id }))).json())).toMatchObject({ ok: false, status: 500 });

    expect((await request(s.server, s.tab, 'DELETE', apiPath(API_ROUTES.notificationWebhook, { webhookId: id }))).status).toBe(204);
    expect(await s.secrets.get(`webhook:${id}`)).toBeUndefined();
    expect((await request(s.server, s.tab, 'DELETE', apiPath(API_ROUTES.notificationWebhook, { webhookId: id }))).status).toBe(404);
    // Neither a log line nor an event ever held the URL.
    expect(s.lines.join('\n')).not.toMatch(/T0K3N|hooks\.example/);
    expect(JSON.stringify(s.server.core.events.readAfter(0))).not.toMatch(/T0K3N|hooks\.example/);
  });

  it('refuses a bad URL (400) and, with no keychain, stores nothing (503 with its plain reason)', async () => {
    const s = await setup();
    const bad = await request(s.server, s.tab, 'POST', API_ROUTES.notificationWebhooks, { url: 'http://hooks.example.com/x', events: ['blocked'] });
    expect(bad.status).toBe(400);
    const none = await setup({}, { keychain: false });
    const refused = await request(none.server, none.tab, 'POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['blocked'] });
    expect(refused.status).toBe(503);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('secrets_unavailable');
    expect(NotificationSettingsResponse.parse(await (await request(none.server, none.tab, 'GET', API_ROUTES.notificationSettings)).json()).settings.webhooks).toEqual([]);
  });
});

describe('what a blocked run and a verified run send (story 11.4)', () => {
  it('a blocked run sends one payload to a webhook subscribed to it, and nothing else is sent', async () => {
    const s = await setup({ FAKE_ACP_BUILD_OUTCOME: 'blocked' });
    await request(s.server, s.tab, 'POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['blocked'] });
    await request(s.server, s.tab, 'POST', API_ROUTES.notificationWebhooks, { url: 'https://other.example.org/x', events: ['ready_for_review'] });
    BuildResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1' })).json());
    await waitFor(() => s.notifier.sent.length > 0, 'the blocked webhook', 20_000);
    await s.server.core.entities.listRuns(s.wsId);
    expect(s.notifier.sent).toHaveLength(1);
    expect(s.notifier.sent[0]).toMatchObject({ url: SECRET_URL, payload: { event: 'blocked', ticket: { ref: '1.1', title: 'Build the thing' } } });
    expect(s.lines.join('\n')).not.toMatch(/T0K3N|hooks\.example|other\.example/);
  });

  it('a run ready for review sends one payload; with builds off nothing is sent', async () => {
    const s = await setup();
    await request(s.server, s.tab, 'POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['ready_for_review'] });
    BuildResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1' })).json());
    await waitFor(async () => ReviewResponse.parse(await (await request(s.server, s.tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId: s.wsId, ref: '1.1' }))).json()).outcome === 'verified', 'verified', 30_000);
    await waitFor(() => s.notifier.sent.length > 0, 'the review webhook', 10_000);
    expect(s.notifier.sent).toHaveLength(1);
    expect(s.notifier.sent[0]!.payload).toMatchObject({ event: 'ready_for_review', text: 'Build 1.1 is ready for review.' });

    const off = await setup();
    await request(off.server, off.tab, 'POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['ready_for_review', 'blocked'] });
    BuildResponse.parse(await (await request(off.server, off.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: off.wsId }), { ref: '1.1' })).json());
    await request(off.server, off.tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: off.wsId }), { bmadPieces: ['board'] });
    await waitFor(async () => off.server.core.entities.listRuns(off.wsId)[0]?.outcome === 'verified', 'the run to end', 30_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(off.notifier.sent).toEqual([]);
  });
});
