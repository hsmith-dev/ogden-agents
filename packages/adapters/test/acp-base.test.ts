/**
 * The shared ACP client (`acp-base`, 6.4) as a second agent would use it:
 * only a descriptor and quirks, nothing of Claude Code's. The fake ACP agent
 * (`tests/fixtures/fake-acp-agent.mjs`) plays that agent with its own mode
 * ids. No test runs a real agent or touches an account.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, PROTECTED_PATHS, type AgentDescriptor, type AgentEvent, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { acpReasons, createAcpAgent, slashSkillInvocation, type AcpAgentQuirks } from '../src/acp-base/index.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-acp-base-'));
  dirs.push(dir);
  return dir;
}

/** A second agent, as data: Ask and Skip all under its own mode ids. */
const SECOND: AgentDescriptor = {
  agentId: 'second-agent',
  displayName: 'Second Agent',
  provider: 'Second Provider',
  install: { kind: 'npm', package: '@second/agent', version: '1.0.0' },
  signInMethods: [{ id: 'second-login', kind: 'subscription', label: 'Sign in' }],
  permissionModes: { ask: 'careful', skip_all: 'yolo' },
  needsProjectTrust: false,
  skillsFolder: '.second/skills',
};

/** The environment it gets: enough to run Node, its modes, and its name for `whoami`. */
const baseEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: process.env.PATH ?? '',
  FAKE_ACP_MODES: 'careful:Careful,edits:Accept edits,yolo:Yolo',
  FAKE_ACP_START_MODE: 'careful',
  FAKE_ACP_AGENT_NAME: 'second-agent',
  ...extra,
});

function secondAgent(quirks: Partial<AcpAgentQuirks> = {}, diagnostics: Array<[string, Record<string, unknown> | undefined]> = []) {
  return createAcpAgent(
    SECOND,
    {
      launch: () => ({ command: process.execPath, args: [FAKE_AGENT], logFields: { program: 'fake' } }),
      toolInputPaths: { pathFields: ['target'], patternFields: [] },
      askingModeIds: ['careful'],
      skillInvocation: slashSkillInvocation,
      ...quirks,
    },
    { onDiagnostic: (message, fields) => diagnostics.push([message, fields]) },
  );
}

async function start(options: { quirks?: Partial<AcpAgentQuirks>; env?: Record<string, string>; onPermissionRequest?: (request: AgentPermissionRequest) => Promise<{ outcome: 'allow_once' } | { outcome: 'deny' }> } = {}) {
  const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
  const agent = secondAgent(options.quirks, diagnostics);
  const session = await agent.startSession({ cwd: tempDir(), env: baseEnv(options.env), onPermissionRequest: options.onPermissionRequest, protectedPaths: PROTECTED_PATHS });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { agent, session, events, diagnostics };
}

const replyText = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');

/** Whether a process with this pid exists. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const until = async (predicate: () => boolean, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('the shared ACP client with a second agent (6.4)', () => {
  it('is named and moded by its descriptor, streams a reply, and reaches its own process', async () => {
    const { agent, session, events, diagnostics } = await start();
    expect(agent.displayName).toBe('Second Agent');
    expect(agent.permissionModes).toEqual(['ask', 'skip_all']);
    expect(agent.terminalResume).toBeUndefined();
    expect(session.permissionModes).toEqual(['ask', 'skip_all']);
    await session.prompt('whoami');
    expect(replyText(events)).toBe('agent=second-agent');
    expect(events[0]).toEqual({ type: 'state', state: 'working' });
    expect(events.at(-1)).toEqual({ type: 'state', state: 'idle' });
    expect(diagnostics).toContainEqual(['starting the Second Agent adapter', { program: 'fake' }]);
  });

  it('sets modes with its own ids, and maps its own mode reports', async () => {
    const { session, events } = await start();
    await session.setPermissionMode!('skip_all');
    await session.prompt('mode');
    expect(replyText(events)).toBe('mode=yolo');
    await expect(session.setPermissionMode!('auto')).rejects.toThrow(acpReasons('Second Agent').noSuchMode);
    events.length = 0;
    await session.prompt('mode-switch edits');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'other', asksLess: true, label: 'Accept edits' });
    events.length = 0;
    await session.prompt('mode-switch careful');
    expect(events).toContainEqual({ type: 'permission_mode', mode: 'ask', asksLess: false, label: 'Careful' });
  });

  it('asks core about a permission with its own path fields, and allow_once runs the call', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await start({ onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
    await session.prompt('permission');
    expect(asked).toEqual([{ toolCallId: 'call-permission', title: 'Run npm test', kind: 'execute', command: 'npm test', paths: [] }]);
    expect(replyText(events)).toBe('Ran npm test.');
  });

  it('a request offering neither allow_once nor reject_once is cancelled and logged, and core is never asked', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events, diagnostics } = await start({ onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
    await session.prompt('permission-always-only');
    expect(replyText(events)).toBe('chose=cancelled');
    expect(asked).toEqual([]);
    expect(diagnostics).toContainEqual(['the agent offered neither allow_once nor reject_once; cancelling the request', { optionKinds: ['allow_always'] }]);
  });

  it('without a sessionMeta quirk its sessions carry no _meta and do not protect paths', async () => {
    const { session, events } = await start();
    expect(session.protectsPaths).toBe(false);
    await session.prompt('session-start');
    expect(JSON.parse(replyText(events)).meta).toBeNull();
  });

  it('with one, its sessions carry the quirk’s _meta and protect paths', async () => {
    const { session, events } = await start({ quirks: { sessionMeta: (paths) => ({ secondAgent: { guarded: paths.folders.length } }) } });
    expect(session.protectsPaths).toBe(true);
    await session.prompt('session-start');
    expect(JSON.parse(replyText(events)).meta).toEqual({ secondAgent: { guarded: PROTECTED_PATHS.folders.length } });
  });

  it('reopens by resume, then load, then new', async () => {
    const agent = secondAgent();
    for (const [mode, expected] of [['resume', 'resumed'], ['load', 'loaded'], ['none', 'new']] as const) {
      const opened = await agent.reopenSession({ cwd: tempDir(), env: baseEnv({ FAKE_ACP_RESUME: mode }), agentSessionId: 'fake-session-earlier' });
      sessions.push(opened.session);
      expect(opened.restored).toBe(expected);
    }
  });

  it('a launch quirk that refuses is agent_unavailable with its plain reason', async () => {
    const agent = secondAgent({
      launch: () => {
        throw new AgentError('agent_unavailable', acpReasons('Second Agent').notSetUp);
      },
    });
    await expect(agent.startSession({ cwd: tempDir(), env: baseEnv() })).rejects.toMatchObject({ code: 'agent_unavailable', message: "Second Agent isn't set up for Ogden Agents on this computer yet." });
  });

  it('a launch that fails any other way is agent_unavailable too, its reason masked', async () => {
    const agent = secondAgent({
      launch: () => {
        throw new Error('probe failed near sk-secret-value');
      },
    });
    const failure = agent.startSession({ cwd: tempDir(), env: baseEnv({ SECOND_API_KEY: 'sk-secret-value' }) });
    await expect(failure).rejects.toMatchObject({ code: 'agent_unavailable', message: "Second Agent couldn't start. Try again." });
    await expect(failure.catch((error: AgentError) => JSON.stringify(error.details))).resolves.not.toContain('sk-secret-value');
  });

  it("a launch adds variables but never drops or changes core's", async () => {
    const { session, events } = await start({
      quirks: { launch: () => ({ command: process.execPath, args: [FAKE_AGENT], addEnv: { SECOND_ADDED: 'yes', FAKE_ACP_AGENT_NAME: 'overridden' } }) },
    });
    await session.prompt('session-start');
    const { env } = JSON.parse(replyText(events)) as { env: Record<string, string> };
    expect(env.SECOND_ADDED).toBe('yes');
    expect(env.FAKE_ACP_AGENT_NAME).toBe('second-agent');
  });

  it('cancel ends a running prompt; close stops its whole process tree', async () => {
    const { session, events } = await start({ env: { FAKE_ACP_SPAWN_GRANDCHILD: '1' } });
    const turn = session.prompt('slow');
    await until(() => events.some((e) => e.type === 'message_chunk'), 'the first chunk');
    await session.cancel();
    await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
    events.length = 0;
    await session.prompt('pids');
    const [, pid, grandchild] = /pid=(\d+) grandchild=(\d+)/.exec(replyText(events)) ?? [];
    await session.close();
    await until(() => !alive(Number(pid)) && !alive(Number(grandchild)), 'the agent and its child to exit');
  });

  it('lists its sign-in methods through initialize', async () => {
    const methods = await secondAgent().listAuthMethods({ env: baseEnv({ FAKE_ACP_AUTH_METHODS: 'second-login:Sign in' }) });
    expect(methods).toEqual([expect.objectContaining({ id: 'second-login', name: 'Sign in', kind: 'agent' })]);
  });
});

describe('skill invocation (story 4.1 on the shared client)', () => {
  it("is the adapter's own syntax, passed through unchanged", () => {
    expect(slashSkillInvocation('bmad-prd')).toBe('/bmad-prd');
    expect(slashSkillInvocation('bmad-prd', 'a habit tracker')).toBe('/bmad-prd a habit tracker');
    expect(secondAgent({ skillInvocation: (skill) => `run ${skill}` }).skillInvocation('bmad-prd')).toBe('run bmad-prd');
  });
});
