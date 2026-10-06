/**
 * The cross-agent safety conformance suite (epic 17, entry 4): the same cases
 * for every agent that can build, on a real server with each agent played by
 * its fake personality (Claude Code the fake ACP agent, Codex, Grok and
 * Antigravity their wrappers), real git on a fixture repo and a fixed
 * sandbox. A table row is one agent; a test fails when an agent the server
 * lists as able to build has no row. No test runs a real agent, the real
 * keychain or network, or reads `~/.claude`, `~/.codex`, `~/.grok` or `~/.gemini`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANTIGRAVITY_ATTENDED_ONLY_REASON,
  ANTIGRAVITY_PINS,
  createAntigravityAgent,
  createAntigravitySetup,
  createCodexAgent,
  createFixedSandbox,
  createGrokAgent,
  createMemoryAgentSetup,
  writeInstallRecord,
} from '@ogden-agents/adapters';
import type { AgentSetupPort, TicketStorePort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, BuildAgentsResponse, BuildResponse, ReviewResponse, RunResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { StartOptions } from '../src/start-types.js';
import type { AntigravityPorts } from '../src/antigravity-wiring.js';
import type { CodexPorts } from '../src/codex-wiring.js';
import type { GrokPorts } from '../src/grok-wiring.js';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_WAITING_PLAN, FAKE_BUILD_REPO_FILES } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const fixture = (name: string) => join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', name);
const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));
const KEYS = {
  'claude-code': ['ANTHROPIC_API_KEY', `sk-ant-api03-${'C'.repeat(40)}1234`],
  codex: ['CODEX_API_KEY', `sk-proj-${'S'.repeat(40)}4321`],
  grok: ['XAI_API_KEY', `xai-${'S'.repeat(60)}4321`],
  antigravity: ['GEMINI_API_KEY', `AIza${'K'.repeat(31)}9876`],
} as const;
const ALL_KEY_NAMES: string[] = Object.values(KEYS).map(([name]) => name);

function apiKeySetup(agentId: string, displayName: string, envName: string): AgentSetupPort {
  const base = createMemoryAgentSetup({ agentId, displayName, installed: true, auth: 'needs_sign_in' });
  return { ...base, status: async () => ({ ...(await base.status()), subscription: 'signed_out' }), apiKey: { envName, check: () => undefined, verify: async () => 'ok' } };
}

/** One agent of the table: how the server wires it, its key, what it can do and how its skill is found. */
interface Row {
  id: keyof typeof KEYS;
  /** Its product name: what its own plain reason names. */
  name: string;
  /** The server's options to wire it (none for Claude Code, which is always there). */
  wire(): Partial<StartOptions> | undefined;
  /** Builds unattended here (Codex only when its sandbox is verified, which a test turns on). */
  unattended: boolean;
  /** The folder of the repo where its build skill must be, or `null` when no check applies (the default agent). */
  skillFolder: string | null;
  /** How this agent says it hit its usage limit (the words its descriptor's patterns know). */
  usageText: string;
  /** The skill command prefix. */
  prefix: string;
  /** Whether the agent asks before writing a protected file inside the worktree (Codex in its workspace mode does not, as the real sandbox: the end check is its backstop). */
  asksForProtected: boolean;
}

const PINNED = ANTIGRAVITY_PINS.archives[`${process.platform}-${process.arch}` as keyof typeof ANTIGRAVITY_PINS.archives];

const ROWS: Row[] = [
  { id: 'claude-code', name: 'Claude Code', wire: () => undefined, unattended: true, skillFolder: null, prefix: '/', asksForProtected: true, usageText: 'You have hit your usage limit reached' },
  {
    id: 'codex',
    name: 'Codex',
    wire: () => ({ codex: { agent: createCodexAgent({ dataDir: temp('p-codex-'), server: () => ({ command: process.execPath, args: [fixture('fake-codex.mjs')] }), unattendedVerified: true }), setup: apiKeySetup('codex', 'Codex', 'CODEX_API_KEY') } satisfies CodexPorts }),
    unattended: true,
    skillFolder: '.agents/skills',
    prefix: '$',
    asksForProtected: false,
    usageText: 'You hit your usage limit',
  },
  {
    id: 'grok',
    name: 'Grok',
    wire: () => ({ grok: { agent: createGrokAgent({ dataDir: temp('p-grok-'), server: () => ({ command: process.execPath, args: [fixture('fake-grok.mjs')] }) }), setup: apiKeySetup('grok', 'Grok', 'XAI_API_KEY') } satisfies GrokPorts }),
    unattended: false,
    skillFolder: '.claude/skills',
    prefix: '/',
    asksForProtected: true,
    usageText: 'You have exhausted your credits',
  },
  ...(PINNED === undefined
    ? []
    : ([
        {
          id: 'antigravity',
          name: 'Antigravity',
          wire: () => {
            const dataDir = temp('p-agy-');
            const folder = join(dataDir, 'agents', 'antigravity', ANTIGRAVITY_PINS.version);
            mkdirSync(folder, { recursive: true });
            for (const name of Object.keys(PINNED.files)) writeFileSync(join(folder, name), '');
            writeInstallRecord(folder, { version: ANTIGRAVITY_PINS.version, platform: `${process.platform}-${process.arch}`, reportedVersion: ANTIGRAVITY_PINS.version, files: Object.fromEntries(Object.keys(PINNED.files).map((name) => [name, 0])) });
            return {
              antigravity: {
                agent: createAntigravityAgent({ dataDir, server: () => ({ command: process.execPath, args: [fixture('fake-antigravity.mjs'), '--uid='] }) }),
                setup: createAntigravitySetup({ dataDir, apiKey: { verify: async () => 'ok' } }),
              } satisfies AntigravityPorts,
            };
          },
          unattended: false,
          skillFolder: '.agents/skills',
          prefix: '/',
          asksForProtected: true,
          usageText: 'RESOURCE_EXHAUSTED: quota exceeded',
        },
      ] as Row[])),
];

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setup(row: Row, options: { sandbox?: boolean; env?: Record<string, string>; skill?: boolean; second?: boolean; wiring?: Partial<StartOptions> } = {}) {
  const files: Record<string, string> = { ...FAKE_BUILD_REPO_FILES };
  if (row.skillFolder !== null && options.skill !== false) files[`${row.skillFolder}/bmad-build-auto/SKILL.md`] = '# Build\n';
  const repo = createFakeBmadRepo({ git: true, files, prefix: 'ogden-agents-conf-repo-' });
  removeAfterTest(repo.path);
  const [keyName, key] = KEYS[row.id];
  const server = await startTestServer({
    ...row.wire(),
    ...options.wiring,
    ticketStore: createPlanFileTicketStore([{ ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN }, ...(options.second === true ? [{ ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN }] : [])]) as unknown as TicketStorePort,
    sandbox: createFixedSandbox(options.sandbox === false ? { available: false, reason: 'none here' } : { available: true, kind: 'test' }),
    extraAgentEnv: { [keyName]: key, FAKE_ACP_CHUNK_DELAY_MS: '1', ...options.env },
  });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const build = (body: Record<string, unknown> = {}) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1', agent: row.id, ...body });
  const review = async () => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref: '1.1' }))).json());
  const settled = async () => {
    let last: ReviewResponse | undefined;
    await waitFor(async () => (last = await review()).outcome !== 'running', `the ${row.id} run to end`, 20_000);
    return last!;
  };
  const refusal = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });
  return { repo, server, tab, wsId, build, review, settled, refusal };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Answers the cards of an attended run: the first allowed, every other denied. */
async function answerCards(s: Setup, sessionId: string, count: number) {
  const answered = new Set<string>();
  const pending = () => s.server.core.events.readAfter(0).find((event) => event.streamId === sessionId && event.type === 'permission.requested' && !answered.has(event.payload.requestId));
  for (let asked = 1; asked <= count; asked++) {
    await waitFor(() => pending() !== undefined, 'a permission card', 15_000);
    const card = pending();
    if (card?.type !== 'permission.requested') throw new Error('not a card');
    answered.add(card.payload.requestId);
    expect((await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId: s.wsId, sesId: sessionId, requestId: card.payload.requestId }), { decision: asked === 1 ? 'allow_once' : 'deny' })).status).toBe(204);
  }
}

const dumpFile = () => join(temp('p-dump-'), 'env.txt');
const namesOf = (dump: string) => readFileSync(dump, 'utf8').split('\n').map((line) => line.split('=')[0]!);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

describe.each(ROWS)('every agent that builds: $id', { timeout: 90_000 }, (row) => {
  const [ownKeyName] = KEYS[row.id];

  it('an attended build: a card for each write, the run roots, its own skill syntax, Ask only, and only its own key in its process', async () => {
    const dump = dumpFile();
    const s = await setup(row, { env: { FAKE_ACP_BUILD_ENV_DUMP: dump } });
    const started = await s.build({ mode: 'attended' });
    expect(started.status).toBe(201);
    const { run, session } = BuildResponse.parse(await started.json());
    expect(run).toMatchObject({ agent: row.id, sandbox: 'attended' });
    expect(session.agentId).toBe(row.id);
    await answerCards(s, session.id, 2);
    const ended = await s.settled();
    expect(ended.outcome).toBe('verified');
    // Ask whatever the project default: a build session never takes another mode.
    expect(s.server.core.entities.getSession(session.id)!.permissionMode).toBe('ask');
    const prompt = s.server.core.events.readAfter(0).filter((event) => event.streamId === session.id && event.type === 'session.message_completed' && event.payload.role === 'user');
    expect(JSON.stringify(prompt)).toContain(`${row.prefix === '$' ? '$' : '/'}bmad-build-auto ticket 1.1`);
    const names = namesOf(dump);
    // Claude Code's own key comes from the server's own environment (its sign-in), tested in the 5.7 suite; the others' from the keychain slot here.
    if (row.id !== 'claude-code') expect(names).toContain(ownKeyName);
    // Only that agent's own key: no other agent's key reaches it.
    expect(names.filter((name) => ALL_KEY_NAMES.includes(name) && name !== ownKeyName)).toEqual([]);
    // Its own session mode is one that asks (never full access, Auto or yolo).
    expect(readFileSync(`${dump}.session`, 'utf8')).not.toMatch(/session_mode=(agent-full-access|agent|yolo|auto_edit|bypassPermissions|acceptEdits|auto|skip_all|workspace-write)\b/);
  });

  it('an unattended start: unattended agents build by core\'s rule, the others are refused and offered attended', async () => {
    const s = await setup(row);
    const started = await s.build();
    if (!row.unattended) {
      expect(await s.refusal(started)).toMatchObject({ status: 409, code: 'sandbox_unavailable' });
      expect(s.server.core.entities.listSessions(s.wsId)).toEqual([]);
      return;
    }
    expect(started.status).toBe(201);
    const { session } = BuildResponse.parse(await started.json());
    const ended = await s.settled();
    expect(ended.outcome).toBe('verified');
    // No card was ever asked, and the write outside the worktree was refused.
    const events = s.server.core.events.readAfter(0).filter((event) => event.streamId === session.id);
    expect(events.some((event) => event.type === 'permission.requested')).toBe(false);
    expect(events.some((event) => event.type === 'session.tool_call_updated' && event.payload.toolCallId === 'call-build-escape' && event.payload.status === 'failed')).toBe(true);
    expect(ended.files).toContain('src/built-1.1.txt');
  });

  /** Starts a run the way this agent builds (unattended, else attended with its cards answered: the first allowed, the rest denied). */
  const go = async (s: Setup, cards: number, extra: Record<string, unknown> = {}) => {
    const started = await s.build(row.unattended ? extra : { mode: 'attended', ...extra });
    expect(started.status).toBe(201);
    const { run, session } = BuildResponse.parse(await started.json());
    const answered = row.unattended ? Promise.resolve() : answerCards(s, session.id, cards);
    return { run, session, answered };
  };

  it('a protected file in the worktree never reaches a verified run: refused by the rule or a denied card, or the end check fails the run', async () => {
    const s = await setup(row, { env: { FAKE_ACP_BUILD_PROTECTED: '1' } });
    const { run, session, answered } = await go(s, 3);
    await answered;
    const ended = await s.settled();
    const events = s.server.core.events.readAfter(0).filter((event) => event.streamId === session.id);
    const refused = events.some((event) => event.type === 'session.tool_call_updated' && event.payload.toolCallId === 'call-build-protected' && event.payload.status === 'failed');
    if (row.asksForProtected) {
      // It asked, and the answer (core's rule, or the denied card) refused it: the file is untouched and the run is fine.
      expect(refused).toBe(true);
      expect(ended.outcome).toBe('verified');
      expect(ended.files).not.toContain('AGENTS.md');
      expect(existsSync(join(run.worktreePath!, 'AGENTS.md'))).toBe(false);
    } else {
      // It wrote without asking, so only the end check stands: the run fails and cannot be approved.
      expect(refused).toBe(false);
      expect(ended.outcome).toBe('failed');
      expect(ended.run.reason).toContain("can't be approved");
    }
  });

  it('an agent that builds only attended says so in its own words, naming itself, in the picker', async () => {
    if (row.unattended) return;
    const s = await setup(row);
    const list = BuildAgentsResponse.parse(await (await request(s.server, s.tab, 'GET', apiPath(API_ROUTES.workspaceBuildAgents, { wsId: s.wsId }))).json());
    const mine = list.agents.find((agent) => agent.agentId === row.id)!;
    expect(mine.way).toBe('attended_only');
    expect(mine.reason).toContain(row.name);
    expect(mine.reason).toContain('with you watching');
    expect(mine.reason).not.toMatch(/[\u2013\u2014]/);
  });

  it('with no sandbox on this computer an unattended build is refused for every agent, writing nothing', async () => {
    const s = await setup(row, { sandbox: false });
    expect(await s.refusal(await s.build())).toMatchObject({ status: 409, code: 'sandbox_unavailable' });
    expect(s.server.core.entities.listSessions(s.wsId)).toEqual([]);
    const list = BuildAgentsResponse.parse(await (await request(s.server, s.tab, 'GET', apiPath(API_ROUTES.workspaceBuildAgents, { wsId: s.wsId }))).json());
    expect(list.agents.find((agent) => agent.agentId === row.id)?.way).toBe('attended_only');
  });

  it('a halt maps to its code, and the run ends blocked with the skill\'s words', async () => {
    const s = await setup(row, { env: { FAKE_ACP_BUILD_HALT: 'unclear intent: what should it do?' } });
    const { answered } = await go(s, 2);
    await answered;
    const ended = await s.settled();
    expect(ended.outcome).toBe('blocked');
    expect(ended.run.blockedCode).toBe('unclear_intent');
  });

  it("a rejected key or an expired sign in ends the run blocked in that agent's own words, never retried by itself, and Retry is offered", async () => {
    const s = await setup(row, { env: { FAKE_ACP_BUILD_FAIL: 'auth' } });
    const { run, session } = await go(s, 0);
    const ended = await s.settled();
    expect(ended.outcome).toBe('blocked');
    expect(ended.run.blockedCode).toBe('auth_required');
    // The agent's own plain reason: it names the agent, and says nothing of its raw error.
    expect(ended.run.reason).toContain(row.name);
    expect(ended.run.reason).not.toContain('Authentication required');
    expect(ended.run.reason).not.toMatch(/[\u2013\u2014]/);
    // Asked once, and left for the person: no second prompt goes to the agent by itself.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const prompts = s.server.core.events.readAfter(0).filter((event) => event.streamId === session.id && event.type === 'session.message_completed' && event.payload.role === 'user');
    expect(prompts).toHaveLength(1);
    expect(s.server.core.entities.getRun(run.id)!.outcome).toBe('blocked');
    // Retry is the person's, and is offered.
    const retry = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.runRetry, { wsId: s.wsId, runId: run.id }), {});
    expect(retry.status).toBe(200);
  });

  it('a usage limit ends the run blocked in that agent\'s words, with the limit named', async () => {
    const s = await setup(row, { env: { FAKE_ACP_BUILD_FAIL: 'usage', FAKE_ACP_BUILD_FAIL_TEXT: row.usageText } });
    const { answered } = await go(s, 0);
    await answered;
    const ended = await s.settled();
    expect(ended.outcome).toBe('blocked');
    expect(ended.run.blockedCode).toBe('usage_limit');
    expect(ended.run.reason).toContain(row.name);
    expect(ended.run.reason).toContain('usage limit');
    // In a build the offer is the build's, never the chat's.
    expect(ended.run.reason).toContain('build it again with another agent');
    expect(ended.run.reason).not.toContain('chat');
    expect(ended.run.reason).not.toContain(row.usageText);
  });

  it('Stop ends the run and kills the agent and the command it left running', async () => {
    const pids = join(temp('p-pids-'), 'pids.txt');
    const s = await setup(row, { env: { FAKE_ACP_BUILD_CHILD: pids, FAKE_ACP_BUILD_DELAY_MS: '60000' } });
    const { run, answered } = await go(s, 2);
    await answered;
    await waitFor(async () => existsSync(pids) && readFileSync(pids, 'utf8').trim().split(' ').length === 2, 'the agent to start its command', 15_000);
    const [agentPid, childPid] = readFileSync(pids, 'utf8').trim().split(' ').map(Number) as [number, number];
    expect((await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.runStop, { wsId: s.wsId, runId: run.id }))).status).toBe(200);
    await waitFor(async () => !alive(agentPid) && !alive(childPid), 'the agent and its child to be gone', 10_000);
    expect(RunResponse.parse(await (await request(s.server, s.tab, 'GET', apiPath(API_ROUTES.workspaceRun, { wsId: s.wsId, runId: run.id }))).json()).run.outcome).toBe('stopped');
  });

  it('a build whose skill is not in the project is refused naming it, unless it is the default agent', async () => {
    const s = await setup(row, { skill: false });
    const refused = await s.build({ mode: 'attended' });
    if (row.skillFolder === null) {
      expect(refused.status).toBe(201);
      return;
    }
    const body = await s.refusal(refused);
    expect(body).toMatchObject({ status: 409, code: 'plan_uncommitted' });
    expect(body.message).toContain('bmad-build-auto');
    expect(s.server.core.entities.listSessions(s.wsId)).toEqual([]);
  });
});

describe.skipIf(PINNED === undefined)('Antigravity builds: Ogden never selects Skip all or auto_edit, and every request is a card', { timeout: 90_000 }, () => {
  const row = ROWS.find((each) => each.id === 'antigravity')!;
  const FORBIDDEN = ['yolo', 'auto_edit'];
  const modesAsked = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line !== '') : []);

  it('asks for no mode that approves for you, and shows each request as a card at the ask level that no rule allows', async () => {
    const log = join(temp('p-modes-'), 'modes.log');
    const s = await setup(row, { env: { FAKE_ACP_MODE_LOG: log, FAKE_ACP_BUILD_PROTECTED: '1' } });
    const { session } = BuildResponse.parse(await (await s.build({ mode: 'attended' })).json());
    await answerCards(s, session.id, 3);
    const ended = await s.settled();
    expect(ended.outcome).toBe('verified');
    // It opened in Ask, so nothing had to be asked for at all.
    expect(modesAsked(log)).toEqual([]);
    for (const mode of modesAsked(log)) expect(FORBIDDEN).not.toContain(mode);
    const cards = s.server.core.events.readAfter(0).filter((event) => event.streamId === session.id && event.type === 'permission.requested');
    // The write inside, the one outside and the protected file: three cards, none auto-answered, none with an always allow.
    expect(cards).toHaveLength(3);
    for (const card of cards) if (card.type === 'permission.requested') expect(card.payload).toMatchObject({ cautionLevel: 'ask_every_time', alwaysAllowScope: null });
    expect(ended.files).not.toContain('AGENTS.md');
  });

  it('an Antigravity that starts in auto_edit is put back in Ask, never left approving edits, and its protected-file write is still a card', async () => {
    const log = join(temp('p-modes-'), 'modes.log');
    const s = await setup(row, { env: { FAKE_ACP_MODE_LOG: log, FAKE_ACP_START_MODE: 'auto_edit', FAKE_ACP_BUILD_PROTECTED: '1' } });
    const { session } = BuildResponse.parse(await (await s.build({ mode: 'attended' })).json());
    await answerCards(s, session.id, 3);
    const ended = await s.settled();
    // Core told it Ask (`default`) before the prompt, and never asked for another mode.
    expect(modesAsked(log)).toEqual(['default']);
    expect(ended.files).not.toContain('AGENTS.md');
    expect(s.server.core.entities.getSession(session.id)!.permissionMode).toBe('ask');
  });

  it('the person cannot switch a build session into Skip all either', async () => {
    const s = await setup(row, { env: { FAKE_ACP_BUILD_DELAY_MS: '60000' } });
    const { session } = BuildResponse.parse(await (await s.build({ mode: 'attended' })).json());
    const reply = await request(s.server, s.tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId: s.wsId, sesId: session.id }), { mode: 'skip_all', confirm: true });
    // A build session's mode is read only for everyone: refused as busy, before any Skip all gate.
    expect(reply.status).toBe(409);
    expect(ApiErrorBody.parse(await reply.json()).error.code).toBe('session_busy');
    expect(s.server.core.entities.getSession(session.id)!.permissionMode).toBe('ask');
  });

  it('an unattended Antigravity build is refused whatever the sandbox, with its own reason', async () => {
    const s = await setup(row);
    const refused = await s.refusal(await s.build());
    expect(refused).toMatchObject({ status: 409, code: 'sandbox_unavailable' });
    expect(refused.message).toContain(ANTIGRAVITY_ATTENDED_ONLY_REASON);
  });
});

describe('limits are shared by every agent', () => {
  it('the project limit counts a Claude Code build and a Codex build together: the second waits in the queue', async () => {
    const codex = ROWS.find((row) => row.id === 'codex')!;
    const claude = ROWS.find((row) => row.id === 'claude-code')!;
    const s = await setup(claude, { second: true, wiring: codex.wire() ?? {}, env: { FAKE_ACP_BUILD_DELAY_MS: '60000', CODEX_API_KEY: KEYS.codex[1] } });
    // The Codex skill must be in the project for its build.
    const skill = join(s.repo.path, '.agents', 'skills', 'bmad-build-auto');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '# Build\n');
    const { fixtureGit } = await import('../../../tests/fixtures/fake-bmad-repo.js');
    fixtureGit(s.repo.path, 'add', '-A');
    fixtureGit(s.repo.path, 'commit', '--quiet', '--no-verify', '-m', 'skills');
    expect((await request(s.server, s.tab, 'PATCH', apiPath(API_ROUTES.workspaceBuildSettings, { wsId: s.wsId }), { maxConcurrentRuns: 1 })).status).toBe(200);
    const first = BuildResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1', agent: 'claude-code' })).json());
    expect(first.run.queuePosition).toBeNull();
    const second = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.2', agent: 'codex', mode: 'attended' });
    expect(second.status).toBe(201);
    const queued = BuildResponse.parse(await second.json());
    expect(queued.run.agent).toBe('codex');
    expect(queued.run.queuePosition).toBe(1);
  });
});

describe('after a usage limit, build it again with another agent', () => {
  it('Reject and retry takes the other agent: a fresh run with it, in a new copy, and the first stays rejected', async () => {
    const codex = ROWS.find((row) => row.id === 'codex')!;
    const claude = ROWS.find((row) => row.id === 'claude-code')!;
    const s = await setup(claude, { wiring: codex.wire() ?? {}, env: { FAKE_ACP_BUILD_FAIL: 'usage', FAKE_ACP_BUILD_FAIL_TEXT: claude.usageText, CODEX_API_KEY: KEYS.codex[1] } });
    // The Codex skill must be in the project for its build.
    const skill = join(s.repo.path, '.agents', 'skills', 'bmad-build-auto');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '# Build\n');
    const { fixtureGit } = await import('../../../tests/fixtures/fake-bmad-repo.js');
    fixtureGit(s.repo.path, 'add', '-A');
    fixtureGit(s.repo.path, 'commit', '--quiet', '--no-verify', '-m', 'skills');
    const first = BuildResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1', agent: 'claude-code', mode: 'attended' })).json());
    const blocked = await s.settled();
    expect(blocked.run.blockedCode).toBe('usage_limit');
    // The agent named must be able to build; one that cannot is refused.
    const nobody = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId: s.wsId, ref: '1.1' }), { retry: true, agent: 'grok' });
    expect(nobody.status).toBe(400);
    const again = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId: s.wsId, ref: '1.1' }), { retry: true, agent: 'codex' });
    expect(again.status).toBe(200);
    const runs = s.server.core.entities.listRuns(s.wsId).filter((run) => run.ticketRef === '1.1');
    expect(runs.map((run) => [run.agent, run.decision])).toEqual(expect.arrayContaining([['claude-code', 'rejected'], ['codex', null]]));
    expect(runs.find((run) => run.agent === 'codex')!.worktreePath).not.toBe(first.run.worktreePath);
  });
});

describe('building again from an unattended run with an agent that builds with you watching', () => {
  it('names the mode: Codex is built again attended, though the first run was unattended, and never unattended', async () => {
    const claude = ROWS.find((row) => row.id === 'claude-code')!;
    // Codex as it ships: its own sandbox is not verified yet.
    const codex = { codex: { agent: createCodexAgent({ dataDir: temp('p-codex-'), server: () => ({ command: process.execPath, args: [fixture('fake-codex.mjs')] }) }), setup: apiKeySetup('codex', 'Codex', 'CODEX_API_KEY') } satisfies CodexPorts };
    const s = await setup(claude, { wiring: codex, env: { FAKE_ACP_BUILD_FAIL: 'usage', FAKE_ACP_BUILD_FAIL_TEXT: claude.usageText, CODEX_API_KEY: KEYS.codex[1] } });
    const skill = join(s.repo.path, '.agents', 'skills', 'bmad-build-auto');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '# Build\n');
    const { fixtureGit } = await import('../../../tests/fixtures/fake-bmad-repo.js');
    fixtureGit(s.repo.path, 'add', '-A');
    fixtureGit(s.repo.path, 'commit', '--quiet', '--no-verify', '-m', 'skills');
    expect((await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1', agent: 'claude-code' })).status).toBe(201);
    expect((await s.settled()).run.blockedCode).toBe('usage_limit');
    const reject = (body: unknown) => request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId: s.wsId, ref: '1.1' }), body);
    // Unattended Codex is refused before anything is discarded.
    expect((await reject({ retry: true, agent: 'codex' })).status).toBe(409);
    expect(s.server.core.entities.listRuns(s.wsId).filter((run) => run.ticketRef === '1.1').map((run) => run.decision)).toEqual([null]);
    // With you watching it is built, in a fresh run.
    expect((await reject({ retry: true, agent: 'codex', mode: 'attended' })).status).toBe(200);
    const runs = s.server.core.entities.listRuns(s.wsId).filter((run) => run.ticketRef === '1.1');
    expect(runs.find((run) => run.agent === 'codex')).toMatchObject({ sandbox: 'attended' });
  });
});

describe('building again unattended with no sandbox changes nothing', () => {
  it('an attended run asked to be built again unattended, with no sandbox here, is refused before anything is discarded', async () => {
    const claude = ROWS.find((row) => row.id === 'claude-code')!;
    const s = await setup(claude, { sandbox: false, env: { FAKE_ACP_BUILD_FAIL: 'usage', FAKE_ACP_BUILD_FAIL_TEXT: claude.usageText } });
    const first = BuildResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1', mode: 'attended' })).json());
    expect((await s.settled()).run.blockedCode).toBe('usage_limit');
    const again = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId: s.wsId, ref: '1.1' }), { retry: true, mode: 'unattended' });
    expect(again.status).toBe(409);
    expect(s.server.core.entities.getRun(first.run.id)).toMatchObject({ outcome: 'blocked', decision: null });
    expect(existsSync(first.run.worktreePath!)).toBe(true);
  });
});

describe('building again with another agent that cannot build changes nothing', () => {
  it('a skill that is not in the project refuses it before anything is discarded: the blocked run, its copy and its work stay', async () => {
    const codex = ROWS.find((row) => row.id === 'codex')!;
    const claude = ROWS.find((row) => row.id === 'claude-code')!;
    // No Codex skill in this project.
    const s = await setup(claude, { wiring: codex.wire() ?? {}, env: { FAKE_ACP_BUILD_FAIL: 'usage', FAKE_ACP_BUILD_FAIL_TEXT: claude.usageText, CODEX_API_KEY: KEYS.codex[1] } });
    const first = BuildResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: s.wsId }), { ref: '1.1', agent: 'claude-code', mode: 'attended' })).json());
    expect((await s.settled()).run.blockedCode).toBe('usage_limit');
    const again = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId: s.wsId, ref: '1.1' }), { retry: true, agent: 'codex' });
    expect(again.status).toBe(409);
    expect(JSON.stringify(await again.json())).toContain('bmad-build-auto');
    const kept = s.server.core.entities.getRun(first.run.id)!;
    expect(kept).toMatchObject({ outcome: 'blocked', decision: null });
    expect(existsSync(first.run.worktreePath!)).toBe(true);
  });
});

describe('the table is complete', () => {
  it('every agent a server lists as able to build has a row here', async () => {
    const wired = Object.assign({}, ...ROWS.map((row) => row.wire() ?? {}));
    const server = await startTestServer({ ...wired, sandbox: createFixedSandbox({ available: true, kind: 'test' }) });
    const tab = await signIn(server);
    const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_REPO_FILES, prefix: 'ogden-agents-conf-repo-' });
    removeAfterTest(repo.path);
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    const list = BuildAgentsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuildAgents, { wsId }))).json());
    expect(list.agents.map((agent) => agent.agentId).sort()).toEqual(ROWS.map((row) => row.id).sort());
  });
});
