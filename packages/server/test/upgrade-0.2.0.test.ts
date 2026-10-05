/**
 * This version started on a 0.2.0 data folder (story 10.7; E10-R7, CAP-19,
 * AD-5), over REST and the event socket: every project, chat, caution level
 * and rule is served as 0.2.0 kept it, every project is Simple with its offer
 * not dismissed, Welcome counts as done and never asks the first-project
 * question, the new-projects default reads Simple without creating
 * `preferences.json`, `onboarding.json` stays byte-identical, the socket
 * replays every stored event unchanged, and neither repo changes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATABASE_FILE, ONBOARDING_FILE, PREFERENCES_FILE } from '@ogden-agents/core';
import {
  API_ROUTES,
  apiPath,
  BmadDetectionResponse,
  NewProjectDefaultsResponse,
  OnboardingState,
  PermissionRulesResponse,
  SessionsResponse,
  WorkspaceSettingsResponse,
  WorkspacesResponse,
  type CoreEvent,
  type ServerMessage,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createDataFolder020, workspaceKeyOf, type DataFolder020 } from '../../../tests/fixtures/data-folder-0.2.0.js';
import { removeAfterTest, signIn, startTestServer, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

/** A 0.2.0 data folder; it and its repos are removed by helpers.ts's shared hook, after the servers on it close. */
function fixture(options: Parameters<typeof createDataFolder020>[0] = {}): DataFolder020 {
  const data = createDataFolder020(options);
  for (const dir of [data.dataDir, data.repos.bmad.path, data.repos.plain.path]) removeAfterTest(dir);
  return data;
}

async function startOn(data: DataFolder020): Promise<{ server: TestServer; tab: SignedIn }> {
  const server = await startTestServer({ dataDir: data.dataDir });
  return { server, tab: await signIn(server) };
}

/** A connected `/ws` client recording every message. */
async function socketOf(server: TestServer, tab: SignedIn) {
  const ws = trackSocket(new WebSocket(`${server.url.replace('http', 'ws')}/ws`, tab.protocols, { headers: { origin: server.url } }));
  const messages: ServerMessage[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, messages };
}

async function get<T>(server: TestServer, tab: SignedIn, path: string, schema: { parse(value: unknown): T }): Promise<T> {
  const reply = await fetch(`${server.url}${path}`, { headers: tab.headers });
  expect(reply.status, path).toBe(200);
  return schema.parse(await reply.json());
}

/** The rows a migration can't have touched: every column 0.2.0 had. */
function oldColumns(dataDir: string) {
  const db = new DatabaseSync(join(dataDir, DATABASE_FILE), { readOnly: true });
  try {
    return {
      workspaces: db.prepare('SELECT id, path, real_path, caution_level, created_at FROM workspaces ORDER BY id').all(),
      // Every 0.2.0 column (the permission mode column is new: its rows read Ask).
      sessions: db.prepare('SELECT id, workspace_id, kind, state, driver, title, adapter_refs, created_at, updated_at FROM sessions ORDER BY id').all(),
      rules: db.prepare('SELECT * FROM permission_rules ORDER BY id').all(),
    };
  } finally {
    db.close();
  }
}

describe('starting on a 0.2.0 data folder (story 10.7)', () => {
  it('serves every project, chat, caution level and rule as kept, every project Simple, and its offer not dismissed', async () => {
    const data = fixture();
    const before = oldColumns(data.dataDir);
    const hashes = { bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() };
    const { server, tab } = await startOn(data);
    const bmad = data.workspaceIds.bmad as WorkspaceId;
    const plain = data.workspaceIds.plain as WorkspaceId;

    const { workspaces } = await get(server, tab, API_ROUTES.workspaces, WorkspacesResponse);
    expect(workspaces.map((workspace) => workspace.id).sort()).toEqual([bmad, plain].sort());
    expect(workspaces.find((workspace) => workspace.id === bmad)?.realPath).toBe(workspaceKeyOf(data.repos.bmad.path).realPath);
    expect(workspaces.find((workspace) => workspace.id === plain)?.realPath).toBe(workspaceKeyOf(data.repos.plain.path).realPath);

    const settingsOf = (wsId: WorkspaceId) => get(server, tab, apiPath(API_ROUTES.workspaceSettings, { wsId }), WorkspaceSettingsResponse);
    expect((await settingsOf(bmad)).settings).toEqual({ cautionLevel: 'ask_for_commands', bmadPieces: [], bmadScriptsTrusted: false });
    expect((await settingsOf(plain)).settings).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    const rulesOf = (wsId: WorkspaceId) => get(server, tab, apiPath(API_ROUTES.permissionRules, { wsId }), PermissionRulesResponse);
    expect((await rulesOf(bmad)).rules.map((rule) => rule.scope.value)).toEqual(['npm install']);
    expect((await rulesOf(plain)).rules).toEqual([]);

    const sessionsOf = (wsId: WorkspaceId) => get(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId }), SessionsResponse);
    expect((await sessionsOf(bmad)).sessions.map((session) => [session.id, session.kind, session.state, session.permissionMode, session.agentId])).toEqual([[data.sessionIds.bmad, 'chat', 'idle', 'ask', 'claude-code']]);
    expect((await sessionsOf(plain)).sessions.map((session) => [session.id, session.kind, session.state, session.permissionMode, session.agentId])).toEqual([[data.sessionIds.plain, 'chat', 'idle', 'ask', 'claude-code']]);
    // Rows from before agents could be chosen keep no agent id: they read as Claude Code (epic 6, migration 0007).
    expect(server.core.entities.getSession(data.sessionIds.plain as never)?.agentId).toBeUndefined();

    const detectionOf = (wsId: WorkspaceId) => get(server, tab, apiPath(API_ROUTES.workspaceBmadDetection, { wsId }), BmadDetectionResponse);
    expect((await detectionOf(bmad)).detection).toEqual({ hasBmad: true, hasOutput: false, offerDismissed: false });
    expect((await detectionOf(plain)).detection).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });

    // Starting appended its own `server.started` (every start does) and named each older chat from its
    // first message (backlog story 2); browsing appended nothing.
    const appended = server.core.events.readAfter(data.events.at(-1)!.seq);
    expect(appended.map((event) => event.type)).toEqual(['session.renamed', 'session.renamed', 'server.started']);

    await server.close();
    expect(oldColumns(data.dataDir)).toEqual(before);
    expect({ bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() }).toEqual(hashes);
    expect(existsSync(join(data.repos.plain.path, '_bmad'))).toBe(false);
  });

  it('counts Welcome as done without the first-project question, and reads the default as Simple without writing it', async () => {
    const data = fixture();
    const onboardingFile = join(data.dataDir, ONBOARDING_FILE);
    const bytes = readFileSync(onboardingFile);
    const { server, tab } = await startOn(data);

    const onboarding = await get(server, tab, API_ROUTES.onboarding, OnboardingState);
    expect(onboarding).toEqual({ welcomeCompleted: true });
    expect(onboarding.firstProjectChoice).toBeUndefined();
    expect((await get(server, tab, API_ROUTES.newProjectDefaults, NewProjectDefaultsResponse)).defaults).toEqual({ bmadPieces: [] });

    await server.close();
    expect(readFileSync(onboardingFile).equals(bytes)).toBe(true);
    expect(existsSync(join(data.dataDir, PREFERENCES_FILE))).toBe(false);
  });

  it('replays every stored event over the event socket, unchanged', async () => {
    const data = fixture();
    const { server, tab } = await startOn(data);
    const { ws, messages } = await socketOf(server, tab);
    // The legacy install-wide subscription: every stored event, then live.
    ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 }));
    await waitFor(() => messages.some((message) => message.type === 'caught_up'), 'caught up', 10_000);
    const replayed = messages.filter((message): message is CoreEvent => 'seq' in message && message.seq <= data.events.at(-1)!.seq);
    // As stored; a 0.2.0 `session.created` reads its session's permission mode as Ask (permission modes).
    const asRead = (type: string, payload: { session?: Record<string, unknown> }) =>
      type === 'session.created' ? { ...payload, session: { ...payload.session, permissionMode: 'ask' } } : payload;
    expect(replayed).toEqual(
      data.events.map((row) => ({ id: row.id, seq: row.seq, workspaceId: row.workspace_id, streamId: row.stream_id, type: row.type, at: row.at, payload: asRead(row.type, JSON.parse(row.payload)) as unknown })),
    );
    // The server checks each message against the shared schema before sending it; none was refused.
    expect(messages.some((message) => message.type === 'request_failed')).toBe(false);
  });
  it("a 0.2.0 folder without onboarding.json: its projects count Welcome as done, with no first-project answer", async () => {
    const data = fixture({ onboarding: false });
    expect(existsSync(join(data.dataDir, ONBOARDING_FILE))).toBe(false);
    const { server, tab } = await startOn(data);
    const onboarding = await get(server, tab, API_ROUTES.onboarding, OnboardingState);
    expect(onboarding).toEqual({ welcomeCompleted: true });
    expect(onboarding.firstProjectChoice).toBeUndefined();
    // Asked again (as after a restart), the answer stays the same.
    expect(await get(server, tab, API_ROUTES.onboarding, OnboardingState)).toEqual({ welcomeCompleted: true });
  });

  it("serves a chat's history the way the UI loads it: the project's subscription carries its transcript", async () => {
    const data = fixture();
    const { server, tab } = await startOn(data);
    const bmad = data.workspaceIds.bmad as WorkspaceId;
    const { ws, messages } = await socketOf(server, tab);
    ws.send(JSON.stringify({ type: 'subscribe_workspace', workspaceId: bmad }));
    await waitFor(() => messages.some((message) => message.type === 'caught_up' && message.scope === bmad), 'caught up', 10_000);
    const transcriptOf = (events: Array<{ type: string; streamId: string; payload: unknown }>) =>
      events.flatMap((event) => {
        if (event.type !== 'session.message_completed' || event.streamId !== data.sessionIds.bmad) return [];
        const { role, content } = event.payload as { role: string; content: string };
        return [`${role}: ${content}`];
      });
    const served = transcriptOf(messages.filter((message): message is CoreEvent => 'seq' in message));
    const stored = transcriptOf(data.events.map((row) => ({ type: row.type, streamId: row.stream_id, payload: JSON.parse(row.payload) as unknown })));
    expect(stored.length).toBeGreaterThan(5);
    expect(served).toEqual(stored);
  });
});
