/**
 * The story 2.3 stubs: every route a later lane fills is registered now,
 * under the gate, and answers 501 `not_implemented` in the shared error
 * shape until its lane ships. Without a tab token it is 401, and a
 * state-changing one from a foreign Origin is 403 (AD-15). The new `/ws`
 * client messages are answered `request_failed`, and the legacy `subscribe`
 * still works.
 */
import { API_ROUTES, ApiErrorBody, apiPath, ServerMessage } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { send, signIn, startTestServer, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const sesId = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const ruleId = 'rule_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

/** Every stubbed route with its method and a concrete path, by the lane that fills it. */
const STUBS: ReadonlyArray<readonly [method: string, path: string]> = [
  // 2.5
  ['GET', API_ROUTES.workspaces],
  ['GET', apiPath(API_ROUTES.workspace, { wsId })],
  ['DELETE', apiPath(API_ROUTES.workspaceHistory, { wsId })],
  ['GET', apiPath(API_ROUTES.workspaceSettings, { wsId })],
  ['PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId })],
  ['GET', `${API_ROUTES.folders}?path=%2Ftmp`],
  ['POST', API_ROUTES.folders],
  ['GET', apiPath(API_ROUTES.workspaceSessions, { wsId })],
  // 2.10
  ['POST', apiPath(API_ROUTES.sessionCancel, { wsId, sesId })],
  // 2.6
  ['POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId, requestId: 'req-1' })],
  ['GET', apiPath(API_ROUTES.permissionRules, { wsId })],
  ['DELETE', apiPath(API_ROUTES.permissionRule, { wsId, ruleId })],
  // 2.4
  ['GET', API_ROUTES.appShortcut],
  ['POST', API_ROUTES.appShortcut],
  ['DELETE', API_ROUTES.appShortcut],
  ['DELETE', API_ROUTES.appShortcutOffer],
  // 9.x
  ['GET', API_ROUTES.agents],
  ['POST', apiPath(API_ROUTES.agentInstall, { agentId: 'claude-code' })],
  ['POST', apiPath(API_ROUTES.agentSignIn, { agentId: 'claude-code' })],
  ['DELETE', apiPath(API_ROUTES.agentSignIn, { agentId: 'claude-code' })],
  ['PUT', apiPath(API_ROUTES.agentApiKey, { agentId: 'claude-code' })],
  ['DELETE', apiPath(API_ROUTES.agentApiKey, { agentId: 'claude-code' })],
  ['GET', API_ROUTES.onboarding],
  ['PATCH', API_ROUTES.onboarding],
];

const safe = (method: string) => method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

describe('stub routes', () => {
  it('answer 501 not_implemented with a token, 401 without one, and 403 from a foreign Origin when they change state', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    for (const [method, path] of STUBS) {
      const ok = await send(server, path, { method, headers: tab.headers });
      expect(ok.status, `${method} ${path}`).toBe(501);
      expect(ApiErrorBody.parse(ok.json()).error.code, `${method} ${path}`).toBe('not_implemented');

      const anonymous = await send(server, path, { method, headers: { origin: server.url } });
      expect(anonymous.status, `${method} ${path} without a token`).toBe(401);

      const foreign = await send(server, path, { method, headers: { ...tab.headers, origin: 'http://evil.example' } });
      expect(foreign.status, `${method} ${path} from a foreign Origin`).toBe(safe(method) ? 501 : 403);
    }
  });

  it('never read the body: an API key sent to the stub is not parsed or logged, and sign-in is no-store', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const tab = await signIn(server);
    const apiKey = 'sk-ant-api03-never-logged-0123456789';
    const put = await send(server, apiPath(API_ROUTES.agentApiKey, { agentId: 'claude-code' }), {
      method: 'PUT',
      headers: { ...tab.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    expect(put.status).toBe(501);
    // Not even a malformed body is looked at.
    const junk = await send(server, API_ROUTES.folders, { method: 'POST', headers: { ...tab.headers, 'content-type': 'application/json' }, body: '{nope' });
    expect(junk.status).toBe(501);
    expect(lines.join('')).not.toContain(apiKey);

    const signInReply = await send(server, apiPath(API_ROUTES.agentSignIn, { agentId: 'claude-code' }), { method: 'POST', headers: tab.headers });
    expect(signInReply.status).toBe(501);
    expect(signInReply.headers['cache-control']).toBe('no-store');
  });

  it('leave the story 2.2 routes working', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const bad = await send(server, API_ROUTES.workspaces, { method: 'POST', headers: { ...tab.headers, 'content-type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(400);
    expect(ApiErrorBody.parse(bad.json()).error.code).toBe('invalid_request');
  });
});

/** A connected `/ws` client recording every message. */
async function socket(server: TestServer, tab: SignedIn) {
  const ws = trackSocket(new WebSocket(`${server.url.replace('http', 'ws')}/ws`, tab.protocols, { headers: { origin: server.url } }));
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => messages.push(ServerMessage.parse(JSON.parse(String(data)))));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, messages };
}

describe('the new /ws client messages', () => {
  it('are answered request_failed / not_implemented, echoing the request id and workspace', async () => {
    const server = await startTestServer();
    const { ws, messages } = await socket(server, await signIn(server));
    ws.send(JSON.stringify({ type: 'subscribe_install', afterSeq: 0 }));
    ws.send(JSON.stringify({ type: 'subscribe_workspace', workspaceId: wsId, window: 50 }));
    ws.send(JSON.stringify({ type: 'unsubscribe_workspace', workspaceId: wsId }));
    ws.send(JSON.stringify({ type: 'page_history', requestId: 'r1', workspaceId: wsId, sessionId: sesId, beforeSeq: 10, limit: 20 }));
    await waitFor(() => messages.length >= 4, 'four replies');
    expect(messages).toEqual([
      { type: 'request_failed', for: 'subscribe_install', code: 'not_implemented', message: expect.any(String) },
      { type: 'request_failed', for: 'subscribe_workspace', workspaceId: wsId, code: 'not_implemented', message: expect.any(String) },
      { type: 'request_failed', for: 'unsubscribe_workspace', workspaceId: wsId, code: 'not_implemented', message: expect.any(String) },
      { type: 'request_failed', for: 'page_history', requestId: 'r1', workspaceId: wsId, code: 'not_implemented', message: expect.any(String) },
    ]);
  });

  it('an invalid one is ignored, and the legacy subscribe still streams the backlog then caught_up', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const { ws, messages } = await socket(server, await signIn(server));
    ws.send(JSON.stringify({ type: 'page_history', workspaceId: 'not-an-id', beforeSeq: 0, limit: 0 }));
    ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 }));
    await waitFor(() => messages.some((m) => m.type === 'caught_up'), 'caught_up');
    expect(messages.map((m) => m.type)).toEqual(['server.started', 'caught_up']);
    expect(lines.join('')).toContain('ignoring client message that fails the shared schema');
  });
});
