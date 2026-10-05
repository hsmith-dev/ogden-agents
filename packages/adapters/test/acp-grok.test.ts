/**
 * Grok's chat adapter (epic 12 entry 7), against the fake ACP agent's Grok
 * personality (`tests/fixtures/fake-grok.mjs`: spike 12.2's sign-in methods,
 * the `_meta` modes and resume). No test runs the real Grok, reads `~/.grok`
 * or reaches the network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, PROTECTED_PATHS, type AgentEvent, type AgentPermissionDecision, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import type { PermissionMode } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { acpReasons, createGrokAgent, GROK_ARGS } from '../src/index.js';

const FAKE_GROK = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-grok.mjs');
const KEY = `xai-${'K'.repeat(60)}4321`;
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-grok-'));
  dirs.push(dir);
  return dir;
}

const envOf = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: process.env.PATH ?? '', GROK_HOME: tempDir(), ...extra });

const agentOf = (diagnostics: Array<[string, Record<string, unknown> | undefined]> = []) =>
  createGrokAgent({ dataDir: tempDir(), server: () => ({ command: process.execPath, args: [FAKE_GROK] }), onDiagnostic: (message, fields) => diagnostics.push([message, fields]) });

type Decide = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

async function start(options: { env?: Record<string, string>; decide?: Decide; cwd?: string; permissionMode?: PermissionMode } = {}) {
  const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
  const env = envOf({ XAI_API_KEY: KEY, ...options.env });
  const session = await agentOf(diagnostics).startSession({
    cwd: options.cwd ?? tempDir(),
    env,
    onPermissionRequest: options.decide,
    protectedPaths: PROTECTED_PATHS,
    permissionMode: options.permissionMode ?? 'ask',
  });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { session, events, diagnostics, env };
}

const replyText = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');
const say = async (session: AgentSession, events: AgentEvent[], text: string) => {
  events.length = 0;
  await session.prompt(text);
  return replyText(events);
};

describe("Grok's chat port (epic 12 entry 7)", () => {
  it('declares Ask and Skip all only (never Auto), fixes the mode at start, has no terminal resume, and runs a skill as a slash command', () => {
    const agent = agentOf();
    expect(agent.displayName).toBe('Grok');
    expect(agent.permissionModes).toEqual(['ask', 'skip_all']);
    expect(agent.modeFixedAtStart).toBe(true);
    expect(agent.terminalResume).toBeUndefined();
    expect(agent.skillInvocation('bmad-help')).toBe('/bmad-help');
    expect(agent.skillInvocation('bmad-help', 'an idea')).toBe('/bmad-help an idea');
  });

  it('refuses to start as not set up when it is not installed', async () => {
    const agent = createGrokAgent({ dataDir: tempDir() });
    const failure = await agent.startSession({ cwd: tempDir(), env: envOf(), permissionMode: 'ask' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentError);
    expect(failure).toMatchObject({ code: 'agent_unavailable', message: acpReasons('Grok').notSetUp });
  });

  it('does not start without its own home (it would use ~/.grok)', async () => {
    const failure = await agentOf().startSession({ cwd: tempDir(), env: { PATH: process.env.PATH ?? '', XAI_API_KEY: KEY }, permissionMode: 'ask' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'agent_unavailable', message: acpReasons('Grok').couldNotStart });
  });

  it('authenticates with xai.api_key (never grok.com), never logging the token; its process gets self-update off and folder trust off', async () => {
    const { session, events, diagnostics } = await start();
    expect(await say(session, events, 'auth')).toBe('auth=xai.api_key key=4321');
    expect(diagnostics).toContainEqual(['authenticated with the agent', { methodId: 'xai.api_key' }]);
    expect(JSON.stringify(diagnostics)).not.toContain(KEY);
    expect(await say(session, events, 'env')).toBe('GROK_FOLDER_TRUST=0 GROK_DISABLE_AUTOUPDATER=1 key=4321');
  });

  it('without a token, a session it refuses is auth_required, in words about the token and never a sign-in', async () => {
    const failure = await agentOf().startSession({ cwd: tempDir(), env: envOf(), permissionMode: 'ask' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'auth_required', message: 'Grok needs a valid xAI API access token. Check it in Settings → Agents.' });
  });

  it('gives the chat mode once, in _meta: Ask is explicit, Skip all is yoloMode, and a change is refused', async () => {
    const ask = await start();
    expect(await say(ask.session, ask.events, 'mode')).toBe('mode=ask');
    expect(ask.session.fixedPermissionMode).toBe('ask');
    await expect(ask.session.setPermissionMode!('skip_all')).rejects.toThrow(acpReasons('Grok').couldNotSwitchMode);
    await expect(ask.session.setPermissionMode!('auto')).rejects.toThrow();
    const skip = await start({ permissionMode: 'skip_all' });
    expect(await say(skip.session, skip.events, 'mode')).toBe('mode=skip_all');
    expect(await say(skip.session, skip.events, 'permission rm -rf build')).toBe('Ran rm -rf build.');
  });

  it("a project whose .claude/settings.json says bypassPermissions still gets a card in Ask", async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await start({
      cwd,
      decide: async (request) => {
        asked.push(request);
        return { outcome: 'deny' };
      },
    });
    expect(await say(session, events, 'permission npm test')).toBe('Denied npm test. chose=reject_once');
    expect(asked).toHaveLength(1);
    // The explicit Ask is what reaches Grok, so no project setting can loosen it.
    expect(await say(session, events, 'meta')).toBe('meta={"yoloMode":false,"autoMode":false}');
  });

  it('holds a shell command for its card, Allow once and Deny pick the once and reject_once options, never an always one', async () => {
    const asked: AgentPermissionRequest[] = [];
    let answer: AgentPermissionDecision = { outcome: 'allow_once' };
    const { session, events } = await start({
      decide: async (request) => {
        asked.push(request);
        return answer;
      },
    });
    expect(await say(session, events, 'permission npm test')).toBe('Ran npm test. chose=allow_once');
    expect(asked[0]).toMatchObject({ kind: 'execute', command: 'npm test', title: 'Run npm test' });
    answer = { outcome: 'deny' };
    expect(await say(session, events, 'permission rm -rf build')).toBe('Denied rm -rf build. chose=reject_once');
  });

  it('reopens in a new process with resume, else load, else a new one, with the mode in _meta each time', async () => {
    const cwd = tempDir();
    const { session } = await start({ cwd });
    const id = session.agentSessionId;
    await session.close();
    const reopen = async (env: Record<string, string>, mode: PermissionMode = 'ask') => {
      const reopened = await agentOf().reopenSession({ cwd, env: envOf({ XAI_API_KEY: KEY, ...env }), agentSessionId: id, permissionMode: mode });
      sessions.push(reopened.session);
      const events: AgentEvent[] = [];
      reopened.session.onEvent((event) => events.push(event));
      return { restored: reopened.restored, mode: await say(reopened.session, events, 'mode'), meta: await say(reopened.session, events, 'meta') };
    };
    expect(await reopen({})).toEqual({ restored: 'resumed', mode: 'mode=ask', meta: 'meta={"yoloMode":false,"autoMode":false}' });
    expect(await reopen({ FAKE_ACP_REOPEN_FAIL: 'resume' }, 'skip_all')).toEqual({ restored: 'loaded', mode: 'mode=skip_all', meta: 'meta={"yoloMode":true}' });
    expect((await reopen({ FAKE_ACP_REOPEN_FAIL: 'resume,load' })).restored).toBe('new');
  });

  it("core's environment wins over what launch adds, and the real binary runs as agent --no-leader stdio", async () => {
    const { session, events } = await start({ env: { GROK_FOLDER_TRUST: '1' } });
    expect(await say(session, events, 'env')).toContain('GROK_FOLDER_TRUST=1');
    expect(GROK_ARGS).toEqual(['agent', '--no-leader', 'stdio']);
  });

  it('sees BMad skills in .claude/skills only because its own folder trust is off', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, '.claude', 'skills', 'bmad-spec'), { recursive: true });
    const { session, events } = await start({ cwd });
    expect(await say(session, events, 'skills')).toBe('skills=bmad-spec');
  });

  it('says a usage limit in words the handoff recognises', async () => {
    const { GROK_DESCRIPTOR } = await import('../src/index.js');
    const limit = (text: string) => GROK_DESCRIPTOR.usageLimitPatterns!.some((pattern) => pattern.test(text));
    expect(limit('You have exhausted your credits')).toBe(true);
    expect(limit('network error')).toBe(false);
  });
});
