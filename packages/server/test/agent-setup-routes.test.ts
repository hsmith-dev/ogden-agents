/**
 * The agents list and sign-in routes (story 9.1) on a real server whose
 * Claude Code is the fake ACP agent and whose CLI is the fake login program
 * (`tests/fixtures/fake-claude-login.mjs`). No test runs a real login.
 *
 * The sign-in URL leaves the server only in the `no-store` sign-in answer:
 * never in an event or a log line, and neither do the login's output or a
 * pasted code (AD-15, AD-16).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadPty, type PtyLoader } from '@ogden-agents/adapters';
import { AgentsResponse, API_ROUTES, ApiErrorBody, apiPath, SignInResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { send, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

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

async function startSetupServer(env: Record<string, string> = {}, extra: { loadPty?: PtyLoader } = {}) {
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
      { agentId: 'claude-code', displayName: 'Claude Code', install: 'installed', version: null, auth: 'needs_sign_in', signInTab: 'agent' },
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
