/**
 * The story 2.3 stubs: every route a later lane fills was registered under
 * the gate and answered 501 `not_implemented` until its lane shipped; every
 * lane has now shipped (gate.test.ts still checks each is gated). The `/ws`
 * messages are built (story 2.9, `event-socket.test.ts`); an invalid one is
 * still ignored, and the legacy `subscribe` still works.
 */
import { API_ROUTES, ApiErrorBody, ServerMessage } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { send, signIn, startTestServer, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';


// No route is a 501 stub any more: onboarding (9.5) was the last. Its 501
// without a use-case, which reads no body, is in agent-setup-routes.test.ts.

describe('stub routes', () => {
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
