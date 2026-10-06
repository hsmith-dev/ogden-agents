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
import { acpReasons, CODEX_ATTENDED_ONLY_REASON, CODEX_CONFIG_TOML, CODEX_DESCRIPTOR, createCodexAgent, ensureCodexConfig } from '../src/index.js';

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

  describe('an unattended build start (epic 17)', () => {
    const sandboxOf = (worktree: string) => ({ kind: 'test', writableRoots: [worktree, join(worktree, '..', 'store')], deniedPaths: [], deniedReads: [], allowedReads: [worktree] });

    it('is refused until the live checks have shown its sandbox holds (fail closed), and the same session starts nothing', async () => {
      const cwd = tempDir();
      const failure = await agentOf().startSession({ cwd, env: envOf({ CODEX_API_KEY: KEY }), sandbox: sandboxOf(cwd) }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'agent_unavailable' });
      expect(String((failure as Error).message)).toContain('Build with you watching');
    });

    it('when verified, starts in workspace-write with only the run roots as added directories, never a mode that skips the rule', async () => {
      const cwd = tempDir();
      const agent = createCodexAgent({ dataDir: tempDir(), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }), unattendedVerified: true });
      const env = envOf({ CODEX_API_KEY: KEY });
      const session = await agent.startSession({ cwd, env, sandbox: sandboxOf(cwd) });
      sessions.push(session);
      const events: AgentEvent[] = [];
      session.onEvent((event) => events.push(event));
      await session.prompt('mode');
      expect(replyText(events)).toBe('mode=workspace-write');
      // Core cannot move a build session to another mode.
      expect(session.permissionModes).toEqual(['ask']);
      await expect(session.setPermissionMode!('skip_all')).rejects.toBeInstanceOf(AgentError);
    });

    it('never uses a session that opened in another mode, and stops one that moves itself out of the build mode', async () => {
      const cwd = tempDir();
      const agent = createCodexAgent({ dataDir: tempDir(), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }), unattendedVerified: true });
      // The agent ignored the start mode (here: told to open in Auto review): fail closed, nothing is used.
      const wrong = await agent.startSession({ cwd, env: envOf({ CODEX_API_KEY: KEY, FAKE_ACP_START_MODE: 'agent' }), sandbox: sandboxOf(cwd) }).catch((error: unknown) => error);
      expect(wrong).toMatchObject({ code: 'agent_unavailable' });
      expect(String((wrong as Error).message)).toContain('did not start in the mode a build needs');
      // One that moves itself to Full access during the build is stopped, not trusted.
      const session = await agent.startSession({ cwd, env: envOf({ CODEX_API_KEY: KEY }), sandbox: sandboxOf(cwd) });
      sessions.push(session);
      const events: AgentEvent[] = [];
      session.onEvent((event) => events.push(event));
      await session.prompt('mode-switch agent-full-access').catch(() => undefined);
      expect(events.some((event) => event.type === 'state' && event.state === 'error' && 'fatal' in event && event.fatal === true)).toBe(true);
    });

    it('says in plain words why it builds with you watching, until verified; nothing writable is refused; the key never reaches its config', async () => {
      expect(agentOf().unattendedBuild).toBe(false);
      expect(agentOf().attendedOnlyReason).toBe(CODEX_ATTENDED_ONLY_REASON);
      expect(CODEX_ATTENDED_ONLY_REASON).not.toMatch(/[\u2013\u2014]/);
      const verified = createCodexAgent({ dataDir: tempDir(), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }), unattendedVerified: true });
      expect(verified.unattendedBuild).toBe(true);
      expect(verified.attendedOnlyReason).toBeUndefined();
      // The default is the gate: with it off a start with a sandbox never spawns anything.
      const gate = await agentOf().startSession({ cwd: tempDir(), env: envOf({ CODEX_API_KEY: KEY }), sandbox: sandboxOf(tempDir()) }).catch((error: unknown) => error);
      expect(gate).toMatchObject({ code: 'agent_unavailable' });
      const cwd = tempDir();
      const empty = await verified.startSession({ cwd, env: envOf({ CODEX_API_KEY: KEY }), sandbox: { kind: 'test', writableRoots: [], deniedPaths: [], deniedReads: [], allowedReads: [] } }).catch((error: unknown) => error);
      expect(empty).toMatchObject({ code: 'agent_unavailable' });
      // A build start leaves Codex's own config exactly as the chat's: ephemeral credentials, plugins off, no key, no looser mode.
      const env = envOf({ CODEX_API_KEY: KEY });
      const session = await verified.startSession({ cwd, env, sandbox: sandboxOf(cwd) });
      sessions.push(session);
      const config = readFileSync(join(env.CODEX_HOME!, 'config.toml'), 'utf8');
      expect(config).toBe(CODEX_CONFIG_TOML);
      expect(config).not.toContain(KEY);
      expect(config).not.toMatch(/sandbox_mode|approval_policy|danger/);
    });
  });
});
