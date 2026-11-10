/**
 * The tracker routes end to end (CAP-35, epic 27): a real server with the
 * in-memory keychain and the real `trackers` adapters over a fetch fake, so
 * nothing reaches GitHub or Linear. The token goes in once and comes back
 * nowhere (an answer, the event log, the log or the database), and a chat
 * named after an issue starts in a project folder that is not a git repo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemorySecretStore, createTrackers } from '@ogden-agents/adapters';
import { API_ROUTES, apiPath, IssueContextResponse, IssuesResponse, SessionResponse, TrackerAccountResponse, TrackerAccountsResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const TOKEN = 'ghp_secretsecretsecretsecretsecret0000';
const GH_ISSUE = { number: 42, title: 'Login button does nothing', html_url: 'https://github.com/acme/app/issues/42', state: 'open', body: 'Steps', updated_at: '2026-11-01T00:00:00Z', assignees: [] };

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function setUp(status = 200) {
  const lines: string[] = [];
  const fake: typeof fetch = async (input) => {
    const url = String(input);
    if (status !== 200) return new Response('{}', { status });
    if (url.endsWith('/repos/acme/app')) return Response.json({ id: 1 });
    if (url.endsWith('/issues/42')) return Response.json(GH_ISSUE);
    if (url.includes('/search/issues')) return Response.json({ items: [GH_ISSUE] });
    return Response.json([GH_ISSUE]);
  };
  const server = await startTestServer({ secrets: createMemorySecretStore(), trackers: createTrackers({ fetch: fake }), lines });
  const tab = await signIn(server);
  return { server, tab, lines };
}

describe('the tracker routes (CAP-35, epic 27)', () => {
  it('adds an account after testing its token, lists issues, answers a context, and the token is nowhere after', async () => {
    const { server, tab, lines } = await setUp();
    const created = await call(server, tab, 'POST', API_ROUTES.trackerAccounts, { kind: 'github', label: 'Acme', token: TOKEN, scope: 'acme/app' });
    expect(created.status).toBe(201);
    const { account } = TrackerAccountResponse.parse(await created.json());
    const listed = await call(server, tab, 'GET', API_ROUTES.trackerAccounts);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(TrackerAccountsResponse.parse(await listed.json()).accounts).toEqual([account]);

    const issues = IssuesResponse.parse(await (await call(server, tab, 'GET', `${apiPath(API_ROUTES.trackerIssues, { accountId: account.id })}?q=login`)).json());
    expect(issues.issues.map((issue) => issue.identifier)).toEqual(['#42']);
    const picked = IssueContextResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.trackerIssueContext, { accountId: account.id, issueKey: '42' }))).json());
    expect(picked.chatName).toBe('#42 Login button does nothing');

    // A chat named after the issue, in a folder that is not a git repository.
    // A plain folder: no `git init` anywhere.
    const ws = server.core.entities.ensureWorkspace(tempDataDir());
    const session = SessionResponse.parse(await (await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: ws.id }), { kind: 'chat', autoTitle: picked.chatName })).json()).session;
    expect(session.autoTitle).toBe('#42 Login button does nothing');

    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain(TOKEN);

    expect((await call(server, tab, 'DELETE', apiPath(API_ROUTES.trackerAccount, { accountId: account.id }))).status).toBe(204);
    expect(TrackerAccountsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.trackerAccounts)).json()).accounts).toEqual([]);
    await server.close();
    const stored = readdirSync(server.dataDir, { recursive: true, encoding: 'utf8' }).filter((name) => /(\.db(-wal|-shm)?|\.log)$/.test(name));
    expect(stored.length).toBeGreaterThan(0);
    for (const file of stored) expect(readFileSync(join(server.dataDir, file)).includes(TOKEN)).toBe(false);
  });

  it('a refused token is a plain 409 and keeps nothing; bad input is 400', async () => {
    const { server, tab } = await setUp(401);
    const refused = await call(server, tab, 'POST', API_ROUTES.trackerAccounts, { kind: 'github', label: 'Acme', token: TOKEN, scope: 'acme/app' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('tracker_unauthorized');
    expect((await call(server, tab, 'POST', API_ROUTES.trackerAccounts, { kind: 'github', label: 'Acme', token: TOKEN })).status).toBe(400);
    expect(TrackerAccountsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.trackerAccounts)).json()).accounts).toEqual([]);
  });
});
