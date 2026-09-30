/**
 * The agents list and sign-in routes (story 9.1) on a real server whose
 * Claude Code is the fake ACP agent and whose CLI is the fake login program
 * (`tests/fixtures/fake-claude-login.mjs`). No test runs a real login.
 *
 * The sign-in URL leaves the server only in the `no-store` sign-in answer:
 * never in an event or a log line, and neither do the login's output or a
 * pasted code (AD-15, AD-16).
 *
 * The API key routes (story 9.2) keep keys in memory and check them with a
 * stub: no test touches the real keychain or reaches Anthropic. The key never
 * leaves in a response, an event or a log line; only its last 4 do, in the list.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClaudeApiKey, createMemorySecretStore, loadPty, type AdapterPins, type NpmRunInput, type NpmRunner, type PtyLoader } from '@ogden-agents/adapters';
import { SecretsUnavailableError, type AgentSetupPort, type ApiKeyVerification, type SecretStorePort } from '@ogden-agents/core';
import { AgentSetupStatus, AgentsResponse, API_ROUTES, ApiErrorBody, apiPath, SessionResponse, SignInResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testSecretStore, type StartOptions } from '../src/start.js';
import { FAKE_AGENT, send, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const signInPath = (agentId = 'claude-code') => apiPath(API_ROUTES.agentSignIn, { agentId });
const codePath = (agentId = 'claude-code') => apiPath(API_ROUTES.agentSignInCode, { agentId });

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function stateFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-login-'));
  temps.push(dir);
  return join(dir, 'state.json');
}

async function startSetupServer(env: Record<string, string> = {}, extra: StartOptions = {}) {
  const lines: string[] = [];
  const server = await startTestServer({
    lines,
    extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: stateFile(), ...env },
    ...extra,
  });
  const tab = await signIn(server);
  return { server, tab, lines };
}

/** Whether a process with this pid exists. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const json = (tab: SignedIn) => ({ ...tab.headers, 'content-type': 'application/json' });

async function agents(server: TestServer, tab: SignedIn) {
  const reply = await send(server, API_ROUTES.agents, { headers: tab.headers });
  expect(reply.status).toBe(200);
  return AgentsResponse.parse(reply.json()).agents;
}

function authStates(server: TestServer): string[] {
  return server.core.events.readAfter(0).flatMap((event) => (event.type === 'agent.auth_changed' ? [event.payload.state] : []));
}

/** Everything that must never hold the URL, the output or a code: every event and every log line. */
function everythingKept(server: TestServer, lines: readonly string[]): string {
  return JSON.stringify(server.core.events.readAfter(0)) + lines.join('');
}

describe('agent setup routes: the gate', () => {
  it('need a token (401), a matching Origin to change state (403), and a known agent (404)', async () => {
    const { server, tab } = await startSetupServer();
    const routes: Array<[string, string]> = [
      ['GET', API_ROUTES.agents],
      ['POST', signInPath()],
      ['DELETE', signInPath()],
      ['POST', codePath()],
    ];
    for (const [method, path] of routes) {
      expect((await send(server, path, { method, headers: { origin: server.url } })).status, `${method} ${path}`).toBe(401);
      if (method !== 'GET') {
        const foreign = await send(server, path, { method, headers: { ...tab.headers, origin: 'http://evil.example' } });
        expect(foreign.status, `${method} ${path} from a foreign Origin`).toBe(403);
      }
    }
    for (const agentId of ['nope', 'Not_An_Id']) {
      const reply = await send(server, signInPath(agentId), { method: 'POST', headers: tab.headers });
      expect(reply.status).toBe(404);
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(ApiErrorBody.parse(reply.json()).error.code).toBe('not_found');
      expect((await send(server, signInPath(agentId), { method: 'DELETE', headers: tab.headers })).status).toBe(404);
      expect((await send(server, codePath(agentId), { method: 'POST', headers: json(tab), body: '{"code":"abc"}' })).status).toBe(404);
    }
  });

  it('a malformed code is 400 without echoing it, and a code with no sign-in running is 409; nothing logs it', async () => {
    const { server, tab, lines } = await startSetupServer();
    const secretish = 'not a code; rm -rf ~';
    const bad = await send(server, codePath(), { method: 'POST', headers: json(tab), body: JSON.stringify({ code: secretish }) });
    expect(bad.status).toBe(400);
    expect(bad.headers['cache-control']).toBe('no-store');
    expect(bad.body).not.toContain('rm -rf');
    const long = await send(server, codePath(), { method: 'POST', headers: json(tab), body: JSON.stringify({ code: 'a'.repeat(513) }) });
    expect(long.status).toBe(400);
    const notJson = await send(server, codePath(), { method: 'POST', headers: json(tab), body: 'code=abc' });
    expect(notJson.status).toBe(400);
    const none = await send(server, codePath(), { method: 'POST', headers: json(tab), body: JSON.stringify({ code: 'valid-code-123' }) });
    expect(none.status).toBe(409);
    expect(ApiErrorBody.parse(none.json()).error.code).toBe('sign_in_not_pending');
    expect(lines.join('')).not.toContain('valid-code-123');
    expect(lines.join('')).not.toContain('rm -rf');
  });

  it('cancelling with no sign-in running is 204 and appends nothing', async () => {
    const { server, tab } = await startSetupServer();
    expect((await send(server, signInPath(), { method: 'DELETE', headers: tab.headers })).status).toBe(204);
    expect(authStates(server)).toEqual([]);
  });
});

describe('agent setup routes: when node-pty fails to load', () => {
  it('the card gets the reason, sign-in fails plainly, the detail goes to the log, and the rest of the app works', async () => {
    const broken: PtyLoader = async () => ({ ok: false, reason: 'no prebuilt terminal for this platform', detail: 'Error: dlopen failed at pty.node' });
    const { server, tab, lines } = await startSetupServer({}, { loadPty: broken });
    const [claude] = await agents(server, tab);
    expect(claude).toMatchObject({
      agentId: 'claude-code',
      install: 'installed',
      auth: 'failed',
      reason: "Sign-in isn't available on this computer: no prebuilt terminal for this platform",
    });
    const reply = await send(server, signInPath(), { method: 'POST', headers: tab.headers });
    expect(reply.status).toBe(200);
    expect(SignInResponse.parse(reply.json())).toEqual({ state: 'failed', url: null });
    expect(authStates(server)).toEqual(['signing_in', 'failed']);
    expect(lines.join('')).toContain('dlopen failed at pty.node');
    expect((await send(server, API_ROUTES.workspaces, { headers: tab.headers })).status).toBe(200);
  });
});

const realPty = await loadPty();
describe.runIf(realPty.ok || process.env.CI !== undefined)('agent setup routes: signing in through the hidden terminal', () => {
  it('lists Claude Code, signs in through the callback, and keeps the URL out of every event and log line', async () => {
    const { server, tab, lines } = await startSetupServer();
    expect(await agents(server, tab)).toEqual([
      { agentId: 'claude-code', displayName: 'Claude Code', install: 'installed', version: null, auth: 'needs_sign_in', signInTab: 'agent', apiKey: { saved: false } },
    ]);

    const reply = await send(server, signInPath(), { method: 'POST', headers: tab.headers });
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    const started = SignInResponse.parse(reply.json());
    expect(started.state).toBe('signing_in');
    const url = new URL(started.url!);
    expect(url.hostname).toBe('claude.ai');
    expect((await agents(server, tab))[0]!.auth).toBe('signing_in');

    const callback = url.searchParams.get('redirect_uri')!.replace('localhost', '127.0.0.1');
    expect((await fetch(callback)).status).toBe(200);
    await waitFor(() => authStates(server).includes('signed_in'), 'signed in', 20_000);
    expect(authStates(server)).toEqual(['signing_in', 'signed_in']);
    expect((await agents(server, tab))[0]).toMatchObject({ install: 'installed', auth: 'signed_in', method: 'subscription' });

    const kept = everythingKept(server, lines);
    expect(kept).not.toContain('claude.ai');
    expect(kept).not.toContain('oauth');
    expect(kept).not.toContain('fake-state');
    expect(kept).not.toContain('Paste code');
    expect(kept).not.toContain('Login successful');
  }, 30_000);

  it('a pasted code completes the sign-in (204, no-store) and is never logged or evented', async () => {
    const { server, tab, lines } = await startSetupServer({ FAKE_LOGIN_MODE: 'code', FAKE_LOGIN_CODE: 'pasted-Code_42' });
    expect((await send(server, signInPath(), { method: 'POST', headers: tab.headers })).status).toBe(200);
    const sent = await send(server, codePath(), { method: 'POST', headers: json(tab), body: JSON.stringify({ code: 'pasted-Code_42' }) });
    expect(sent.status).toBe(204);
    expect(sent.headers['cache-control']).toBe('no-store');
    await waitFor(() => authStates(server).includes('signed_in'), 'signed in', 20_000);
    expect(everythingKept(server, lines)).not.toContain('pasted-Code_42');
  }, 30_000);

  it('cancel stops the sign-in (204, idempotent) and says needs sign-in; a failing login is failed with the plain reason', async () => {
    const { server, tab } = await startSetupServer({ FAKE_LOGIN_MODE: 'hang' });
    expect((await send(server, signInPath(), { method: 'POST', headers: tab.headers })).status).toBe(200);
    expect((await send(server, signInPath(), { method: 'DELETE', headers: tab.headers })).status).toBe(204);
    expect((await send(server, signInPath(), { method: 'DELETE', headers: tab.headers })).status).toBe(204);
    expect(authStates(server)).toEqual(['signing_in', 'needs_sign_in']);
    expect((await agents(server, tab))[0]!.auth).toBe('needs_sign_in');

    const failing = await startSetupServer({ FAKE_LOGIN_MODE: 'fail' });
    expect((await send(failing.server, signInPath(), { method: 'POST', headers: failing.tab.headers })).status).toBe(200);
    await waitFor(() => authStates(failing.server).includes('failed'), 'failed', 20_000);
    expect((await agents(failing.server, failing.tab))[0]).toMatchObject({ auth: 'failed', reason: "Claude Code couldn't finish signing in. Try again." });
  }, 30_000);

  it('an unexpected sign-in method fails with the plain reason and runs nothing', async () => {
    const { server, tab } = await startSetupServer({ FAKE_ACP_AUTH: 'terminal' });
    expect(SignInResponse.parse((await send(server, signInPath(), { method: 'POST', headers: tab.headers })).json())).toEqual({ state: 'failed', url: null });
    expect((await agents(server, tab))[0]).toMatchObject({ auth: 'failed', reason: "This version of Claude Code offers a sign-in Ogden Agents can't run." });
  }, 30_000);

  it('stopping the server kills a sign-in in progress, the CLI it started included', async () => {
    const pidFile = join(dirname(stateFile()), 'cli.pid');
    const { server, tab } = await startSetupServer({ FAKE_LOGIN_MODE: 'hang', FAKE_LOGIN_PID_FILE: pidFile });
    expect((await send(server, signInPath(), { method: 'POST', headers: tab.headers })).status).toBe(200);
    await waitFor(() => existsSync(pidFile), 'the CLI pid', 10_000);
    const cliPid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(cliPid)).toBe(true);
    await server.close();
    await waitFor(() => !alive(cliPid), 'the CLI to stop', 10_000);
  }, 30_000);
});

const KEY = 'sk-ant-api03-ROUTES_TEST_only_0123456789-abcdWXYZ';
const keyPath = (agentId = 'claude-code') => apiPath(API_ROUTES.agentApiKey, { agentId });

/** A server whose Claude Code key check answers `verification` (counting its calls), keys kept in `secrets`. */
async function startKeyServer(
  options: { env?: Record<string, string>; verification?: ApiKeyVerification; secrets?: SecretStorePort; signedIn?: boolean; extra?: StartOptions } = {},
) {
  const state = stateFile();
  if (options.signedIn === true) writeFileSync(state, JSON.stringify({ loggedIn: true }));
  const checked: string[] = [];
  const started = await startSetupServer(
    { FAKE_LOGIN_STATE: state, ...options.env },
    {
      secrets: options.secrets ?? createMemorySecretStore(),
      verifyApiKey: async (value) => {
        checked.push(value);
        return options.verification ?? 'ok';
      },
      ...options.extra,
    },
  );
  return { ...started, checked };
}

/** Opens a chat in a fresh folder and sends `text`; returns the session id and a cleanup (after the server closes). */
async function chatOnce(server: TestServer, tab: SignedIn, text: string) {
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-key-repo-'));
  temps.push(repo);
  const post = (path: string, body: unknown) => fetch(`${server.url}${path}`, { method: 'POST', headers: json(tab), body: JSON.stringify(body) });
  const { workspace } = WorkspaceResponse.parse(await (await post(API_ROUTES.workspaces, { path: repo })).json());
  const { session } = SessionResponse.parse(await (await post(apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  expect((await post(apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text })).status).toBe(202);
  return session.id;
}

const settledState = (server: TestServer, sessionId: string) => {
  const state = server.core.entities.getSession(sessionId as never)?.state;
  return state === 'idle' || state === 'error' ? state : undefined;
};

const putKey = (server: TestServer, tab: SignedIn, body: string, agentId?: string) =>
  send(server, keyPath(agentId), { method: 'PUT', headers: json(tab), body });

describe('agent setup routes: the API key (story 9.2)', () => {
  it('signed out: a good key is saved (204, no-store), the card reads "saved …WXYZ" and signed in with an API key, and nothing keeps the key', async () => {
    const secrets = createMemorySecretStore();
    const { server, tab, lines, checked } = await startKeyServer({ secrets });
    const saved = await putKey(server, tab, JSON.stringify({ apiKey: KEY }));
    expect(saved.status).toBe(204);
    expect(saved.headers['cache-control']).toBe('no-store');
    expect(saved.body).toBe('');
    expect(checked).toEqual([KEY]);
    expect(await secrets.get('agent-api-key/claude-code')).toBe(KEY);

    const [claude] = await agents(server, tab);
    expect(claude).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: 'WXYZ' } });
    expect(claude!.apiKey!.unchecked).toBeUndefined();
    const auth = server.core.events.readAfter(0).filter((event) => event.type === 'agent.auth_changed');
    expect(auth.map((event) => event.payload)).toEqual([{ agentId: 'claude-code', state: 'signed_in', method: 'api_key' }]);

    const list = await send(server, API_ROUTES.agents, { headers: tab.headers });
    expect(list.body).not.toContain(KEY);
    expect(everythingKept(server, lines)).not.toContain(KEY);
    expect(everythingKept(server, lines)).not.toContain('ROUTES_TEST_only');
  });

  it('a refused key is 400 api_key_refused and nothing is stored', async () => {
    const secrets = createMemorySecretStore();
    const { server, tab, lines } = await startKeyServer({ verification: 'refused', secrets });
    const refused = await putKey(server, tab, JSON.stringify({ apiKey: KEY }));
    expect(refused.status).toBe(400);
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(ApiErrorBody.parse(refused.json()).error).toEqual({ code: 'api_key_refused', message: 'That key was refused. Check it and paste it again.' });
    expect(refused.body).not.toContain(KEY);
    expect(await secrets.get('agent-api-key/claude-code')).toBeUndefined();
    expect((await agents(server, tab))[0]!.apiKey).toEqual({ saved: false });
    expect(everythingKept(server, lines)).not.toContain(KEY);
  });

  it("a key that couldn't be checked is saved (204), and the card says so", async () => {
    const { server, tab } = await startKeyServer({ verification: 'unchecked' });
    expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }))).status).toBe(204);
    expect((await agents(server, tab))[0]!.apiKey).toEqual({ saved: true, lastFour: 'WXYZ', unchecked: true });
  });

  it("a key that's blank or malformed is 400 in plain words, never echoed, with no check made", async () => {
    const { server, tab, lines, checked } = await startKeyServer();
    for (const apiKey of ['', '   ', 'sk-proj-looks-like-another-providers-key-12345', 'sk-ant-short', `${KEY} ${KEY}`]) {
      const reply = await putKey(server, tab, JSON.stringify({ apiKey }));
      expect(reply.status, apiKey).toBe(400);
      expect(ApiErrorBody.parse(reply.json()).error).toEqual({ code: 'invalid_request', message: "That doesn't look like an Anthropic API key." });
      if (apiKey.trim() !== '') expect(reply.body).not.toContain(apiKey.trim());
    }
    expect((await putKey(server, tab, '{"apiKey": 42}')).status).toBe(400);
    expect((await putKey(server, tab, 'apiKey=sk-ant')).status).toBe(400);
    expect(checked).toEqual([]);
    expect(lines.join('')).not.toContain('sk-proj-looks');
    expect(lines.join('')).not.toContain(KEY);
  });

  it('no keychain: 503 secrets_unavailable in plain words, the log gets the code only, and sign-in still works', async () => {
    const broken: SecretStorePort = {
      backend: 'keychain',
      get: async () => undefined,
      set: async () => {
        throw new SecretsUnavailableError(undefined, { cause: 'GenericFailure' });
      },
      delete: async () => {
        throw new SecretsUnavailableError(undefined, { cause: 'GenericFailure' });
      },
    };
    const { server, tab, lines } = await startKeyServer({ secrets: broken });
    const reply = await putKey(server, tab, JSON.stringify({ apiKey: KEY }));
    expect(reply.status).toBe(503);
    expect(ApiErrorBody.parse(reply.json()).error).toEqual({
      code: 'secrets_unavailable',
      message: "There's no keychain on this computer to keep an API key in. Sign in with your account instead.",
    });
    expect((await send(server, keyPath(), { method: 'DELETE', headers: tab.headers })).status).toBe(503);
    expect(lines.join('')).toContain('GenericFailure');
    expect(lines.join('')).not.toContain(KEY);
    expect((await agents(server, tab))[0]).toMatchObject({ auth: 'needs_sign_in', apiKey: { saved: false } });
  });

  it('subscription signed in: the key is saved but not in use, and no event says otherwise', async () => {
    const { server, tab } = await startKeyServer({ signedIn: true });
    expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }))).status).toBe(204);
    expect((await agents(server, tab))[0]).toMatchObject({ auth: 'signed_in', method: 'subscription', apiKey: { saved: true, lastFour: 'WXYZ' } });
    expect(authStates(server)).toEqual([]);
  });

  it("unknown sign-in: the key is not in use, and the card's reason says why", async () => {
    const setupPort: AgentSetupPort = {
      agentId: 'claude-code',
      displayName: 'Claude Code',
      status: async () => ({ agentId: 'claude-code', displayName: 'Claude Code', install: 'installed', version: null, auth: 'needs_sign_in', reason: 'x', subscription: 'unknown' }),
      install: async () => ({ version: null }),
      signIn: async () => ({ url: null, done: new Promise(() => {}), cancel: async () => {} }),
      apiKey: createClaudeApiKey({ verify: async () => 'ok' }),
    };
    const { server, tab } = await startKeyServer({ extra: { agentSetup: [setupPort] } });
    expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }))).status).toBe(204);
    expect((await agents(server, tab))[0]).toMatchObject({
      auth: 'needs_sign_in',
      reason: "Ogden Agents couldn't check your Claude Code sign-in, so your API key isn't in use.",
      apiKey: { saved: true, lastFour: 'WXYZ' },
    });
  });

  it('remove is 204 (no-store) and idempotent, and the card re-reads the store', async () => {
    const secrets = createMemorySecretStore();
    const { server, tab } = await startKeyServer({ secrets });
    expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }))).status).toBe(204);
    for (let i = 0; i < 2; i++) {
      const removed = await send(server, keyPath(), { method: 'DELETE', headers: tab.headers });
      expect(removed.status).toBe(204);
      expect(removed.headers['cache-control']).toBe('no-store');
    }
    expect(await secrets.get('agent-api-key/claude-code')).toBeUndefined();
    expect((await agents(server, tab))[0]).toMatchObject({ auth: 'needs_sign_in', apiKey: { saved: false } });
    expect(authStates(server)).toEqual(['signed_in', 'needs_sign_in']);
  });

  it('an unknown agent is 404, a body over 4 KiB is 413, and both routes need a token and a matching Origin', async () => {
    const { server, tab, lines } = await startKeyServer();
    for (const agentId of ['nope', 'Not_An_Id']) {
      expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }), agentId)).status).toBe(404);
      expect((await send(server, keyPath(agentId), { method: 'DELETE', headers: tab.headers })).status).toBe(404);
    }
    const huge = await putKey(server, tab, JSON.stringify({ apiKey: `${KEY}${'a'.repeat(5000)}` }));
    expect(huge.status).toBe(413);
    expect(huge.body).not.toContain(KEY);
    for (const method of ['PUT', 'DELETE']) {
      expect((await send(server, keyPath(), { method, headers: { origin: server.url } })).status).toBe(401);
      expect((await send(server, keyPath(), { method, headers: { ...tab.headers, origin: 'http://evil.example' } })).status).toBe(403);
    }
    expect(lines.join('')).not.toContain(KEY);
  });

  it('a saved key survives a restart: after load() the card shows its last 4 and the chat uses it while signed out', async () => {
    const secrets = createMemorySecretStore({ 'agent-api-key/claude-code': KEY });
    const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-key-repo-'));
    const { server, tab, lines } = await startKeyServer({ secrets, env: { FAKE_ACP_REQUIRE_API_KEY: '1' } });
    try {
      expect((await agents(server, tab))[0]).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: 'WXYZ' } });
      const post = (path: string, body: unknown) => fetch(`${server.url}${path}`, { method: 'POST', headers: json(tab), body: JSON.stringify(body) });
      const { workspace } = WorkspaceResponse.parse(await (await post(API_ROUTES.workspaces, { path: repo })).json());
      const { session } = SessionResponse.parse(await (await post(apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
      expect((await post(apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: 'hello' })).status).toBe(202);
      await waitFor(() => JSON.stringify(server.core.events.readAfter(0)).includes('key received'), 'the reply', 20_000);
      expect(everythingKept(server, lines)).not.toContain(KEY);
    } finally {
      await server.close();
      rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 30_000);

  it('signed in with the subscription, the chat never gets the key', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-key-repo-'));
    const { server, tab } = await startKeyServer({ signedIn: true, env: { FAKE_ACP_REQUIRE_API_KEY: '1' } });
    try {
      expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }))).status).toBe(204);
      const post = (path: string, body: unknown) => fetch(`${server.url}${path}`, { method: 'POST', headers: json(tab), body: JSON.stringify(body) });
      const { workspace } = WorkspaceResponse.parse(await (await post(API_ROUTES.workspaces, { path: repo })).json());
      const { session } = SessionResponse.parse(await (await post(apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
      expect((await post(apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: 'hello' })).status).toBe(202);
      await waitFor(() => server.core.entities.getSession(session.id)?.state === 'error', 'the auth-required failure', 20_000);
      expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain('key received');
    } finally {
      await server.close();
      rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 30_000);
});

describe('agent setup routes: review fixes (story 9.2)', () => {
  it("F1: a key in the server's own environment (any case) follows the same rule: used signed out, never signed in", async () => {
    const ENV_KEY = 'sk-ant-api03-FROM_ENVIRONMENT_0123456789-envK';
    const out = await startKeyServer({ env: { FAKE_ACP_REQUIRE_API_KEY: '1' }, extra: { extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: stateFile(), FAKE_ACP_REQUIRE_API_KEY: '1', Anthropic_Api_Key: ENV_KEY } } });
    expect((await agents(out.server, out.tab))[0]).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: false, fromEnvironment: true } });
    const used = await chatOnce(out.server, out.tab, 'hello');
    await waitFor(() => settledState(out.server, used) !== undefined, 'the reply', 20_000);
    expect(JSON.stringify(out.server.core.events.readAfter(0))).toContain('key received');
    expect(everythingKept(out.server, out.lines)).not.toContain(ENV_KEY);
    await out.server.close();

    const signedIn = stateFile();
    writeFileSync(signedIn, JSON.stringify({ loggedIn: true }));
    const inn = await startKeyServer({ extra: { extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: signedIn, FAKE_ACP_REQUIRE_API_KEY: '1', ANTHROPIC_API_KEY: ENV_KEY } } });
    expect((await agents(inn.server, inn.tab))[0]).toMatchObject({ auth: 'signed_in', method: 'subscription', apiKey: { saved: false, fromEnvironment: true } });
    const refused = await chatOnce(inn.server, inn.tab, 'hello');
    await waitFor(() => settledState(inn.server, refused) === 'error', 'the auth-required failure', 20_000);
    expect(JSON.stringify(inn.server.core.events.readAfter(0))).not.toContain('key received');
    await inn.server.close();
  }, 60_000);

  it('F1: only one spelling of the key reaches the chat, however the server environment spelled it', async () => {
    const ENV_KEY = 'sk-ant-api03-ONE_SPELLING_0123456789-abcd';
    const { server, tab } = await startKeyServer({ extra: { extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: stateFile(), anthropic_api_key: ENV_KEY } } });
    const session = await chatOnce(server, tab, 'echo-env');
    await waitFor(() => settledState(server, session) !== undefined, 'the reply', 20_000);
    const reply = server.core.events
      .readAfter(0)
      .flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []))
      .join('');
    const names = reply.split('\n').map((line) => line.split('=')[0]!).filter((name) => name.toUpperCase() === 'ANTHROPIC_API_KEY');
    expect(names).toEqual(['ANTHROPIC_API_KEY']);
    await server.close();
  }, 30_000);

  it('F4: a sign-in made outside the app stops the key before the next chat starts, once the state is stale', async () => {
    const state = stateFile();
    const { server, tab } = await startKeyServer({
      extra: { subscriptionMaxAgeMs: 0, extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: state, FAKE_ACP_REQUIRE_API_KEY: '1' } },
    });
    expect((await putKey(server, tab, JSON.stringify({ apiKey: KEY }))).status).toBe(204);
    // Signed in in a terminal, behind the app's back; no list() refresh in between.
    writeFileSync(state, JSON.stringify({ loggedIn: true }));
    const session = await chatOnce(server, tab, 'hello');
    await waitFor(() => settledState(server, session) === 'error', 'the auth-required failure', 20_000);
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain('key received');
    await server.close();
  }, 30_000);

  it('F5: the in-memory store is honoured only in a test run', () => {
    expect(testSecretStore({ OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', NODE_ENV: 'test' })).toBe('memory');
    expect(testSecretStore({ OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', VITEST: 'true' })).toBe('memory');
    expect(testSecretStore({ OGDEN_AGENTS_TEST_SECRET_STORE: 'memory' })).toBeUndefined();
    expect(testSecretStore({ OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', NODE_ENV: 'production', VITEST: '' })).toBeUndefined();
    expect(testSecretStore({ NODE_ENV: 'test' })).toBeUndefined();
    expect(testSecretStore({ OGDEN_AGENTS_TEST_SECRET_STORE: 'keychain', NODE_ENV: 'test' })).toBeUndefined();
  });
});

describe('agent setup routes: installing Claude Code (story 9.3)', () => {
  const installPath = (agentId = 'claude-code') => apiPath(API_ROUTES.agentInstall, { agentId });
  const FAKE_AGENT_URL = pathToFileURL(FAKE_AGENT).href;

  /** Pins for a stand-in adapter; the fake npm below "installs" it. */
  const pins: AdapterPins = {
    packageJson: { name: 'ogden-agents-claude-code', private: true, dependencies: { '@agentclientprotocol/claude-agent-acp': '9.9.9' } },
    lock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/@agentclientprotocol/claude-agent-acp': { version: '9.9.9', integrity: 'sha512-x' } } },
  };

  /** A fake npm the test ends by hand: `succeed` writes an adapter that runs the fake agent, `fail` prints an error code. */
  function handNpm() {
    const runs: Array<{ input: NpmRunInput; end: (exitCode: number | null) => void; killed: boolean }> = [];
    const runNpm: NpmRunner = (input) => {
      let end!: (exitCode: number | null) => void;
      const exited = new Promise<{ exitCode: number | null }>((resolve) => (end = (exitCode) => resolve({ exitCode })));
      const run = { input, end, killed: false };
      runs.push(run);
      return {
        exited,
        kill: () => {
          run.killed = true;
          end(null);
        },
      };
    };
    const succeed = (index = 0) => {
      const run = runs[index]!;
      const root = join(run.input.cwd, 'node_modules', '@agentclientprotocol', 'claude-agent-acp');
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@agentclientprotocol/claude-agent-acp', version: '9.9.9' }));
      writeFileSync(join(root, 'dist', 'index.js'), `await import(${JSON.stringify(FAKE_AGENT_URL)});\n`);
      run.input.onLine('npm http fetch GET 200 https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/x.tgz 3ms (cache miss)');
      run.end(0);
    };
    const fail = (code: string, index = 0) => {
      const run = runs[index]!;
      run.input.onLine(`npm error code ${code}`);
      run.input.onLine('npm error secret-looking output https://user:token@registry.example/');
      run.end(1);
    };
    return { runNpm, runs, succeed, fail };
  }

  async function startInstallServer(npm: ReturnType<typeof handNpm>, dataDir?: string) {
    const npmCli = join(mkdtempSync(join(tmpdir(), 'ogden-agents-npm-')), 'npm-cli.js');
    temps.push(dirname(npmCli));
    writeFileSync(npmCli, '');
    return startSetupServer({}, {
      claudeAdapterPath: undefined,
      claudeInstall: { devAdapter: false, pins, runNpm: npm.runNpm, npmCli },
      claudeExecutable: null,
      ...(dataDir === undefined ? {} : { dataDir }),
    });
  }

  const installEvents = (server: TestServer) => server.core.events.readAfter(0).filter((event) => event.type.startsWith('agent.install_'));

  it('Not installed → Install (202) → progress → Installed, needs sign-in; a second Install starts no second npm; a chat then runs the installed adapter', async () => {
    const npm = handNpm();
    const { server, tab, lines } = await startInstallServer(npm);
    expect((await agents(server, tab))[0]).toMatchObject({ install: 'not_installed', installSize: 'large' });

    const first = await send(server, installPath(), { method: 'POST', headers: tab.headers });
    expect(first.status).toBe(202);
    expect(AgentSetupStatus.parse(first.json())).toMatchObject({ install: 'installing' });
    await waitFor(() => npm.runs.length === 1, 'npm to start');
    const second = await send(server, installPath(), { method: 'POST', headers: tab.headers });
    expect(second.status).toBe(202);
    expect(AgentSetupStatus.parse(second.json()).install).toBe('installing');
    expect((await agents(server, tab))[0]!.install).toBe('installing');
    // Bundled: no claude was found.
    expect(npm.runs[0]!.input.args).not.toContain('--omit=optional');

    npm.succeed();
    await waitFor(() => installEvents(server).some((event) => event.type === 'agent.install_completed'), 'the install to complete');
    expect(npm.runs).toHaveLength(1);
    expect(installEvents(server).map((event) => event.type)).toEqual(expect.arrayContaining(['agent.install_started', 'agent.install_progress', 'agent.install_completed']));
    expect((await agents(server, tab))[0]).toMatchObject({ install: 'installed', version: '9.9.9', auth: 'needs_sign_in' });
    // Installed: Install answers 202 with the status and starts nothing.
    expect(AgentSetupStatus.parse((await send(server, installPath(), { method: 'POST', headers: tab.headers })).json()).install).toBe('installed');

    // A chat starts through the adapter in the data folder, without a restart.
    const sessionId = await chatOnce(server, tab, 'hello');
    await waitFor(() => settledState(server, sessionId) !== undefined, 'the chat to answer', 10_000);
    expect(settledState(server, sessionId)).toBe('idle');
    await waitFor(() => lines.some((line) => line.includes('starting the Claude Code adapter') && line.includes('adapter-9.9.9-bundled')), 'the installed adapter to start', 10_000);
  });

  it('a failed install is agent.install_failed in plain words, the log gets npm code only, and Try again installs', async () => {
    const npm = handNpm();
    const { server, tab, lines } = await startInstallServer(npm);
    expect((await send(server, installPath(), { method: 'POST', headers: tab.headers })).status).toBe(202);
    await waitFor(() => npm.runs.length === 1, 'npm to start');
    npm.fail('EINTEGRITY');
    await waitFor(() => installEvents(server).some((event) => event.type === 'agent.install_failed'), 'the install to fail');
    const failed = installEvents(server).find((event) => event.type === 'agent.install_failed')!;
    expect(failed.payload).toEqual({ agentId: 'claude-code', reason: "The download didn't match the expected files, so nothing was installed. Try again." });
    expect((await agents(server, tab))[0]).toMatchObject({ install: 'failed', reason: "The download didn't match the expected files, so nothing was installed. Try again." });
    const kept = everythingKept(server, lines);
    expect(kept).toContain('EINTEGRITY');
    expect(kept).not.toContain('token@registry');
    expect(kept).not.toContain('secret-looking');

    expect((await send(server, installPath(), { method: 'POST', headers: tab.headers })).status).toBe(202);
    await waitFor(() => npm.runs.length === 2, 'npm to start again');
    npm.succeed(1);
    await waitFor(async () => (await agents(server, tab))[0]!.install === 'installed', 'the second install');
  });

  it("an npm that can't start logs its errno code only: no path reaches the log or an event (review F3)", async () => {
    const npmCli = join(mkdtempSync(join(tmpdir(), 'ogden-agents-npm-')), 'npm-cli.js');
    temps.push(dirname(npmCli));
    writeFileSync(npmCli, '');
    const hidden = join(tmpdir(), 'secret-dir-f3', 'node');
    const { server, tab, lines } = await startSetupServer({}, {
      claudeAdapterPath: undefined,
      claudeInstall: { devAdapter: false, pins, npmCli, nodePath: hidden },
      claudeExecutable: null,
    });
    expect((await send(server, installPath(), { method: 'POST', headers: tab.headers })).status).toBe(202);
    await waitFor(() => installEvents(server).some((event) => event.type === 'agent.install_failed'), 'the install to fail');
    const kept = everythingKept(server, lines);
    expect(kept).toContain('ENOENT');
    expect(kept).not.toContain('secret-dir-f3');
    expect(kept).not.toContain(npmCli);
  });

  it('an unknown agent is 404, and Install needs a token and a matching Origin', async () => {
    const npm = handNpm();
    const { server, tab } = await startInstallServer(npm);
    expect((await send(server, installPath('nope'), { method: 'POST', headers: tab.headers })).status).toBe(404);
    expect((await send(server, installPath(), { method: 'POST', headers: { origin: server.url } })).status).toBe(401);
    expect((await send(server, installPath(), { method: 'POST', headers: { ...tab.headers, origin: 'http://evil.example' } })).status).toBe(403);
    expect(npm.runs).toHaveLength(0);
  });

  it('stopping the server kills npm and removes its work folder', async () => {
    const npm = handNpm();
    const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-install-stop-'));
    temps.push(dataDir);
    const { server, tab } = await startInstallServer(npm, dataDir);
    expect((await send(server, installPath(), { method: 'POST', headers: tab.headers })).status).toBe(202);
    await waitFor(() => npm.runs.length === 1, 'npm to start');
    expect(readdirSync(join(dataDir, 'agents', 'claude-code')).some((name) => name.startsWith('.install-'))).toBe(true);
    await server.close();
    expect(npm.runs[0]!.killed).toBe(true);
    expect(readdirSync(join(dataDir, 'agents', 'claude-code'))).toEqual([]);
  });
});
