/**
 * The Orchestration piece over REST (epic 15, story 15.2): off by default, the
 * one settings route answers `feature_off` until the piece is on and is
 * registered through the one helper that applies core's guard, the install
 * cannot turn the piece on until it ships it, and switching to automatic
 * dispatch is refused without the user's confirmation (the server is the
 * gate). No manager is called and nothing is dispatched.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCore, type Core } from '@ogden-agents/core';
import {
  API_BASE,
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  AUTOMATIC_NEEDS_CONFIRMATION,
  ORCHESTRATION_OFF_MESSAGE,
  ORCHESTRATION_UNAVAILABLE_MESSAGE,
  MANAGER_STATE_WORDS,
  OrchestrationSettingsResponse,
  RUN_LIMITS,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
} from '@ogden-agents/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { guardedRouteKeys } from '../src/bmad-pieces.js';
import { createLogger } from '../src/log.js';
import { orchestrationRouteKeys, orchestrationRoutes, SHIPPED_ORCHESTRATION } from '../src/orchestration-routes.js';
import { fullTestApp, send, signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const repos: string[] = [];
const cores: Core[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempRepo(): string {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  return repo;
}

const request = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const addProject = async (server: TestServer, tab: SignedIn) => WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: tempRepo() })).json()).workspace;
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });
const settingsPath = (wsId: string) => apiPath(API_ROUTES.workspaceSettings, { wsId });
const orchestrationPath = (wsId: string) => apiPath(API_ROUTES.workspaceOrchestration, { wsId });
const settingsOf = async (server: TestServer, tab: SignedIn, wsId: string) => WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', settingsPath(wsId))).json()).settings;

describe('Orchestration is off by default', () => {
  it('a project has it off, the route answers feature_off, and an install that does not ship it refuses turning it on', async () => {
    expect(SHIPPED_ORCHESTRATION).toBe(true);
    const server = await startTestServer({ orchestrationAvailable: false });
    const tab = await signIn(server);
    const workspace = await addProject(server, tab);
    expect(await settingsOf(server, tab, workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    expect(await refusalOf(await request(server, tab, 'GET', orchestrationPath(workspace.id)))).toEqual({ status: 409, code: 'feature_off', message: ORCHESTRATION_OFF_MESSAGE });
    // Turning it on is refused where the install does not ship it, and nothing is stored.
    const before = server.core.events.lastSeq();
    expect(await refusalOf(await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationEnabled: true }))).toEqual({ status: 409, code: 'feature_unavailable', message: ORCHESTRATION_UNAVAILABLE_MESSAGE });
    expect(server.core.events.lastSeq()).toBe(before);
    // Behind the gate like every API route, and an unknown or malformed project is not found.
    expect((await send(server, orchestrationPath(workspace.id))).status).toBe(401);
    expect((await request(server, tab, 'GET', orchestrationPath(UNKNOWN))).status).toBe(404);
    expect((await request(server, tab, 'GET', orchestrationPath('nope'))).status).toBe(404);
  });
});

describe('an install that ships Orchestration', () => {
  it('turns it on per project, reads the defaults, and refuses automatic dispatch without the confirmation', async () => {
    const server = await startTestServer({ orchestrationAvailable: true });
    const tab = await signIn(server);
    const workspace = await addProject(server, tab);
    const other = await addProject(server, tab);
    expect((await settingsOf(server, tab, workspace.id)).orchestrationEnabled).toBeUndefined();
    expect((await request(server, tab, 'GET', orchestrationPath(workspace.id))).status).toBe(409);

    const on = await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationEnabled: true });
    expect(WorkspaceSettingsResponse.parse(await on.json()).settings.orchestrationEnabled).toBe(true);
    const read = await request(server, tab, 'GET', orchestrationPath(workspace.id));
    expect(read.status).toBe(200);
    expect(OrchestrationSettingsResponse.parse(await read.json()).settings).toEqual({
      mode: 'approve_each',
      limits: RUN_LIMITS,
      roster: { manager: null, planner: null, worker: null, reviewer: null },
      // No manager model is chosen in a fresh project.
      managerReady: false,
      manager: { state: 'not_chosen', message: MANAGER_STATE_WORDS.not_chosen },
    });
    // Another project is unchanged.
    expect(await refusalOf(await request(server, tab, 'GET', orchestrationPath(other.id)))).toMatchObject({ status: 409, code: 'feature_off' });

    const before = server.core.events.lastSeq();
    expect(await refusalOf(await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationMode: 'automatic' }))).toEqual({
      status: 400,
      code: 'confirmation_required',
      message: AUTOMATIC_NEEDS_CONFIRMATION,
    });
    expect(server.core.events.lastSeq()).toBe(before);
    const confirmed = await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationMode: 'automatic', confirm: true });
    expect(WorkspaceSettingsResponse.parse(await confirmed.json()).settings.orchestrationMode).toBe('automatic');
    expect(OrchestrationSettingsResponse.parse(await (await request(server, tab, 'GET', orchestrationPath(workspace.id))).json()).settings.mode).toBe('automatic');

    // The roster, and the refusals of a bad one.
    const endpoint = (await (await request(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'My Mac', baseUrl: 'http://localhost:1234/v1' })).json()) as { endpoint: { id: string } };
    const roster = { manager: { kind: 'model', endpointId: endpoint.endpoint.id, model: 'a-model' } };
    // A model on a server nobody set up is refused (15.4).
    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationRoster: { manager: { kind: 'model', endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', model: 'a-model' } } })).status).toBe(400);
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationRoster: roster })).json()).settings.orchestrationRoster?.manager).toEqual(roster.manager);
    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationRoster: { manager: 'x' } })).status).toBe(400);
    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationMode: 'skip_all', confirm: true })).status).toBe(400);
    expect((await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationRoster: { worker: { kind: 'agent', agentId: 'no-such-agent' } } })).status).toBe(400);

    // Turning it off again closes the route at once.
    await request(server, tab, 'PATCH', settingsPath(workspace.id), { orchestrationEnabled: false });
    expect((await request(server, tab, 'GET', orchestrationPath(workspace.id))).status).toBe(409);
  });
});

describe('the route helper', () => {
  const log = createLogger(() => {});

  it('registers the settings route in the fully wired app through the helper, and not as a BMad piece route', () => {
    const core = openCore(tempDataDir());
    cores.push(core);
    const app = fullTestApp(core);
    expect(orchestrationRouteKeys(app)).toEqual(
      [
        `GET ${API_ROUTES.workspaceOrchestration}`,
        `GET ${API_ROUTES.workspaceTeamRoster}`,
        `GET ${API_ROUTES.workspaceOrchestrationRuns}`,
        `POST ${API_ROUTES.workspaceOrchestrationRuns}`,
        `GET ${API_ROUTES.workspaceOrchestrationRun}`,
        `POST ${API_ROUTES.workspaceOrchestrationStepApprove}`,
        `POST ${API_ROUTES.workspaceOrchestrationStepDispatch}`,
        `POST ${API_ROUTES.workspaceOrchestrationStepEdit}`,
        `POST ${API_ROUTES.workspaceOrchestrationStepSkip}`,
        `POST ${API_ROUTES.workspaceOrchestrationReorder}`,
        `POST ${API_ROUTES.workspaceOrchestrationStop}`,
        `GET ${API_ROUTES.workspaceOrchestrationActivity}`,
      ].sort(),
    );
    expect(guardedRouteKeys(app)).not.toContain(`GET ${API_ROUTES.workspaceOrchestration}`);
    // Every route under a project's orchestration path is one the helper registered (the install's defaults are not a project's): a new one cannot skip the guard.
    const served = [...new Set(app.routes.filter((route) => /\/workspaces\/:wsId\/orchestration(\/|$)/.test(route.path)).map((route) => `${route.method} ${route.path}`))].sort();
    expect(served).toEqual(orchestrationRouteKeys(app));
  });

  it('refuses a path outside a workspace, and registers nothing without core wiring', () => {
    const core = openCore(tempDataDir());
    cores.push(core);
    const app = new Hono();
    expect(() => orchestrationRoutes(app, { orchestration: core.orchestration, log }).get(`${API_BASE}/orchestration`, (c) => c.json({}))).toThrow(/inside a workspace/);
    expect(orchestrationRouteKeys(app)).toEqual([]);
    expect(orchestrationRouteKeys(new Hono())).toEqual([]);
  });
});
