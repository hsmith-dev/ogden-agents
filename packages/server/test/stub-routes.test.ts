/**
 * The story 2.3 stubs: every route a later lane fills is registered now,
 * under the gate, and answers 501 `not_implemented` in the shared error
 * shape until its lane ships. Without a tab token it is 401, and a
 * state-changing one from a foreign Origin is 403 (AD-15). The `/ws`
 * messages are built (story 2.9, `event-socket.test.ts`); an invalid one is
 * still ignored, and the legacy `subscribe` still works.
 */
import { API_ROUTES, ApiErrorBody, apiPath, ServerMessage } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { send, signIn, startTestServer, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const sesId = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

/** Every stubbed route with its method and a concrete path, by the lane that fills it. */
const STUBS: ReadonlyArray<readonly [method: string, path: string]> = [
  // 9.x (9.1's agents list and sign-in and 9.2's API key are built: agent-setup-routes.test.ts)
  ['POST', apiPath(API_ROUTES.agentInstall, { agentId: 'claude-code' })],
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

  it('never read the body: an API key sent to a stub is not parsed or logged', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const tab = await signIn(server);
    const apiKey = 'sk-ant-api03-never-logged-0123456789';
    const put = await send(server, apiPath(API_ROUTES.agentInstall, { agentId: 'claude-code' }), {
      method: 'POST',
      headers: { ...tab.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    expect(put.status).toBe(501);
    // Not even a malformed body is looked at.
    const junk = await send(server, API_ROUTES.onboarding, { method: 'PATCH', headers: { ...tab.headers, 'content-type': 'application/json' }, body: '{nope' });
    expect(junk.status).toBe(501);
    expect(lines.join('')).not.toContain(apiKey);
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

describe('/ws client messages', () => {
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
