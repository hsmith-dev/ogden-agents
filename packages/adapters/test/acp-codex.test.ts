/**
 * Codex's chat adapter (epic 12 entry 5), against the fake ACP agent's Codex
 * personality (`tests/fixtures/fake-codex.mjs`: spike 12.1's mode ids, sign-in
 * methods, permission options and resume). No test runs the real adapter or
 * Codex, reads `~/.codex` or reaches the network.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, PROTECTED_PATHS, type AgentEvent, type AgentPermissionDecision, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { acpReasons, CODEX_CONFIG_TOML, CODEX_DESCRIPTOR, createCodexAgent, ensureCodexConfig } from '../src/index.js';

const FAKE_CODEX = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-codex.mjs');
const KEY = `sk-proj-${'K'.repeat(40)}4321`;
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-codex-'));
  dirs.push(dir);
  return dir;
}

/** The environment core would give it: enough to run Node, its home and (when given) its key. */
const envOf = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: process.env.PATH ?? '', CODEX_HOME: tempDir(), ...extra });

const agentOf = (diagnostics: Array<[string, Record<string, unknown> | undefined]> = []) =>
  createCodexAgent({ dataDir: tempDir(), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }), onDiagnostic: (message, fields) => diagnostics.push([message, fields]) });

type Decide = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

async function start(options: { env?: Record<string, string>; decide?: Decide; cwd?: string } = {}) {
  const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
  const env = envOf({ CODEX_API_KEY: KEY, ...options.env });
  const session = await agentOf(diagnostics).startSession({ cwd: options.cwd ?? tempDir(), env, onPermissionRequest: options.decide, protectedPaths: PROTECTED_PATHS });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { session, events, diagnostics, env };
}

const replyText = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');

describe("Codex's chat port (epic 12 entry 5)", () => {
  it('declares Ask and Skip all only (never Auto or workspace-write), and has no terminal resume (agent_unsupported)', () => {
    const agent = agentOf();
    expect(agent.displayName).toBe('Codex');
    expect(agent.permissionModes).toEqual(['ask', 'skip_all']);
    expect(agent.terminalResume).toBeUndefined();
    expect(agent.skillInvocation('bmad-help')).toBe('$bmad-help');
    expect(agent.skillInvocation('bmad-help', 'an idea')).toBe('$bmad-help an idea');
  });

  it('refuses to start as not set up when it is not installed', async () => {
    const agent = createCodexAgent({ dataDir: tempDir() });
    const failure = await agent.startSession({ cwd: tempDir(), env: envOf() }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentError);
    expect(failure).toMatchObject({ code: 'agent_unavailable', message: acpReasons('Codex').notSetUp });
  });

  it('writes its home config (ephemeral credentials, plugins off) before it starts, and never sets CODEX_PATH', async () => {
    const { session, events, env } = await start();
    expect(readFileSync(join(env.CODEX_HOME!, 'config.toml'), 'utf8')).toBe(CODEX_CONFIG_TOML);
    expect(CODEX_CONFIG_TOML).toContain('cli_auth_credentials_store = "ephemeral"');
    expect(CODEX_CONFIG_TOML).toContain('plugins = false');
    // It starts in Ask (the adapter's own default is Auto review), and no `CODEX_PATH` reaches it.
    await session.prompt('mode');
    expect(replyText(events)).toBe('mode=read-only');
    events.length = 0;
    events.length = 0;
    await session.prompt('echo-env');
    expect(replyText(events)).toContain('INITIAL_AGENT_MODE=read-only');
    expect(replyText(events)).not.toContain('CODEX_PATH=');
    expect(existsSync(join(env.CODEX_HOME!, 'auth.json'))).toBe(false);
  });

  it('does not start without its own home, and replaces a stale or linked config.toml', async () => {
    const agent = agentOf();
    const failure = await agent.startSession({ cwd: tempDir(), env: { PATH: process.env.PATH ?? '', CODEX_API_KEY: KEY } }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'agent_unavailable', message: acpReasons('Codex').couldNotStart });
    const home = tempDir();
    writeFileSync(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
    ensureCodexConfig(home);
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(CODEX_CONFIG_TOML);
  });

  it('authenticates with its API key before the session (and only with it), never logging the key', async () => {
    const { session, events, diagnostics } = await start();
    await session.prompt('auth');
    expect(replyText(events)).toBe('auth=api-key key=4321');
    expect(diagnostics).toContainEqual(['authenticated with the agent', { methodId: 'api-key' }]);
    expect(JSON.stringify(diagnostics)).not.toContain(KEY);
  });

  it('without a key, a session it refuses is auth_required, in words about the key and never a sign-in', async () => {
    const failure = await agentOf().startSession({ cwd: tempDir(), env: envOf() }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'auth_required', message: 'Codex needs a valid API key. Check it in Settings → Agents.' });
  });

  it('holds a shell command for its card, Allow once picks allow_once, Deny picks decline (never cancel or always)', async () => {
    const asked: AgentPermissionRequest[] = [];
    let answer: AgentPermissionDecision = { outcome: 'allow_once' };
    const { session, events } = await start({
      decide: async (request) => {
        asked.push(request);
        return answer;
      },
    });
    await session.prompt('permission npm test');
    expect(asked[0]).toMatchObject({ kind: 'execute', command: 'npm test', title: 'Run npm test' });
    expect(replyText(events)).toBe('Ran npm test. chose=allow_once');
    events.length = 0;
    answer = { outcome: 'deny' };
    await session.prompt('permission rm -rf build');
    expect(replyText(events)).toBe('Denied rm -rf build. chose=decline');
  });

  it('takes Deny from the only reject option there is when there is no decline (a file change)', async () => {
    const { session, events } = await start({ env: { FAKE_ACP_REJECT_OPTIONS: 'cancel:No and tell Codex what to do differently' }, decide: async () => ({ outcome: 'deny' }) });
    await session.prompt('permission npm test');
    expect(replyText(events)).toBe('Denied npm test. chose=cancel');
  });

  it('sets Skip all as agent-full-access (which runs commands without asking), refuses Auto, and drops anything that asks less to Ask', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await start({
      decide: async (request) => {
        asked.push(request);
        return { outcome: 'deny' };
      },
    });
    expect(session.permissionModes).toEqual(['ask', 'skip_all']);
    await expect(session.setPermissionMode!('auto')).rejects.toThrow(acpReasons('Codex').noSuchMode);
    await session.setPermissionMode!('skip_all');
    await session.prompt('mode');
    expect(replyText(events)).toBe('mode=agent-full-access');
    events.length = 0;
    await session.prompt('permission ls');
    expect(replyText(events)).toBe('Ran ls.');
    expect(asked).toEqual([]);
    await session.setPermissionMode!('ask');
    events.length = 0;
    await session.prompt('mode-switch agent');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'other', asksLess: true, label: 'Auto review' });
    events.length = 0;
    await session.prompt('mode-switch workspace-write');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'other', asksLess: true, label: 'Workspace write' });
    events.length = 0;
    await session.prompt('mode-switch read-only');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'ask', asksLess: false, label: 'Read-only' });
  });

  it('reopens its session in a new process with resume, else load, else a new one', async () => {
    const cwd = tempDir();
    const { session } = await start({ cwd });
    const id = session.agentSessionId;
    await session.close();
    const reopen = async (env: Record<string, string>) => {
      const reopened = await agentOf().reopenSession({ cwd, env: envOf({ CODEX_API_KEY: KEY, ...env }), agentSessionId: id });
      sessions.push(reopened.session);
      return reopened.restored;
    };
    expect(await reopen({})).toBe('resumed');
    expect(await reopen({ FAKE_ACP_REOPEN_FAIL: 'resume' })).toBe('loaded');
    expect(await reopen({ FAKE_ACP_REOPEN_FAIL: 'resume,load' })).toBe('new');
  });

  it('says a usage limit in words the handoff recognises', () => {
    const limit = (text: string) => CODEX_DESCRIPTOR.usageLimitPatterns!.some((pattern) => pattern.test(text));
    expect(limit("You've hit your usage limit. Try again later.")).toBe(true);
    expect(limit('insufficient_quota')).toBe(true);
    expect(limit('network error')).toBe(false);
  });
});
