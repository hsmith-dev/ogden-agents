/**
 * Antigravity's chat adapter and its entry-5 setup port (epic 6 entry 5),
 * against the fake ACP agent's Antigravity personality
 * (`tests/fixtures/fake-antigravity.mjs`: spike 6.1's mode ids, sign-in
 * methods, permission options and resume). No test runs the real server,
 * reads `~/.gemini` or reaches the network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentDescriptorProblems, agentEnvKeys, AgentError, declaredModes, PROTECTED_PATHS, type AgentEvent, type AgentPermissionDecision, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_DESCRIPTOR,
  ANTIGRAVITY_PINS,
  ANTIGRAVITY_START_TIMEOUT_MS,
  acpReasons,
  createAntigravityAgent,
  createAntigravitySetup,
  GEMINI_API_KEY_PATTERN,
  pinnedServer,
} from '../src/index.js';

const FAKE_ANTIGRAVITY = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-antigravity.mjs');
const KEY = `AIza${'K'.repeat(31)}9876`;
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-agy-'));
  dirs.push(dir);
  return dir;
}

/** An empty file where the pinned server for `platform` is looked for. */
function plant(dataDir: string, platform: string): string {
  const pin = ANTIGRAVITY_PINS.archives[platform as keyof typeof ANTIGRAVITY_PINS.archives]!;
  const folder = join(dataDir, 'agents', 'antigravity', ANTIGRAVITY_PINS.version);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, pin.binary), '');
  return join(folder, pin.binary);
}

/** The environment core would give it: enough to run Node, its home and (when given) its key. */
const envOf = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: process.env.PATH ?? '', GEMINI_HOME: tempDir(), ...extra });

const agentOf = (diagnostics: Array<[string, Record<string, unknown> | undefined]> = []) =>
  createAntigravityAgent({ dataDir: tempDir(), server: () => ({ command: process.execPath, args: [FAKE_ANTIGRAVITY, '--uid='] }), onDiagnostic: (message, fields) => diagnostics.push([message, fields]) });

type Decide = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

async function start(options: { env?: Record<string, string>; decide?: Decide; cwd?: string } = {}) {
  const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
  const agent = agentOf(diagnostics);
  const session = await agent.startSession({ cwd: options.cwd ?? tempDir(), env: envOf({ GEMINI_API_KEY: KEY, ...options.env }), onPermissionRequest: options.decide, protectedPaths: PROTECTED_PATHS });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { agent, session, events, diagnostics };
}

const replyText = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');

describe("Antigravity's descriptor (epic 6 entry 5)", () => {
  it('is sound, declares Ask and Skip all only, and names its key, home, skills and pins', () => {
    expect(agentDescriptorProblems(ANTIGRAVITY_DESCRIPTOR)).toEqual([]);
    expect(ANTIGRAVITY_DESCRIPTOR.agentId).toBe('antigravity');
    expect(declaredModes(ANTIGRAVITY_DESCRIPTOR)).toEqual(['ask', 'skip_all']);
    expect(ANTIGRAVITY_DESCRIPTOR.permissionModes).toEqual({ ask: 'default', skip_all: 'yolo' });
    expect(agentEnvKeys([ANTIGRAVITY_DESCRIPTOR])).toEqual(['GEMINI_API_KEY']);
    expect(ANTIGRAVITY_DESCRIPTOR.homeEnv).toBe('GEMINI_HOME');
    expect(ANTIGRAVITY_DESCRIPTOR.skillsFolder).toBe('.agents/skills');
    expect(ANTIGRAVITY_DESCRIPTOR.install).toMatchObject({ kind: 'archive', version: '1.3.0' });
    // The three platforms spike 6.1 hashed, each with its server and Linux's `--uid=`.
    expect(Object.keys(ANTIGRAVITY_PINS.archives).sort()).toEqual(['darwin-arm64', 'linux-x64', 'win32-x64']);
    expect(ANTIGRAVITY_PINS.archives['linux-x64']).toMatchObject({ binary: 'agy_acp_server.par', args: ['--uid='] });
    expect(ANTIGRAVITY_PINS.archives['win32-x64']).toMatchObject({ binary: 'agy_acp_server.exe', args: [] });
  });

  it('declares the same modes on its chat port, and has no terminal resume (agent_unsupported)', () => {
    const agent = agentOf();
    expect(agent.displayName).toBe('Antigravity');
    expect(agent.permissionModes).toEqual(['ask', 'skip_all']);
    expect(agent.terminalResume).toBeUndefined();
    expect(ANTIGRAVITY_START_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('the pinned server in the data folder', () => {
  it('is found by its version folder and platform, never on PATH', () => {
    const dataDir = tempDir();
    expect(pinnedServer(dataDir, 'linux-x64')).toBeUndefined();
    const binary = plant(dataDir, 'linux-x64');
    expect(pinnedServer(dataDir, 'linux-x64')).toEqual({ command: binary, args: ['--uid='], version: '1.3.0' });
    expect(pinnedServer(dataDir, 'linux-arm64')).toBeUndefined();
  });

  it('refuses to start as not set up when it is not installed', async () => {
    const agent = createAntigravityAgent({ dataDir: tempDir() });
    const failure = await agent.startSession({ cwd: tempDir(), env: envOf() }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentError);
    expect(failure).toMatchObject({ code: 'agent_unavailable', message: acpReasons('Antigravity').notSetUp });
  });
});

describe("Antigravity's chat (fake personality)", () => {
  it('authenticates with its API key before the session, and reaches its own home', async () => {
    const { session, events, diagnostics } = await start();
    await session.prompt('auth');
    expect(replyText(events)).toBe('auth=gemini-api-key key=9876');
    expect(diagnostics).toContainEqual(['authenticated with the agent', { methodId: 'gemini-api-key' }]);
    // Nothing logged carries the key.
    expect(JSON.stringify(diagnostics)).not.toContain(KEY);
  });

  it('without a key, a session it refuses is auth_required', async () => {
    const agent = agentOf();
    const failure = await agent.startSession({ cwd: tempDir(), env: envOf() }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'auth_required', message: acpReasons('Antigravity').signIn });
  });

  it('holds a shell command for its card, with the command from CommandLine, and picks only the once options', async () => {
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
    expect(replyText(events)).toBe('Ran npm test. chose=allow');
    events.length = 0;
    answer = { outcome: 'deny' };
    await session.prompt('permission rm -rf build');
    expect(replyText(events)).toBe('Denied rm -rf build. chose=deny');
  });

  it("answers its workspace-trust question on a card, by the option's kind", async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await start({
      decide: async (request) => {
        asked.push(request);
        return { outcome: 'allow_once' };
      },
    });
    await session.prompt('trust');
    expect(asked[0]).toMatchObject({ title: 'Trust this workspace?', kind: 'other' });
    expect(replyText(events)).toBe('trust=trust');
  });

  it('sets Skip all as yolo (which runs commands without asking), refuses Auto, and reports a switch that asks less', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await start({
      decide: async (request) => {
        asked.push(request);
        return { outcome: 'deny' };
      },
    });
    expect(session.permissionModes).toEqual(['ask', 'skip_all']);
    await expect(session.setPermissionMode!('auto')).rejects.toThrow(acpReasons('Antigravity').noSuchMode);
    await session.setPermissionMode!('skip_all');
    await session.prompt('mode');
    expect(replyText(events)).toBe('mode=yolo');
    events.length = 0;
    await session.prompt('permission ls');
    expect(replyText(events)).toBe('Ran ls.');
    expect(asked).toEqual([]);
    await session.setPermissionMode!('ask');
    events.length = 0;
    await session.prompt('mode-switch auto_edit');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'other', asksLess: true, label: 'Auto Edit' });
    events.length = 0;
    await session.prompt('mode-switch yolo');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'skip_all', asksLess: true, label: 'YOLO' });
    events.length = 0;
    await session.prompt('mode-switch default');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'ask', asksLess: false, label: 'Default' });
  });

  it('reopens its session in a new process with resume, else load, else a new one', async () => {
    const cwd = tempDir();
    const { session } = await start({ cwd });
    const id = session.agentSessionId;
    await session.close();
    const reopen = async (env: Record<string, string>) => {
      const reopened = await agentOf().reopenSession({ cwd, env: envOf({ GEMINI_API_KEY: KEY, ...env }), agentSessionId: id });
      sessions.push(reopened.session);
      return reopened.restored;
    };
    expect(await reopen({})).toBe('resumed');
    expect(await reopen({ FAKE_ACP_REOPEN_FAIL: 'resume' })).toBe('loaded');
    expect(await reopen({ FAKE_ACP_REOPEN_FAIL: 'resume,load' })).toBe('new');
  });

  it('waits out a 17 s start (Windows) without timing out', { timeout: 60_000 }, async () => {
    const started = Date.now();
    const { session, events } = await start({ env: { FAKE_ACP_INIT_DELAY_MS: '17000' } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(17_000);
    await session.prompt('hello');
    expect(replyText(events)).toBe('Hello from the fake agent.');
  });
});

describe("Antigravity's setup port until entry 7", () => {
  it('reads not installed, then installed and signed out, from the data folder only', async () => {
    const dataDir = tempDir();
    const setup = createAntigravitySetup({ dataDir, platform: 'win32-x64' });
    expect(await setup.status()).toMatchObject({ agentId: 'antigravity', install: 'not_installed', version: null, subscription: 'unknown' });
    plant(dataDir, 'win32-x64');
    expect(await setup.status()).toMatchObject({ install: 'installed', version: '1.3.0', auth: 'needs_sign_in', subscription: 'signed_out' });
  });

  it('says why on a platform with no pin', async () => {
    const status = await createAntigravitySetup({ dataDir: tempDir(), platform: 'linux-arm64' }).status();
    expect(status).toMatchObject({ install: 'not_installed', reason: "Antigravity isn't available for this computer's system yet." });
  });

  it('refuses install and Google sign-in in plain words, and takes a Gemini key without the network', async () => {
    const setup = createAntigravitySetup({ dataDir: tempDir() });
    await expect(setup.install(() => {})).rejects.toThrow('Installing Antigravity from Ogden Agents comes in a later version.');
    await expect(setup.signIn()).rejects.toThrow(/Use a Gemini API key/);
    expect(setup.apiKey?.envName).toBe('GEMINI_API_KEY');
    expect(setup.apiKey?.check(KEY)).toBeUndefined();
    expect(setup.apiKey?.check('sk-ant-nope')).toMatch(/starts with AIza/);
    expect(GEMINI_API_KEY_PATTERN.test(KEY)).toBe(true);
    expect(await setup.apiKey?.verify(KEY, new AbortController().signal)).toBe('unchecked');
  });
});
