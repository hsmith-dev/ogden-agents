/**
 * The failures a model server has, in plain words, and Ogden's own watch over
 * a running chat (epic 14 story 14.6; E14-R4), against the fake OpenCode and
 * the fake OpenAI-compatible server. A stopped server is said at once and not
 * waited out (the real harness would retry for 63 to 66 seconds), a slow
 * first token is never cut off, and the harness's own text is never shown.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, type AgentEvent, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { createLocalAgent, FAILURE_WORDS, localFailureWords, opencodeChatEnv, opencodeConfig, writeOpenCodeConfig } from '../src/index.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];
const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('the words for a failed turn', () => {
  it('does not mistake an unrelated number or a plain word for a refused key or a timeout, and puts a refused key before the rest', () => {
    expect(localFailureWords('Internal error at line 401 of the request')).toBeUndefined();
    expect(localFailureWords('port 4010 had a timeout setting')).toBeUndefined();
    expect(localFailureWords('HTTP status 401: invalid api key for model x not found in list')).toBe(FAILURE_WORDS.keyRefused);
  });

  it.each([
    ['Cannot connect to API: Unable to connect. Is the computer able to access the url?', FAILURE_WORDS.notRunning],
    ['Session too large to compact - context exceeds model limit', FAILURE_WORDS.contextFull],
    ["This model's maximum context length is 4096 tokens", FAILURE_WORDS.contextFull],
    ["model 'qwen' not found", FAILURE_WORDS.modelGone],
    ['The model is not loaded', FAILURE_WORDS.modelGone],
    ['Request timed out', FAILURE_WORDS.timedOut],
    ['HTTP 401 invalid api key', FAILURE_WORDS.keyRefused],
    ['bad key', FAILURE_WORDS.keyRefused],
  ])('%s', (text, words) => {
    expect(localFailureWords(`Internal error\n${text}`)).toBe(words);
  });

  it('says nothing about what it does not recognise, so the harness text is never shown, and has no dash', () => {
    expect(localFailureWords('something odd with a secret sk-123 in it')).toBeUndefined();
    expect(Object.values(FAILURE_WORDS).join(' ')).not.toMatch(/—|–/);
  });
});

async function start(options: { server?: FakeServer; serverOptions?: Parameters<typeof startFakeServer>[0]; env?: Record<string, string>; key?: string; intervalMs?: number } = {}) {
  const fake = options.server ?? (await startFakeServer(options.serverOptions));
  if (options.server === undefined) servers.push(fake);
  const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-failures-'));
  dirs.push(dataDir);
  const file = writeOpenCodeConfig(dataDir, opencodeConfig({ baseUrl: `${fake.url}/v1`, models: [{ id: 'fake-small' }], model: 'fake-small', hasKey: options.key !== undefined }));
  const env = { PATH: process.env.PATH ?? '', ...opencodeChatEnv({ dataDir, configFile: file, key: options.key, baseUrl: `${fake.url}/v1` }) };
  const agent = createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE], env: options.env }), watch: { intervalMs: options.intervalMs ?? 100, misses: 2 } });
  const session = await agent.startSession({ cwd: dataDir, env, permissionMode: 'ask' });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { fake, session, events, agent, env, dataDir };
}

const errorOf = (events: AgentEvent[]) => events.flatMap((event) => (event.type === 'state' && event.state === 'error' ? [event.reason] : []));

describe('a turn that fails, in plain words (each against a fake server mode)', () => {
  it('a full context says so', async () => {
    const { session, events } = await start();
    const error = await session.prompt('CTXFULL please').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).message).toBe(FAILURE_WORDS.contextFull);
    expect(errorOf(events)).toEqual([FAILURE_WORDS.contextFull]);
  });

  it('a model the server does not have says so, and the session stays usable', async () => {
    const { session } = await start();
    const error = await session.prompt('NOTFOUND please').catch((e: unknown) => e);
    expect((error as AgentError).message).toBe(FAILURE_WORDS.modelGone);
    expect((await session.prompt('hello')).stopReason).toBe('end_turn');
  });

  it('a refused key says so', async () => {
    const { session } = await start({ serverOptions: { requireKey: 'the-real-key' }, key: 'a-wrong-key' });
    const error = await session.prompt('hello').catch((e: unknown) => e);
    expect((error as AgentError).message).toBe(FAILURE_WORDS.keyRefused);
  });

  it('a server that is not running is said at once, before the message is sent', async () => {
    const { fake, session } = await start();
    await fake.close();
    servers.splice(servers.indexOf(fake), 1);
    const started = Date.now();
    const error = await session.prompt('hello').catch((e: unknown) => e);
    expect((error as AgentError).message).toBe(FAILURE_WORDS.notRunning);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('a server killed in the middle of a reply is said within seconds, not after the harness retries for a minute', async () => {
    // The fake harness waits 60 s to give up on a dead server, as the real one retries for 63 to 66 s.
    const { fake, session } = await start({ serverOptions: { slowMs: 30_000 }, env: { FAKE_OPENCODE_CONNECT_DELAY_MS: '60000' } });
    const started = Date.now();
    const turn = session.prompt('SLOW please').catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await fake.close();
    servers.splice(servers.indexOf(fake), 1);
    const error = await turn;
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).message).toBe(FAILURE_WORDS.notRunning);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it('a slow first token (a model still loading) is never cut off while the server answers', async () => {
    const { session, events } = await start({ serverOptions: { slowMs: 1_500 } });
    expect((await session.prompt('SLOW please')).stopReason).toBe('end_turn');
    expect(events.filter((event) => event.type === 'message_chunk').length).toBeGreaterThan(0);
    expect(errorOf(events)).toEqual([]);
  });

  it('never cuts off a server that is busy and slow to answer the look, while it still answers the chat', { timeout: 20_000 }, async () => {
    const { session, events } = await start({ serverOptions: { slowMs: 2_500, modelsDelayMs: 600 } });
    // Each look takes 600 ms and the first token 2.5 s: slow, but running.
    expect((await session.prompt('SLOW please')).stopReason).toBe('end_turn');
    expect(errorOf(events)).toEqual([]);
  });

  it('a message sent right after a stopped-server error is its own turn: no late event from the old one disturbs it', async () => {
    const { fake, session, events } = await start({ serverOptions: { slowMs: 30_000 }, env: { FAKE_OPENCODE_CONNECT_DELAY_MS: '60000' } });
    const turn = session.prompt('SLOW please').catch((e: unknown) => e);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const port = fake.port;
    await fake.close();
    servers.splice(servers.indexOf(fake), 1);
    expect(((await turn) as AgentError).message).toBe(FAILURE_WORDS.notRunning);
    const back = await startFakeServer({ port });
    servers.push(back);
    events.length = 0;
    expect((await session.prompt('hello')).stopReason).toBe('end_turn');
    expect(events.filter((event) => event.type === 'message_chunk').map((event) => (event as { text: string }).text).join('')).toBe('Hello from the fake model.');
    // After the new turn ended, nothing else arrives.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events.at(-1)).toMatchObject({ type: 'state', state: 'idle' });
  });

  it('the wrapped session still lists its models and modes, switches models, cancels and closes', async () => {
    const { session } = await start();
    expect(session.permissionModes).toEqual(['ask']);
    expect(session.fixedPermissionMode).toBe('ask');
    expect(session.models?.available.map((model) => model.id)).toEqual(['ogden/fake-small']);
    const turn = session.prompt('hello');
    expect((await turn).stopReason).toBe('end_turn');
    await session.cancel();
    await session.close();
  });

  it('does not look at the endpoint when no address was given (an old environment)', async () => {
    const { fake, agent, env, dataDir } = await start();
    const { OGDEN_ENDPOINT_URL: _url, ...bare } = env as Record<string, string>;
    const session = await agent.startSession({ cwd: dataDir, env: bare, permissionMode: 'ask' });
    sessions.push(session);
    const before = fake.log.length;
    await session.prompt('hello');
    expect(fake.log.slice(before).filter((entry) => entry.path.endsWith('/models'))).toEqual([]);
  });

  it('looks at the endpoint only while a turn runs, and stops when it ends', async () => {
    const { fake, session } = await start({ intervalMs: 50 });
    await session.prompt('hello');
    // A look already on its way may still land: give it a moment, then nothing more may come.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = fake.log.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.log.length).toBe(after);
  });
});
