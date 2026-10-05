/**
 * Story 5.5 over REST, on a real server with real `git` on a fixture repo,
 * the fake ACP agent's build mode, a ticket store over the plan files and a
 * fixed sandbox (no real sandbox, `claude`, keychain or network):
 *
 * - **Commit plan files**: a Build refused for an uncommitted plan, the
 *   commit of exactly that file, then the Build;
 * - the board reads a ticket with an active run from its worktree (AD-10)
 *   and the main checkout again once the run is decided;
 * - the startup sweep empties `<data>/w` of what no run needs, unlinking a
 *   link without touching its target.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixedSandbox } from '@ogden-agents/adapters';
import type { TicketStorePort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, BuildResponse, CommitPlanFilesResponse, ReviewResponse, TicketsResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_TICKET_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];

async function setup(dataDir?: string) {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_TICKET_FILES, prefix: 'ogden-agents-build-repo-' });
  removeAfterTest(repo.path);
  const store = createPlanFileTicketStore(TICKETS);
  const server = await startTestServer({
    ticketStore: store as unknown as TicketStorePort,
    sandbox: createFixedSandbox({ available: true, kind: 'test' }),
    extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '1' },
    ...(dataDir === undefined ? {} : { dataDir }),
  });
  const tab = await signIn(server);
  const workspace = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace;
  const wsId = workspace.id;
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const build = (ref: string) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref });
  const review = async (ref: string) => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref }))).json());
  const ticketStatus = async (ref: string) => TicketsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceTickets, { wsId }))).json()).tickets.find((row) => row.ref === ref)?.status;
  return { repo, server, tab, wsId, build, review, ticketStatus };
}

describe('Worktrees in the data folder over REST (story 5.5)', () => {
  it('Commit plan files commits exactly the uncommitted plan, then Build goes ahead', async () => {
    const { repo, server, tab, wsId, build } = await setup();
    const planFile = join(repo.path, ...FAKE_BUILD_PLAN.split('/'));
    writeFileSync(planFile, `${readFileSync(planFile, 'utf8')}\nA note.\n`);
    writeFileSync(join(repo.path, 'scratch.txt'), 'mine\n');
    const refused = await build('1.1');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('plan_uncommitted');
    const head = fixtureGit(repo.path, 'rev-parse', 'HEAD').trim();
    const reply = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildCommitPlan, { wsId, ref: '1.1' }));
    expect(reply.status).toBe(200);
    const committed = CommitPlanFilesResponse.parse(await reply.json());
    expect(committed.committed).toEqual([FAKE_BUILD_PLAN]);
    expect(committed.revision).toBe(fixtureGit(repo.path, 'rev-parse', 'HEAD').trim());
    expect(fixtureGit(repo.path, 'rev-parse', 'HEAD^').trim()).toBe(head);
    expect(fixtureGit(repo.path, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe(FAKE_BUILD_PLAN);
    // The user's other change is untouched and uncommitted.
    expect(fixtureGit(repo.path, 'status', '--porcelain').trim()).toBe('?? scratch.txt');
    expect((await build('1.1')).status).toBe(201);
  });

  it("the board reads a ticket with an active run from its worktree, and the main checkout once it is decided", async () => {
    const { repo, build, review, ticketStatus, server, tab, wsId } = await setup();
    BuildResponse.parse(await (await build('1.1')).json());
    await waitFor(async () => (await review('1.1')).outcome !== 'running', 'the run to end', 15_000);
    expect((await review('1.1')).outcome).toBe('verified');
    // The fake agent marked the plan built in the worktree; the main checkout still says ready-for-dev.
    expect(readFileSync(join(repo.path, ...FAKE_BUILD_PLAN.split('/')), 'utf8')).toMatch(/^status: ready-for-dev$/m);
    expect(await ticketStatus('1.1')).toBe('built');
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId, ref: '1.1' }))).status).toBe(200);
    expect(await ticketStatus('1.1')).toBe('ready-for-dev');
  });

  it('the startup sweep empties <data>/w of what no run needs, and never follows a link out of it', async () => {
    const dataDir = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-sweep-data-'))));
    const outside = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-sweep-outside-'))));
    writeFileSync(join(outside, 'keep.txt'), 'keep\n');
    mkdirSync(join(dataDir, 'w', 'zzzzzzzz', 'src'), { recursive: true });
    writeFileSync(join(dataDir, 'w', 'zzzzzzzz', 'src', 'left.txt'), 'left behind\n');
    symlinkSync(outside, join(dataDir, 'w', 'yyyyyyyy'), process.platform === 'win32' ? 'junction' : 'dir');
    await setup(dataDir);
    expect(readdirSync(join(dataDir, 'w'))).toEqual([]);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
  });
});
