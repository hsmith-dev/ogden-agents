/**
 * The Local model's chat adapter (epic 14, story 14.2), against the fake ACP
 * agent's OpenCode personality (`tests/fixtures/fake-opencode.mjs`) talking to
 * the fake OpenAI-compatible server on loopback (`tests/fixtures/fake-openai-server.mjs`).
 * What Ogden wrote into the config and the environment is what reaches the
 * endpoint. No test runs the real harness, a real model, the real network or
 * the user's own folders.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, type AgentEvent, type AgentPermissionDecision, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { createLocalAgent, localHome, opencodeChatEnv, opencodeConfig, writeOpenCodeConfig, type LocalModel } from '../src/index.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const KEY = 'sk-ogden-test-dummy-key-4d2f81';
const dirs: string[] = [];
const sessions: AgentSession[] = [];
const servers: FakeServer[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-opencode-'));
  dirs.push(dir);
  return dir;
};

async function endpoint(options: Parameters<typeof startFakeServer>[0] = {}) {
  const server = await startFakeServer(options);
  servers.push(server);
  return server;
}

interface Harness {
  dataDir: string;
  env: Record<string, string>;
  agent: ReturnType<typeof createLocalAgent>;
  diagnostics: Array<[string, Record<string, unknown> | undefined]>;
}

/** What the server's wiring does before a chat: a config in the data folder and the variables that point the harness at it. */
function harness(server: FakeServer, options: { key?: boolean; models?: LocalModel[]; model?: string; dataDir?: string } = {}): Harness {
  const dataDir = options.dataDir ?? tempDir();
  const models = options.models ?? [{ id: 'fake-small' }, { id: 'fake-large' }];
  const file = writeOpenCodeConfig(dataDir, opencodeConfig({ baseUrl: `${server.url}/v1`, models, model: options.model ?? models[0]!.id, hasKey: options.key === true }));
  const env = { PATH: process.env.PATH ?? '', ...opencodeChatEnv({ dataDir, configFile: file, key: options.key === true ? KEY : undefined }) };
  const diagnostics: Harness['diagnostics'] = [];
  const agent = createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE] }), onDiagnostic: (message, fields) => diagnostics.push([message, fields]) });
  return { dataDir, env, agent, diagnostics };
}

type Decide = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

async function start(h: Harness, options: { decide?: Decide; cwd?: string } = {}) {
  const session = await h.agent.startSession({ cwd: options.cwd ?? tempDir(), env: h.env, onPermissionRequest: options.decide, permissionMode: 'ask' });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { session, events };
}

const replyText = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');
const say = async (session: AgentSession, events: AgentEvent[], text: string) => {
  events.length = 0;
  await session.prompt(text);
  return replyText(events);
};

/** Every file under `dir` (recursively) whose bytes contain `needle`. */
function filesContaining(dir: string, needle: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const file = join(dir, name);
    try {
      if (statSync(file).isFile() && readFileSync(file).includes(needle)) found.push(name);
    } catch {
      // A file that can't be read can't hold it for us.
    }
  }
  return found;
}

describe("the Local model's chat port (epic 14 story 14.2)", () => {
  it('declares Ask only, fixes the mode at start, has no terminal resume yet, and runs a skill as a slash command', () => {
    const agent = createLocalAgent({ dataDir: '/nowhere' });
    expect(agent.displayName).toBe('Local model');
    expect(agent.permissionModes).toEqual(['ask']);
    expect(agent.modeFixedAtStart).toBe(true);
    expect(agent.terminalResume).toBeUndefined();
    expect(agent.skillInvocation('bmad-help', 'an idea')).toBe('/bmad-help an idea');
  });

  it('streams a reply from the endpoint, with no key and no account, and the endpoint saw only a chat request', async () => {
    const server = await endpoint();
    const h = harness(server);
    const { session, events } = await start(h);
    expect(await say(session, events, 'hello')).toBe('Hello from the fake model.');
    expect(session.fixedPermissionMode).toBe('ask');
    const chats = server.log.filter((entry) => entry.path === '/v1/chat/completions');
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ model: 'fake-small', stream: true, auth: 'none', toolChoice: 'auto' });
    // The harness never asked the server for its models (Ogden wrote the list into the config).
    expect(server.log.filter((entry) => entry.path.endsWith('/models'))).toEqual([]);
  });

  it('lists the models Ogden wrote and switches them live; the next request carries the new model', async () => {
    const server = await endpoint();
    const h = harness(server);
    const { session, events } = await start(h);
    expect(session.models?.available.map((model) => model.id)).toEqual(['ogden/fake-small', 'ogden/fake-large']);
    expect(session.models?.current).toBe('ogden/fake-small');
    await session.setModel!('ogden/fake-large');
    await say(session, events, 'hello');
    expect(server.log.filter((entry) => entry.path === '/v1/chat/completions').map((entry) => entry.model)).toEqual(['fake-large']);
    await expect(session.setModel!('ogden/not-listed')).rejects.toBeInstanceOf(AgentError);
  });

  it('gives the key only as an environment variable: the endpoint accepts it, and it is nowhere on disk', async () => {
    const server = await endpoint({ requireKey: KEY });
    const h = harness(server, { key: true });
    const { session, events } = await start(h);
    expect(await say(session, events, 'hello')).toBe('Hello from the fake model.');
    expect(server.log.filter((entry) => entry.path === '/v1/chat/completions').every((entry) => entry.authMatches === true)).toBe(true);
    // The config only references it; a full search of the data folder finds the key nowhere (not in the config, the harness's own store or its logs).
    expect(JSON.parse(readFileSync(h.env.OPENCODE_CONFIG!, 'utf8')).provider.ogden.options.apiKey).toBe('{env:OGDEN_ENDPOINT_KEY}');
    await session.close();
    expect(filesContaining(h.dataDir, KEY)).toEqual([]);
    // And it is masked in anything the harness prints.
    expect(JSON.stringify(h.diagnostics)).not.toContain(KEY);
  });

  it('is told the endpoint refused the key in the server\'s own words, as an error, not a hang', async () => {
    const server = await endpoint({ requireKey: 'another-key' });
    const h = harness(server, { key: true });
    const { session, events } = await start(h);
    const error = await session.prompt('hello').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect(events.some((event) => event.type === 'state' && event.state === 'error')).toBe(true);
  });

  it('starts the harness with every switch that keeps it on the machine, and in folders inside the data folder', async () => {
    const server = await endpoint();
    const h = harness(server);
    const { session, events } = await start(h);
    const report = JSON.parse(await say(session, events, 'env-report')) as { switches: Record<string, string | null>; folders: Record<string, string | null>; key: string };
    expect(report.switches).toEqual({
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_SHARE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
      OPENCODE_PURE: '1',
      NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9/',
    });
    const home = localHome(h.dataDir);
    expect(report.folders).toMatchObject({ HOME: home.home, USERPROFILE: home.home, XDG_CONFIG_HOME: home.xdg.config, XDG_DATA_HOME: home.xdg.data, XDG_CACHE_HOME: home.xdg.cache, XDG_STATE_HOME: home.xdg.state });
    expect(report.key).toBe('absent');
  });

  it('keeps the harness out of the user\'s own and the project\'s skill folders it should not read', async () => {
    const server = await endpoint();
    const h = harness(server);
    // A skill in the (empty) home's `.claude`, and skills in the project's `.claude` and `.agents` folders.
    mkdirSync(join(localHome(h.dataDir).home, '.claude', 'skills', 'home-skill'), { recursive: true });
    const project = tempDir();
    mkdirSync(join(project, '.claude', 'skills', 'claude-skill'), { recursive: true });
    mkdirSync(join(project, '.agents', 'skills', 'bmad-help'), { recursive: true });
    const { session, events } = await start(h, { cwd: project });
    // Only `.agents/skills` (where BMad's skills go for this agent) is read; `.claude` is switched off, in the project and in the home.
    expect(await say(session, events, 'skills')).toBe('skills=project-agents:bmad-help');
  });

  it('refuses to start the harness when its folders are not Ogden\'s own, and never on the user\'s home', async () => {
    const server = await endpoint();
    const h = harness(server);
    const real = { ...h.env, HOME: '/home/someone', USERPROFILE: '/home/someone' };
    const error = await h.agent.startSession({ cwd: tempDir(), env: real, permissionMode: 'ask' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe('agent_unavailable');
    expect(h.diagnostics.some(([message]) => /folders are not set/.test(message))).toBe(true);
    const { OPENCODE_CONFIG: _config, ...noConfig } = h.env;
    await expect(h.agent.startSession({ cwd: tempDir(), env: noConfig, permissionMode: 'ask' })).rejects.toMatchObject({ code: 'agent_unavailable' });
  });

  it('says it is not set up when the harness is not installed', async () => {
    const dataDir = tempDir();
    const agent = createLocalAgent({ dataDir });
    const env = { PATH: process.env.PATH ?? '', ...opencodeChatEnv({ dataDir, configFile: join(localHome(dataDir).configDir, 'opencode-0123456789abcdef.json') }) };
    const error = await agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).code).toBe('agent_unavailable');
    expect((error as AgentError).message).toMatch(/isn't set up/);
  });

  it('refuses any mode but Ask', async () => {
    const server = await endpoint();
    const { session } = await start(harness(server));
    expect(session.permissionModes).toEqual(['ask']);
    await expect(session.setPermissionMode!('skip_all')).rejects.toBeInstanceOf(AgentError);
    await expect(session.setPermissionMode!('auto')).rejects.toBeInstanceOf(AgentError);
    await session.setPermissionMode!('ask');
  });
});

describe('permission cards, cancel and resume', () => {
  it('holds a shell command until its card is allowed once, then runs it; the harness is only ever sent the once option', async () => {
    const server = await endpoint();
    const requests: AgentPermissionRequest[] = [];
    const { session, events } = await start(harness(server), { decide: async (request) => (requests.push(request), { outcome: 'allow_once' }) });
    const reply = await say(session, events, 'please run echo hi');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ kind: 'execute', command: 'echo hi' });
    // `once`, never the harness's wider `always`.
    expect(reply).toBe('tool said: ran(once): echo hi');
  });

  it('does not run the command after Deny, and the turn goes on', async () => {
    const server = await endpoint();
    const { session, events } = await start(harness(server), { decide: async () => ({ outcome: 'deny' }) });
    const reply = await say(session, events, 'please run echo hi');
    expect(reply).toContain('The user rejected permission');
    expect(reply).not.toContain('ran(');
  });

  it('treats a cancelled card as a Deny', async () => {
    const server = await endpoint();
    const { session, events } = await start(harness(server), { decide: async () => ({ outcome: 'cancelled' }) });
    expect(await say(session, events, 'please run echo hi')).not.toContain('ran(');
  });

  it('declines every request when nothing answers the card', async () => {
    const server = await endpoint();
    const { session, events } = await start(harness(server));
    expect(await say(session, events, 'please run echo hi')).not.toContain('ran(');
  });

  it('stops a turn that is waiting for the first token when cancelled, and takes the next message', async () => {
    const server = await endpoint({ slowMs: 6_000 });
    const { session, events } = await start(harness(server));
    const started = Date.now();
    const turn = session.prompt('SLOW please');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await session.cancel();
    expect((await turn).stopReason).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(await say(session, events, 'hello')).toBe('Hello from the fake model.');
  });

  it('reopens a chat in a new process: resume first, with its history sent to the model again; then load', async () => {
    const server = await endpoint();
    const h = harness(server);
    const first = await start(h);
    expect(await say(first.session, first.events, 'hello')).toBe('Hello from the fake model.');
    const id = first.session.agentSessionId;
    await first.session.close();
    const reopened = await h.agent.reopenSession({ cwd: tempDir(), env: h.env, agentSessionId: id, permissionMode: 'ask' });
    sessions.push(reopened.session);
    expect(reopened.restored).toBe('resumed');
    const events: AgentEvent[] = [];
    reopened.session.onEvent((event) => events.push(event));
    expect(await say(reopened.session, events, 'again')).toBe('Hello from the fake model.');
    // The model got the earlier turn again: user, assistant, user (plus the system prompt).
    const chats = server.log.filter((entry) => entry.path === '/v1/chat/completions');
    expect(chats.at(-1)!.messageCount).toBe(4);
    // A session the harness does not have is opened new, for core to prime from the transcript.
    const gone = await h.agent.reopenSession({ cwd: tempDir(), env: h.env, agentSessionId: 'ses_missing', permissionMode: 'ask' });
    sessions.push(gone.session);
    expect(gone.restored).toBe('new');
  });

  it('keeps its chat history in the data folder, where the privacy statement says it is', async () => {
    const server = await endpoint();
    const h = harness(server);
    const { session, events } = await start(h);
    await say(session, events, 'a very private sentence');
    expect(filesContaining(localHome(h.dataDir).xdg.data, 'a very private sentence')).not.toEqual([]);
    expect(existsSync(join(localHome(h.dataDir).xdg.data, 'opencode'))).toBe(true);
  });

  it('reports a server that cannot be reached as an error state, not a hang', async () => {
    const server = await endpoint();
    const h = harness(server);
    const { session, events } = await start(h);
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const error = await session.prompt('hello').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect(events.some((event) => event.type === 'state' && event.state === 'error')).toBe(true);
  });
});
