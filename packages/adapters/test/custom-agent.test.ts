/**
 * A custom ACP agent (epic 21, story 21.1): its descriptor, and its launch,
 * which resolves the user's command line at every start, against the fake ACP
 * agent run under this Node.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentDescriptorProblems, AgentError, createAgentRegistry, type AgentEvent, type AgentPermissionDecision, type AgentPermissionRequest, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createCustomAgent, CUSTOM_AGENT_LOCAL_ONLY_REASON, customAgentDescriptor, neverAsksMode, probeCustomAgent, splitCommandLine } from '../src/index.js';
import { customAgentTestLines, joinCommandLine } from '@ogden-agents/shared';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-custom-'));
  dirs.push(dir);
  return dir;
};

const descriptor = customAgentDescriptor({ agentId: 'custom-my-agent', displayName: 'My Agent' });
const env = { PATH: process.env.PATH ?? '' };

describe('a custom ACP agent (epic 21 story 21.1)', () => {
  it('is described soundly: no pin, no account, Ask only and fixed, a trusted project, `.agents/skills`', () => {
    expect(agentDescriptorProblems(descriptor)).toEqual([]);
    expect(descriptor).toMatchObject({ install: { kind: 'user' }, signInMethods: [], noAccount: true, permissionModes: { ask: 'ask' }, modeFixedAtStart: true, needsProjectTrust: true, skillsFolder: '.agents/skills' });
    const agent = createCustomAgent({ descriptor, commandLine: 'anything' });
    expect(agent.displayName).toBe('My Agent');
    expect(agent.permissionModes).toEqual(['ask']);
    expect(agent.modeFixedAtStart).toBe(true);
    expect(agent.unattendedBuild).toBe(false);
    expect(agent.skillInvocation('bmad-help', 'an idea')).toBe('/bmad-help an idea');
    expect(() => createAgentRegistry([{ descriptor, agent }])).not.toThrow();
  });

  it('runs only on this computer (27.5): its port carries the local only reason core refuses a remote chat with', () => {
    expect(createCustomAgent({ descriptor, commandLine: 'anything' }).localOnlyReason).toBe(CUSTOM_AGENT_LOCAL_ONLY_REASON);
    expect(CUSTOM_AGENT_LOCAL_ONLY_REASON).not.toMatch(/[\u2013\u2014]/);
  });

  it('resolves an absolute command at start and streams a reply', async () => {
    const agent = createCustomAgent({ descriptor, commandLine: `"${process.execPath}" "${FAKE_AGENT}"` });
    const session = await agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' });
    sessions.push(session);
    expect(session.fixedPermissionMode).toBe('ask');
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('hi');
    expect(events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('')).toBe('Hello from the fake agent.');
  });

  it('fails a start `agent_unavailable` in plain words when the command is missing, and resolves it again at each start', async () => {
    const missing = createCustomAgent({ descriptor, commandLine: 'ogden-no-such-agent-command --acp' });
    const error = await missing.startSession({ cwd: tempDir(), env, permissionMode: 'ask' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: 'agent_unavailable', message: expect.stringContaining('ogden-no-such-agent-command') });

    // A link to Node (a copy on Windows, where links need privileges) that goes away after the first start: the second start finds it gone.
    const node = join(tempDir(), process.platform === 'win32' ? 'node.exe' : 'node');
    if (process.platform === 'win32') copyFileSync(process.execPath, node);
    else symlinkSync(process.execPath, node);
    const agent = createCustomAgent({ descriptor, commandLine: `"${node}" "${FAKE_AGENT}"` });
    const first = await agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' });
    await first.close();
    rmSync(node, { force: true, maxRetries: 10, retryDelay: 200 });
    await expect(agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' })).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
});

describe('Test: start a custom agent once and read what it advertises (story 21.3)', () => {
  const command = `"${process.execPath}" "${FAKE_AGENT}"`;

  it("reports the fake agent's default answer: its name, no resume, text only", async () => {
    const advertised = await probeCustomAgent({ displayName: 'My Agent', commandLine: command, env });
    expect(advertised).toEqual({ name: 'fake-acp-agent', version: '1.0.0', resume: false, load: false, image: false, audio: false, embeddedContext: false });
    expect(customAgentTestLines(advertised)).toEqual([
      'It started and says it is fake-acp-agent 1.0.0.',
      "It can't reopen a chat itself. Ogden shows the saved conversation instead.",
      'Messages to it are text only.',
    ]);
  });

  it('reports resume, load and prompt capabilities when it advertises them', async () => {
    const resumes = await probeCustomAgent({ displayName: 'My Agent', commandLine: command, env: { ...env, FAKE_ACP_RESUME: 'resume', FAKE_ACP_PROMPT_CAPS: 'image,embeddedContext' } });
    expect(resumes).toMatchObject({ resume: true, load: false, image: true, audio: false, embeddedContext: true });
    expect(customAgentTestLines(resumes).slice(1)).toEqual(['It can pick a chat up where it left off.', 'Messages to it can include images and file contents.']);
    expect(await probeCustomAgent({ displayName: 'My Agent', commandLine: command, env: { ...env, FAKE_ACP_RESUME: 'load' } })).toMatchObject({ resume: false, load: true });
  });

  it('fails agent_unavailable in plain words when it exits before answering, or its command is refused before anything starts', async () => {
    const exits = probeCustomAgent({ displayName: 'My Agent', commandLine: command, env: { ...env, FAKE_ACP_EXIT_AT_START: '1' } });
    await expect(exits).rejects.toBeInstanceOf(AgentError);
    await expect(probeCustomAgent({ displayName: 'My Agent', commandLine: 'relative/agent --acp', env })).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
});

describe("the form's joined command line splits back into the same program and arguments (story 21.3)", () => {
  it.each([
    ['/usr/local/bin/goose', 'acp', ['/usr/local/bin/goose', 'acp']],
    ['/Applications/My Agent/agent', '--acp "two words"', ['/Applications/My Agent/agent', '--acp', 'two words']],
    ['C:\\Program Files\\Agent\\agent.exe', '', ['C:\\Program Files\\Agent\\agent.exe']],
    ['C:\\tools\\agent.exe', 'acp', ['C:\\tools\\agent.exe', 'acp']],
    ['/tmp/it\'s "odd"', '', ['/tmp/it\'s "odd"']],
  ])('%s %s', (command, args, expected) => {
    expect(splitCommandLine(joinCommandLine(command, args))).toEqual(expected);
  });
});

/**
 * Chat parity (story 21.5): the shared ACP client behaves for a custom agent
 * exactly as for the built-in ones (`acp-base.test.ts` 6.4 and story 11,
 * `acp-opencode.test.ts`'s cards, cancel and resume), against the fake agent
 * started from the user's own command line.
 */
describe('chat parity for a custom agent (story 21.5)', () => {
  const commandLine = `"${process.execPath}" "${FAKE_AGENT}"`;
  const switches = (extra: Record<string, string> = {}): Record<string, string> => ({ ...env, ...extra });
  type Decide = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

  const custom = (diagnostics: Array<[string, Record<string, unknown> | undefined]> = [], startTimeoutMs?: number) =>
    createCustomAgent({ descriptor, commandLine, onDiagnostic: (message, fields) => diagnostics.push([message, fields]), startTimeoutMs });

  async function start(options: { env?: Record<string, string>; decide?: Decide } = {}) {
    const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
    const session = await custom(diagnostics).startSession({ cwd: tempDir(), env: switches(options.env), onPermissionRequest: options.decide, permissionMode: 'ask' });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    return { session, events, diagnostics };
  }

  const replyText = (events: AgentEvent[]) => events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('');
  const say = async (session: AgentSession, events: AgentEvent[], text: string) => {
    events.length = 0;
    await session.prompt(text);
    return replyText(events);
  };

  /** Whether a process with this pid exists. */
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  // 15 s: a process tree's exit is slow to show on a loaded runner (the close test failed at 5 s under the full suite).
  const until = async (predicate: () => boolean, what: string, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const pidOf = async (session: AgentSession, events: AgentEvent[]) => Number(/pid=(\d+)/.exec(await say(session, events, 'pids'))?.[1]);
  /** The pid the fake wrote at start (FAKE_ACP_PID_FILE), once it is there. */
  const pidFile = () => join(tempDir(), 'agent.pid');
  const pidIn = (file: string) => Number(readFileSync(file, 'utf8').trim());

  /** A failure the user reads: an AgentError in plain words naming the agent, never a stack or a file. */
  const expectPlain = (error: unknown) => {
    expect(error).toBeInstanceOf(AgentError);
    const { message } = error as AgentError;
    expect(message).toContain('My Agent');
    expect(message).not.toMatch(/\n|\bat \S+:\d+|\.m?[jt]s\b|Error:/);
  };

  describe('permission cards by option kind', () => {
    it("asks core with the tool's title, kind and paths", async () => {
      const asked: AgentPermissionRequest[] = [];
      const { session, events } = await start({ decide: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
      expect(await say(session, events, 'permission')).toBe('Ran npm test.');
      expect(await say(session, events, 'permission-edit src/a.ts|docs/b.md')).toBe('Edited src/a.ts, docs/b.md.');
      expect(asked).toEqual([
        { toolCallId: 'call-permission', title: 'Run npm test', kind: 'execute', command: 'npm test', paths: [], rawPaths: [] },
        { toolCallId: 'call-edit-permission', title: 'Edit src/a.ts, docs/b.md', kind: 'edit', command: undefined, paths: ['src/a.ts', 'docs/b.md'], rawPaths: ['src/a.ts', 'docs/b.md'] },
      ]);
    });

    it('Allow picks the allow_once option and Deny the reject_once one, never an always option', async () => {
      // FAKE_ACP_REJECT_OPTIONS makes the reply name the option chosen (`allow` allow_once, `always` allow_always, `reject` reject_once, `never` reject_always).
      const allowed = await start({ env: { FAKE_ACP_REJECT_OPTIONS: 'reject:Deny' }, decide: async () => ({ outcome: 'allow_once' }) });
      expect(await say(allowed.session, allowed.events, 'permission')).toBe('Ran npm test. chose=allow');
      const denied = await start({ env: { FAKE_ACP_REJECT_OPTIONS: 'reject:Deny' }, decide: async () => ({ outcome: 'deny' }) });
      expect(await say(denied.session, denied.events, 'permission')).toBe('Denied npm test. chose=reject');
      // Nothing to ask declines it.
      const unasked = await start({ env: { FAKE_ACP_REJECT_OPTIONS: 'reject:Deny' } });
      expect(await say(unasked.session, unasked.events, 'permission')).toBe('Denied npm test. chose=reject');
    });

    it('a request offering neither once option is cancelled without asking, and logged', async () => {
      const asked: AgentPermissionRequest[] = [];
      const { session, events, diagnostics } = await start({ decide: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
      expect(await say(session, events, 'permission-always-only')).toBe('chose=cancelled');
      expect(asked).toEqual([]);
      expect(diagnostics).toContainEqual(['the agent offered neither allow_once nor reject_once; cancelling the request', { optionKinds: ['allow_always'] }]);
    });
  });

  it('cancel during a long prompt reaches the agent as session/cancel, and the turn ends idle', async () => {
    const { session, events } = await start();
    const turn = session.prompt('hold');
    await until(() => events.some((event) => event.type === 'message_chunk'), 'the first chunk');
    await session.cancel();
    await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
    expect(events.at(-1)).toEqual({ type: 'state', state: 'idle' });
    expect(await say(session, events, 'cancels')).toBe('cancels=1');
  });

  describe('reopening a chat', () => {
    const reopen = async (extra: Record<string, string>) => {
      const opened = await custom().reopenSession({ cwd: tempDir(), env: switches(extra), agentSessionId: 'fake-session-earlier', permissionMode: 'ask' });
      sessions.push(opened.session);
      const events: AgentEvent[] = [];
      opened.session.onEvent((event) => events.push(event));
      return { ...opened, events };
    };

    it.each([
      ['resume advertised', { FAKE_ACP_RESUME: 'resume' }, 'resumed'],
      ['load only', { FAKE_ACP_RESUME: 'load' }, 'loaded'],
      ['neither', { FAKE_ACP_RESUME: 'none' }, 'new'],
      ['resume refused, then load', { FAKE_ACP_RESUME: 'both', FAKE_ACP_REOPEN_FAIL: 'resume' }, 'loaded'],
    ] as const)('%s: %s', async (_, extra, restored) => {
      const opened = await reopen(extra);
      expect(opened.restored).toBe(restored);
      expect(opened.session.agentSessionId === 'fake-session-earlier').toBe(restored !== 'new');
      // A loaded session's replayed history ("Earlier reply.") is swallowed, never reported again.
      const reply = await say(opened.session, opened.events, 'context');
      expect(reply).toMatch(new RegExp(`^session=\\S+ via=${restored} primed=0$`));
      expect(opened.events.some((event) => event.type === 'message_chunk' && event.text.includes('Earlier reply.'))).toBe(false);
    });
  });

  describe('models over ACP', () => {
    it('lists the models the agent advertises as a config option, and switches them live', async () => {
      const { session, events } = await start();
      expect(session.models?.available.map((model) => model.id)).toEqual(['fake-default', 'fake-large', 'fake-small', 'fake-locked']);
      expect(session.models?.current).toBe('fake-default');
      await session.setModel!('fake-large');
      expect(session.models?.current).toBe('fake-large');
      expect(await say(session, events, 'model')).toBe('model=fake-large');
      await expect(session.setModel!('fake-huge')).rejects.toThrow("My Agent doesn't offer that model here.");
      await session.setModel!(null);
      expect(session.models?.current).toBe('fake-default');
    });

    it('an agent listing no models has none and no live switch', async () => {
      const { session } = await start({ env: { FAKE_ACP_NO_MODELS: '1' } });
      expect(session.models).toBeUndefined();
      expect(session.setModel).toBeUndefined();
    });
  });

  describe('failures in plain words, and no process left behind', () => {
    it('an agent that exits at start', async () => {
      const file = pidFile();
      const error = await custom()
        .startSession({ cwd: tempDir(), env: switches({ FAKE_ACP_EXIT_AT_START: '1', FAKE_ACP_PID_FILE: file }), permissionMode: 'ask' })
        .catch((caught: unknown) => caught);
      expectPlain(error);
      expect(error).toMatchObject({ code: 'agent_unavailable', message: "My Agent couldn't start. Try again." });
      await until(() => existsSync(file) && !alive(pidIn(file)), 'the agent to be gone');
    });

    it('an agent that never answers initialize within the start limit', async () => {
      const file = pidFile();
      const started = Date.now();
      const error = await custom([], 500)
        .startSession({ cwd: tempDir(), env: switches({ FAKE_ACP_INIT_DELAY_MS: '5000', FAKE_ACP_PID_FILE: file }), permissionMode: 'ask' })
        .catch((caught: unknown) => caught);
      expect(Date.now() - started).toBeLessThan(4000);
      expectPlain(error);
      expect(error).toMatchObject({ code: 'agent_unavailable', message: "My Agent couldn't start. Try again." });
      await until(() => existsSync(file) && !alive(pidIn(file)), 'the agent to be gone');
    });

    it('an agent that exits mid-prompt stopped unexpectedly, once, and the session refuses more', async () => {
      const { session, events } = await start();
      const pid = await pidOf(session, events);
      events.length = 0;
      const error = await session.prompt('crash').catch((caught: unknown) => caught);
      expectPlain(error);
      expect(error).toMatchObject({ code: 'agent_failed', message: 'My Agent stopped unexpectedly. Send your message again to restart it.' });
      const errors = events.filter((event) => event.type === 'state' && event.state === 'error');
      expect(errors).toEqual([{ type: 'state', state: 'error', reason: 'My Agent stopped unexpectedly. Send your message again to restart it.', fatal: true }]);
      expectPlain(await session.prompt('hello').catch((caught: unknown) => caught));
      await until(() => !alive(pid), 'the agent to be gone');
    });

    it('close stops the agent and the child it started, after a reply', { timeout: 30_000 }, async () => {
      const replied = await start({ env: { FAKE_ACP_SPAWN_GRANDCHILD: '1' } });
      const [, pid, grandchild] = /pid=(\d+) grandchild=(\d+)/.exec(await say(replied.session, replied.events, 'pids')) ?? [];
      await replied.session.close();
      await until(() => !alive(Number(pid)) && !alive(Number(grandchild)), 'the agent and its child to exit');
    });

    it('close stops the agent after a cancel', { timeout: 30_000 }, async () => {
      const cancelled = await start();
      const cancelledPid = await pidOf(cancelled.session, cancelled.events);
      const turn = cancelled.session.prompt('hold');
      await until(() => cancelled.events.some((event) => event.type === 'message_chunk'), 'the first chunk');
      await cancelled.session.cancel();
      await turn;
      await cancelled.session.close();
      await until(() => !alive(cancelledPid), 'the cancelled agent to exit');
    });

    it('close stops the agent after a reopen', { timeout: 30_000 }, async () => {
      const reopened = await custom().reopenSession({ cwd: tempDir(), env: switches({ FAKE_ACP_RESUME: 'load' }), agentSessionId: 'fake-session-earlier', permissionMode: 'ask' });
      const events: AgentEvent[] = [];
      reopened.session.onEvent((event) => events.push(event));
      const reopenedPid = await pidOf(reopened.session, events);
      await reopened.session.close();
      await until(() => !alive(reopenedPid), 'the reopened agent to exit');
    });
  });
});

describe('a custom agent never runs in a mode that never asks (story 21.5)', () => {
  const commandLine = `"${process.execPath}" "${FAKE_AGENT}"`;
  const port = () => createCustomAgent({ descriptor, commandLine });
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const gone = async (pid: number) => {
    const deadline = Date.now() + 5_000;
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return !alive(pid);
  };

  it.each([
    ['bypassPermissions', true],
    ['acceptEdits', true],
    ['yoloMode', true],
    ['autoMode', true],
    ['auto_edit', true],
    ['autoEdit', true],
    ['agent-full-access', true],
    ['BYPASS_PERMISSIONS', true],
    ['auto', true],
    ['default', false],
    ['plan', false],
    ['read-only', false],
    ['ask', false],
    ['dontAsk', false],
    ['agent', false],
  ])('%s never asks: %s', (mode, refused) => {
    expect(neverAsksMode(mode)).toBe(refused);
  });

  it.each(['bypassPermissions', 'YOLO_Mode'])('refuses a session that opens in %s, naming the mode, and stops its process', async (mode) => {
    const pidFile = join(tempDir(), 'pid');
    const started = port().startSession({ cwd: tempDir(), env: { ...env, FAKE_ACP_START_MODE: mode, FAKE_ACP_MODES: `default:Manual,${mode}:Trust everything`, FAKE_ACP_PID_FILE: pidFile }, permissionMode: 'ask' });
    await expect(started).rejects.toMatchObject({ code: 'agent_unavailable', message: 'My Agent starts in a mode that never asks (Trust everything). Switch it to a mode that asks in its own settings, then try again.' });
    expect(await gone(Number(readFileSync(pidFile, 'utf8')))).toBe(true);
  });

  it('opens and chats in a mode it calls something else (an ask mode Ogden does not know by name)', async () => {
    const session = await port().startSession({ cwd: tempDir(), env: { ...env, FAKE_ACP_START_MODE: 'default' }, permissionMode: 'ask' });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('hi');
    expect(events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('')).toBe('Hello from the fake agent.');
  });

  it('stops a chat whose agent switches itself to a mode that never asks, and its process is gone', async () => {
    const session = await port().startSession({ cwd: tempDir(), env, permissionMode: 'ask' });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('pids');
    const pid = Number(/pid=(\d+)/.exec(events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join(''))?.[1]);
    await session.prompt('mode-switch bypassPermissions').catch(() => undefined);
    const deadline = Date.now() + 3_000;
    const stopped = () => events.find((event) => event.type === 'state' && event.state === 'error');
    while (stopped() === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped()).toMatchObject({ type: 'state', state: 'error', fatal: true, reason: 'My Agent switched itself to a mode that never asks, so the chat was stopped.' });
    expect(await gone(pid)).toBe(true);
  });
});
