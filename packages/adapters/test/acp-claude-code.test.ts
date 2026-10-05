/**
 * The `acp-claude-code` adapter against the fake ACP agent
 * (`tests/fixtures/fake-acp-agent.mjs`), which speaks real ACP over stdio.
 * No test runs a real agent or touches an account.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, PROTECTED_PATHS, type AgentEvent, type AgentPermissionDecision, type AgentPermissionRequest, type AgentSession, type ProtectedPaths } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { asksLessThanAsk, ogdenModeOf, pathsOf } from '../src/acp-claude-code/claude-code-agent.js';
import { claudeAskRules, createClaudeCodeAgent, createStreamMasker, findClaudeExecutable, MASKED, maskSecrets, resolveClaudeAgentAcp, secretValues } from '../src/index.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-acp-'));
  dirs.push(dir);
  return dir;
}

/** The environment a test agent gets: enough to run Node, and nothing of the user's. */
function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '', ...extra };
}

async function startFake(
  options: {
    env?: Record<string, string>;
    claudeExecutable?: string | null;
    onPermissionRequest?: (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;
    protectedPaths?: ProtectedPaths;
  } = {},
) {
  const diagnostics: string[] = [];
  const agent = createClaudeCodeAgent({
    adapterPath: FAKE_AGENT,
    claudeExecutable: options.claudeExecutable === undefined ? null : options.claudeExecutable,
    onDiagnostic: (message, fields) => diagnostics.push(`${message} ${JSON.stringify(fields ?? {})}`),
  });
  const session = await agent.startSession({ cwd: tempDir(), env: baseEnv(options.env), onPermissionRequest: options.onPermissionRequest, protectedPaths: options.protectedPaths });
  sessions.push(session);
  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { agent, session, events, diagnostics };
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

const until = async (predicate: () => boolean, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('acp-claude-code over ACP', () => {
  it('initializes, opens a session and streams a prompt reply: working, chunks, idle', async () => {
    const { agent, session, events } = await startFake();
    expect(agent.displayName).toBe('Claude Code');
    expect(session.agentSessionId).toMatch(/^fake-session-/);

    const result = await session.prompt('Say hello in five words');
    expect(result.stopReason).toBe('end_turn');
    expect(events).toEqual([
      { type: 'state', state: 'working' },
      { type: 'message_chunk', text: 'Hello' },
      { type: 'message_chunk', text: ' from the' },
      { type: 'message_chunk', text: ' fake agent.' },
      { type: 'state', state: 'idle' },
    ]);

    // A second turn on the same session.
    await session.prompt('again');
    expect(events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)).toEqual(['working', 'idle', 'working', 'idle']);
  });

  it('cancel ends a running prompt, and the session goes back to idle', async () => {
    const { session, events } = await startFake();
    const turn = session.prompt('slow');
    await until(() => events.some((e) => e.type === 'message_chunk'), 'the first chunk');
    await session.cancel();
    await expect(turn).resolves.toEqual({ stopReason: 'cancelled' });
    expect(events.at(-1)).toEqual({ type: 'state', state: 'idle' });
  });

  it('a prompt the agent fails (its process still running) reports a non-fatal error, and the session takes the next prompt', async () => {
    const { session, events } = await startFake();
    await expect(session.prompt('fail')).rejects.toBeInstanceOf(AgentError);
    expect(events.at(-1)).toEqual({ type: 'state', state: 'error', reason: 'Claude Code stopped with an error. Try again.' });
    await expect(session.prompt('hello')).resolves.toEqual({ stopReason: 'end_turn' });
    expect(events.at(-1)).toEqual({ type: 'state', state: 'idle' });
  });

  it('the process exiting mid-prompt reports one error and never hangs', async () => {
    const { session, events } = await startFake();
    const turn = session.prompt('crash');
    await expect(turn).rejects.toMatchObject({ code: 'agent_failed' });
    const errors = events.filter((e) => e.type === 'state' && e.state === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ reason: expect.stringContaining('stopped unexpectedly'), fatal: true });
    // A dead session refuses further prompts at once.
    await expect(session.prompt('hello')).rejects.toBeInstanceOf(AgentError);
  });

  it('passes the detected claude to the adapter as CLAUDE_CODE_EXECUTABLE, and core’s env wins over it', async () => {
    const detected = await startFake({ claudeExecutable: '/opt/claude/bin/claude' });
    const chunks: string[] = [];
    detected.session.onEvent((e) => e.type === 'message_chunk' && chunks.push(e.text));
    await detected.session.prompt('env');
    expect(chunks.join('')).toBe('CLAUDE_CODE_EXECUTABLE=/opt/claude/bin/claude');

    const given = await startFake({ claudeExecutable: '/opt/claude/bin/claude', env: { CLAUDE_CODE_EXECUTABLE: '/from/core' } });
    const more: string[] = [];
    given.session.onEvent((e) => e.type === 'message_chunk' && more.push(e.text));
    await given.session.prompt('env');
    expect(more.join('')).toBe('CLAUDE_CODE_EXECUTABLE=/from/core');

    const bundled = await startFake({ claudeExecutable: null });
    const none: string[] = [];
    bundled.session.onEvent((e) => e.type === 'message_chunk' && none.push(e.text));
    await bundled.session.prompt('env');
    expect(none.join('')).toBe('CLAUDE_CODE_EXECUTABLE=(unset)');
  });

  it('masks secret values the agent echoes, even split across chunks, and never logs its stderr or environment', async () => {
    const secret = 'sk-ant-api03-secret-value-0123456789';
    const { session, events, diagnostics } = await startFake({ env: { ANTHROPIC_API_KEY: secret, GITHUB_TOKEN: 'ghp_other_secret', PLAIN: 'visible-value' } });
    await session.prompt('echo-env');
    await session.close();
    const reply = events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');
    expect(reply).toContain(`ANTHROPIC_API_KEY=${MASKED}`);
    expect(reply).toContain(`GITHUB_TOKEN=${MASKED}`);
    expect(reply).toContain('PLAIN=visible-value');
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain('ghp_other_secret');
    const log = diagnostics.join('\n');
    for (const leaked of [secret, 'ghp_other_secret', 'ANTHROPIC_API_KEY', 'visible-value']) expect(log).not.toContain(leaked);
    // Stderr is counted, not logged.
    expect(log).toMatch(/the agent wrote to stderr \{"bytes":\d+\}/);
  });

  it('close stops the whole process tree: the adapter and what it started', async () => {
    const { session, events } = await startFake({ env: { FAKE_ACP_SPAWN_GRANDCHILD: '1' } });
    await session.prompt('pids');
    const text = events.flatMap((e) => (e.type === 'message_chunk' ? [e.text] : [])).join('');
    const [, pid, grandchild] = /pid=(\d+) grandchild=(\d+)/.exec(text) ?? [];
    expect(alive(Number(pid))).toBe(true);
    expect(alive(Number(grandchild))).toBe(true);
    await session.close();
    await until(() => !alive(Number(pid)) && !alive(Number(grandchild)), 'the adapter and its child to exit');
  });

  it('close stops the process; closing twice is safe', async () => {
    const { session } = await startFake();
    await session.close();
    await session.close();
    await expect(session.prompt('hello')).rejects.toBeInstanceOf(AgentError);
  });
});

/** The reply text of a turn: every chunk since `from`. */
const replyText = (events: AgentEvent[], from = 0) =>
  events
    .slice(from)
    .flatMap((e) => (e.type === 'message_chunk' ? [e.text] : []))
    .join('');

describe('permission requests', () => {
  it('asks core through onPermissionRequest, and allow_once lets the tool call run', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await startFake({
      onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }),
    });
    await session.prompt('permission');
    expect(asked).toEqual([{ toolCallId: 'call-permission', title: 'Run npm test', kind: 'execute', command: 'npm test', paths: [] }]);
    expect(replyText(events)).toBe('Ran npm test.');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_update', toolCallId: 'call-permission', status: 'completed' }));
  });

  it('deny (and cancelled) keep the tool call from running', async () => {
    const denied = await startFake({ onPermissionRequest: async () => ({ outcome: 'deny', reason: 'not now' }) });
    await denied.session.prompt('permission');
    expect(replyText(denied.events)).toBe('Denied npm test.');

    const cancelled = await startFake({ onPermissionRequest: async () => ({ outcome: 'cancelled' }) });
    await cancelled.session.prompt('permission');
    expect(replyText(cancelled.events)).toBe('Denied npm test.');
  });

  it('with no callback, or a callback that fails, every request is declined', async () => {
    const none = await startFake();
    await none.session.prompt('permission');
    expect(replyText(none.events)).toBe('Denied npm test.');

    const broken = await startFake({ onPermissionRequest: () => Promise.reject(new Error('boom')) });
    await broken.session.prompt('permission');
    expect(replyText(broken.events)).toBe('Denied npm test.');
  });

  it('a null decision or an unknown outcome is declined', async () => {
    const nothing = await startFake({ onPermissionRequest: async () => null as unknown as AgentPermissionDecision });
    await nothing.session.prompt('permission');
    expect(replyText(nothing.events)).toBe('Denied npm test.');

    const unknown = await startFake({ onPermissionRequest: async () => ({ outcome: 'allow_always' }) as unknown as AgentPermissionDecision });
    await unknown.session.prompt('permission');
    expect(replyText(unknown.events)).toBe('Denied npm test.');
  });

  it('masks secrets in what it asks about', async () => {
    const secret = 'npm test';
    const asked: AgentPermissionRequest[] = [];
    const { session } = await startFake({
      env: { FAKE_TOKEN: secret },
      onPermissionRequest: async (request) => (asked.push(request), { outcome: 'deny' }),
    });
    await session.prompt('permission');
    expect(asked[0]?.command).toBe(MASKED);
    expect(asked[0]?.title).toBe(`Run ${MASKED}`);
  });
});

describe('tool calls', () => {
  it('reports the call and its update, with the diff it carries', async () => {
    const { session, events } = await startFake();
    await session.prompt('tool');
    const calls = events.filter((e) => e.type === 'tool_call' || e.type === 'tool_call_update');
    expect(calls).toEqual([
      { type: 'tool_call', toolCallId: 'call-edit', title: 'Edit src/example.ts', kind: 'edit', status: 'in_progress', diffs: undefined },
      {
        type: 'tool_call_update',
        toolCallId: 'call-edit',
        title: undefined,
        kind: undefined,
        status: 'completed',
        diffs: [{ path: 'src/example.ts', oldText: 'const a = 1;\n', newText: 'const a = 2;\n' }],
      },
    ]);
    expect(replyText(events)).toBe('Edited.');
  });

  it('masks secrets in diffs', async () => {
    const { session, events } = await startFake({ env: { EXAMPLE_KEY: 'const a = 2' } });
    await session.prompt('tool');
    const update = events.find((e) => e.type === 'tool_call_update');
    expect(JSON.stringify(update)).not.toContain('const a = 2');
    expect(update).toMatchObject({ diffs: [{ newText: `${MASKED};\n` }] });
  });
});

describe('permission modes', () => {
  it('declares Ask, Auto and Skip all, and a session lists what the agent offers', async () => {
    const { agent, session } = await startFake();
    expect(agent.permissionModes).toEqual(['ask', 'auto', 'skip_all']);
    expect(session.permissionModes).toEqual(['ask', 'auto', 'skip_all']);
    const { session: limited } = await startFake({ env: { FAKE_ACP_NO_AUTO: '1', FAKE_ACP_NO_BYPASS: '1' } });
    expect(limited.permissionModes).toEqual(['ask']);
    await expect(limited.setPermissionMode!('skip_all')).rejects.toBeInstanceOf(AgentError);
    await expect(limited.setPermissionMode!('ask')).resolves.toBeUndefined();
  });

  it('sets the session mode with session/set_mode: Ask, Auto and Skip all as default, auto and bypassPermissions', async () => {
    const { session, events } = await startFake({ env: { FAKE_ACP_START_MODE: 'bypassPermissions' } });
    await session.prompt('mode');
    expect(replyText(events)).toBe('mode=bypassPermissions');
    for (const [mode, id] of [['ask', 'default'], ['auto', 'auto'], ['skip_all', 'bypassPermissions']] as const) {
      events.length = 0;
      await session.setPermissionMode!(mode);
      await session.prompt('mode');
      expect(replyText(events)).toBe(`mode=${id}`);
    }
    // Setting it does not report it back: only the agent's own report is an event.
    expect(events.some((event) => event.type === 'permission_mode')).toBe(false);
  });

  it("reports the agent's own mode changes, with whether they ask less than Ask and the agent's name for them", async () => {
    const { session, events } = await startFake();
    await session.prompt('mode-switch plan');
    await session.prompt('mode-switch acceptEdits');
    await session.prompt('mode-switch default');
    expect(events.filter((event) => event.type === 'permission_mode')).toEqual([
      { type: 'permission_mode', mode: 'other', asksLess: false, label: 'Plan' },
      { type: 'permission_mode', mode: 'other', asksLess: true, label: 'Accept edits' },
      { type: 'permission_mode', mode: 'ask', asksLess: false, label: 'Manual' },
    ]);
    expect([ogdenModeOf('default'), ogdenModeOf('auto'), ogdenModeOf('bypassPermissions'), ogdenModeOf('acceptEdits'), ogdenModeOf('plan')]).toEqual(['ask', 'auto', 'skip_all', 'other', 'other']);
    expect(['default', 'plan', 'dontAsk', 'acceptEdits', 'auto', 'bypassPermissions', 'brandNew'].map(asksLessThanAsk)).toEqual([false, false, false, true, true, true, true]);
  });

  it('Auto falling back to accepting edits is reported after set_mode answers', async () => {
    const { session, events } = await startFake({ env: { FAKE_ACP_AUTO_FALLBACK: '1' } });
    await session.setPermissionMode!('auto');
    await until(() => events.some((event) => event.type === 'permission_mode'), 'the fallback reported');
    expect(events.find((event) => event.type === 'permission_mode')).toEqual({ type: 'permission_mode', mode: 'other', asksLess: true, label: 'Accept edits' });
    // Told Ask again, it is: the reported mode stood, so set_mode is sent.
    await session.setPermissionMode!('ask');
    events.length = 0;
    await session.prompt('mode');
    expect(replyText(events)).toBe('mode=default');
  });

  it('in bypassPermissions a command runs without asking; its own safety checks still ask', async () => {
    const asked: AgentPermissionRequest[] = [];
    const { session, events } = await startFake({ onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
    await session.setPermissionMode!('skip_all');
    await session.prompt('permission npm test');
    expect(asked).toEqual([]);
    expect(replyText(events)).toBe('Ran npm test.');
    await session.prompt('permission-safety rm -rf .git');
    expect(asked.map((request) => request.command)).toEqual(['rm -rf .git']);
  });

  it('after a set_mode that failed, or while one is unanswered, the mode is not trusted: the next one is sent', async () => {
    const failed = await startFake({ env: { FAKE_ACP_SET_MODE_FAIL: 'bypassPermissions' } });
    await expect(failed.session.setPermissionMode!('skip_all')).rejects.toBeInstanceOf(AgentError);
    // The agent took bypass before failing; its last known mode is still `default`, yet Ask is sent.
    await failed.session.setPermissionMode!('ask');
    await failed.session.prompt('mode');
    expect(replyText(failed.events)).toBe('mode=default');

    const hung = await startFake({ env: { FAKE_ACP_SET_MODE_HANG: 'bypassPermissions' } });
    void hung.session.setPermissionMode!('skip_all').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await hung.session.setPermissionMode!('ask');
    await hung.session.prompt('mode');
    expect(replyText(hung.events)).toBe('mode=default');
  });

  it('keeps the protected paths guarded when asked: ask rules in the session settings, so an Auto edit of one still asks (user decision 2026-10-02)', async () => {
    expect(claudeAskRules(PROTECTED_PATHS)).toEqual(expect.arrayContaining(['Edit(**/.claude/**)', 'Edit(**/.git/**)', 'Edit(**/CLAUDE.md)', 'Edit(**/.mcp.json)']));
    const asked: AgentPermissionRequest[] = [];
    const guarded = await startFake({ protectedPaths: PROTECTED_PATHS, onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
    expect(guarded.session.protectsPaths).toBe(true);
    await guarded.session.prompt('guards');
    expect(replyText(guarded.events)).toBe(`ask=${JSON.stringify(claudeAskRules(PROTECTED_PATHS))}`);
    await guarded.session.setPermissionMode!('auto');
    await guarded.session.prompt('permission-edit src/a.ts');
    expect(asked).toEqual([]);
    await guarded.session.prompt('permission-edit .claude/settings.json');
    await guarded.session.prompt('permission-edit docs/CLAUDE.md');
    expect(asked.map((request) => request.paths)).toEqual([['.claude/settings.json'], ['docs/CLAUDE.md']]);

    // Without the guards (Ask or Skip all sessions), the session settings carry no ask rules.
    const plain = await startFake({ onPermissionRequest: async (request) => (asked.push(request), { outcome: 'allow_once' }) });
    expect(plain.session.protectsPaths).toBe(false);
    await plain.session.prompt('guards');
    expect(replyText(plain.events)).toBe('ask=[]');
    await plain.session.setPermissionMode!('auto');
    await plain.session.prompt('permission-edit .claude/settings.json');
    expect(asked).toHaveLength(2);
  });

  it('a reopened session gets the same guards', async () => {
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
    const opened = await agent.reopenSession({ cwd: tempDir(), env: baseEnv({ FAKE_ACP_RESUME: 'resume' }), agentSessionId: 'fake-session-earlier', protectedPaths: PROTECTED_PATHS });
    sessions.push(opened.session);
    const events: AgentEvent[] = [];
    opened.session.onEvent((event) => events.push(event));
    expect(opened.restored).toBe('resumed');
    await opened.session.prompt('guards');
    expect(replyText(events)).toBe(`ask=${JSON.stringify(claudeAskRules(PROTECTED_PATHS))}`);
  });

  it('a plan-exit card with mode-raising allow_always options gets the allow_once option (manually approve): never a mode change', async () => {
    const { session, events } = await startFake({ onPermissionRequest: async () => ({ outcome: 'allow_once' }) });
    await session.prompt('plan-exit');
    expect(replyText(events)).toBe('chose=exit-plan-default');
  });

  it('a reopened session lists its modes too, and is set the same way', async () => {
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
    const opened = await agent.reopenSession({ cwd: tempDir(), env: baseEnv({ FAKE_ACP_RESUME: 'resume', FAKE_ACP_START_MODE: 'auto' }), agentSessionId: 'fake-session-earlier' });
    sessions.push(opened.session);
    const events: AgentEvent[] = [];
    opened.session.onEvent((event) => events.push(event));
    expect(opened.session.permissionModes).toEqual(['ask', 'auto', 'skip_all']);
    await opened.session.setPermissionMode!('ask');
    await opened.session.prompt('mode');
    expect(replyText(events)).toBe('mode=default');
  });
});

describe('reopening a session', () => {
  const reopen = async (mode: 'resume' | 'load' | 'none' | 'both', agentSessionId = 'fake-session-earlier', fail = '') => {
    const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null, onDiagnostic: (message, fields) => diagnostics.push([message, fields]) });
    // A secret starting with the end of the replayed chunk ("Earlier reply."), so a replayed
    // chunk that was not swallowed would be held back and surface in the next turn's reply.
    const env = baseEnv({ FAKE_ACP_RESUME: mode, HELD_BACK_KEY: 'reply.and-more', ...(fail === '' ? {} : { FAKE_ACP_REOPEN_FAIL: fail }) });
    const opened = await agent.reopenSession({ cwd: tempDir(), env, agentSessionId });
    sessions.push(opened.session);
    const events: AgentEvent[] = [];
    opened.session.onEvent((event) => events.push(event));
    return { ...opened, events, diagnostics };
  };
  /** What the log got about refused reopens: the method and the error code, nothing else. */
  const refusals = (diagnostics: Array<[string, Record<string, unknown> | undefined]>) =>
    diagnostics.filter(([message]) => message === 'the agent could not reopen its session').map(([, fields]) => fields);

  it('resumes when the agent advertises session/resume', async () => {
    const { session, restored, events } = await reopen('resume');
    expect(restored).toBe('resumed');
    expect(session.agentSessionId).toBe('fake-session-earlier');
    await session.prompt('context');
    expect(replyText(events)).toBe('session=fake-session-earlier via=resumed primed=0');
  });

  it('loads when it advertises only loadSession, and swallows the history the load replays', async () => {
    const { session, restored, events } = await reopen('load');
    expect(restored).toBe('loaded');
    expect(session.agentSessionId).toBe('fake-session-earlier');
    await session.prompt('context');
    expect(replyText(events)).toBe('session=fake-session-earlier via=loaded primed=0');
    expect(replyText(events)).not.toContain('Earlier reply.');
  });

  it('prefers resume when the agent offers both', async () => {
    const { restored, diagnostics } = await reopen('both');
    expect(restored).toBe('resumed');
    expect(refusals(diagnostics)).toEqual([]);
  });

  it('a refused resume falls back to load when the agent offers it, and logs only the method and code (2.3 review F3)', async () => {
    const { session, restored, events, diagnostics } = await reopen('both', 'fake-session-earlier', 'resume');
    expect(restored).toBe('loaded');
    await session.prompt('context');
    expect(replyText(events)).toBe('session=fake-session-earlier via=loaded primed=0');
    expect(refusals(diagnostics)).toEqual([{ method: 'session/resume', code: -32002 }]);
    expect(JSON.stringify(diagnostics)).not.toContain('fake-session-earlier');
  });

  it('a refused resume with no load, or a refused load, starts a new session', async () => {
    const onlyResume = await reopen('resume', 'fake-session-earlier', 'resume');
    expect(onlyResume.restored).toBe('new');
    expect(onlyResume.session.agentSessionId).not.toBe('fake-session-earlier');
    const both = await reopen('both', 'fake-session-earlier', 'resume,load');
    expect(both.restored).toBe('new');
    expect(refusals(both.diagnostics)).toEqual([
      { method: 'session/resume', code: -32002 },
      { method: 'session/load', code: -32002 },
    ]);
    // The failed load's replay was swallowed too.
    await both.session.prompt('context');
    expect(replyText(both.events)).toBe(`session=${both.session.agentSessionId} via=new primed=0`);
  });

  it('an expired sign-in on resume fails the reopen instead of starting a new session', async () => {
    await expect(reopen('both', 'fake-session-earlier', 'resume-auth')).rejects.toMatchObject({
      code: 'auth_required',
      message: 'Claude Code needs you to sign in again.',
    });
  });

  it('starts a new session when it can do neither', async () => {
    const { session, restored, events } = await reopen('none');
    expect(restored).toBe('new');
    expect(session.agentSessionId).toMatch(/^fake-session-\d+$/);
    await session.prompt('context');
    expect(replyText(events)).toBe(`session=${session.agentSessionId} via=new primed=0`);
  });
});

describe('sign-in methods', () => {
  it('advertises auth.terminal in initialize, so the agent lists its terminal sign-in', async () => {
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
    // The fake lists the method only to a client that set clientCapabilities.auth.terminal.
    await expect(agent.listAuthMethods({ env: baseEnv({ FAKE_ACP_AUTH: 'terminal' }) })).resolves.toEqual([
      {
        id: 'fake-login',
        name: 'Log in with your account',
        description: 'Signs in with the fake agent',
        kind: 'terminal',
        args: ['--login'],
        env: { FAKE_LOGIN: '1' },
      },
    ]);
    await expect(agent.listAuthMethods({ env: baseEnv() })).resolves.toEqual([]);
  });

  it('a prompt refused for an expired sign-in says to sign in again', async () => {
    const { session, events } = await startFake();
    await expect(session.prompt('auth-expired')).rejects.toMatchObject({ code: 'auth_required', message: 'Claude Code needs you to sign in again.' });
    expect(events.at(-1)).toMatchObject({ type: 'state', state: 'error', reason: 'Claude Code needs you to sign in again.', code: 'auth_required' });
  });

  it('with FAKE_ACP_REQUIRE_LOGIN, prompts are refused until the fake login signed in (9.4)', async () => {
    const state = join(tempDir(), 'login.json');
    const { session, events } = await startFake({ env: { FAKE_ACP_REQUIRE_LOGIN: state } });
    await expect(session.prompt('hi')).rejects.toMatchObject({ code: 'auth_required' });
    expect(events.at(-1)).toMatchObject({ type: 'state', state: 'error', code: 'auth_required' });
    writeFileSync(state, JSON.stringify({ loggedIn: true }));
    await expect(session.prompt('hi')).resolves.toEqual({ stopReason: 'end_turn' });
  });

  it('any other refused prompt has no code on its error event (9.4)', async () => {
    const { session, events } = await startFake();
    await expect(session.prompt('fail')).rejects.toMatchObject({ code: 'agent_failed' });
    const error = events.at(-1);
    expect(error).toMatchObject({ type: 'state', state: 'error' });
    expect(error).not.toHaveProperty('code');
  });

  it('a prompt that fails with a usage-limit notice the descriptor names is usage_limit, and the session stays usable (handoff)', async () => {
    const { session, events } = await startFake();
    await expect(session.prompt('usage-limit')).rejects.toMatchObject({ code: 'usage_limit' });
    expect(events.at(-1)).toEqual({
      type: 'state',
      state: 'error',
      reason: 'Claude Code has reached its usage limit. Continue this chat with another agent while it cools down, or try again later.',
      code: 'usage_limit',
    });
    await expect(session.prompt('hello')).resolves.toEqual({ stopReason: 'end_turn' });
  });
});

describe('when the agent can’t be started', () => {
  it('a missing adapter is agent_unavailable with a plain message', async () => {
    const agent = createClaudeCodeAgent({ adapterPath: join(tempDir(), 'missing.mjs'), claudeExecutable: null });
    const failure = agent.startSession({ cwd: tempDir(), env: baseEnv() });
    await expect(failure).rejects.toMatchObject({
      code: 'agent_unavailable',
      message: "Claude Code isn't set up for Ogden Agents on this computer yet.",
    });
  });

  it('an adapter that exits before answering is agent_unavailable, not a hang', async () => {
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null, startTimeoutMs: 10_000 });
    const started = Date.now();
    await expect(agent.startSession({ cwd: tempDir(), env: baseEnv({ FAKE_ACP_EXIT_AT_START: '1' }) })).rejects.toBeInstanceOf(AgentError);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('an adapter that never answers times out', async () => {
    const script = join(tempDir(), 'silent.mjs');
    writeFileSync(script, 'setInterval(() => {}, 1000);\n');
    const agent = createClaudeCodeAgent({ adapterPath: script, claudeExecutable: null, startTimeoutMs: 300 });
    await expect(agent.startSession({ cwd: tempDir(), env: baseEnv() })).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
});

describe('finding claude', () => {
  it('takes the first runnable claude on PATH, then Claude Code’s own install locations', () => {
    // Real folders and a real file on this computer, with its own naming and default runnable check.
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const home = tempDir();
    const onPath = join(tempDir(), 'bin');
    mkdirSync(onPath);
    const local = join(home, '.local', 'bin');
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, name), '#!/bin/sh\n');
    chmodSync(join(local, name), 0o755);
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';

    expect(findClaudeExecutable({ [pathKey]: onPath }, { home })).toBe(join(local, name));
    writeFileSync(join(onPath, name), '#!/bin/sh\n');
    chmodSync(join(onPath, name), 0o755);
    expect(findClaudeExecutable({ [pathKey]: onPath }, { home })).toBe(join(onPath, name));
    expect(findClaudeExecutable({ [pathKey]: '' }, { home, isExecutable: () => false })).toBeUndefined();
  });

  it('skips relative PATH entries, so only absolute paths are ever returned', () => {
    const seen: string[] = [];
    const found = findClaudeExecutable({ PATH: ['.', 'bin', '', '/usr/local/bin'].join(':') }, { platform: 'linux', home: '/home/a', isExecutable: (f) => (seen.push(f), true) });
    expect(found).toBe('/usr/local/bin/claude');
    expect(seen.every((f) => f.startsWith('/'))).toBe(true);
    expect(findClaudeExecutable({ PATH: '.' }, { platform: 'linux', home: 'relative-home', isExecutable: () => true })).toBeUndefined();
  });

  it('on Windows: Path in any case, quoted and relative entries, USERPROFILE, and only claude.exe', () => {
    const seen: string[] = [];
    const found = findClaudeExecutable(
      { Path: ['.\\bin', '"C:\\Program Files\\Claude"', 'D:\\tools'].join(';'), USERPROFILE: 'C:\\Users\\a' },
      { platform: 'win32', isExecutable: (f) => (seen.push(f), f === 'D:\\tools\\claude.exe') },
    );
    expect(found).toBe('D:\\tools\\claude.exe');
    expect(seen).toEqual(['C:\\Program Files\\Claude\\claude.exe', 'C:\\Program Files\\Claude\\claude.cmd', 'D:\\tools\\claude.exe']);
    const home: string[] = [];
    findClaudeExecutable({ PATH: '' , USERPROFILE: 'C:\\Users\\a' }, { platform: 'win32', isExecutable: (f) => (home.push(f), false) });
    expect(home).toEqual([
      'C:\\Users\\a\\.local\\bin\\claude.exe',
      'C:\\Users\\a\\.local\\bin\\claude.cmd',
      'C:\\Users\\a\\.claude\\local\\claude.exe',
      'C:\\Users\\a\\.claude\\local\\claude.cmd',
    ]);
  });

  it('on Windows only claude.exe counts, never a .cmd or other shim', () => {
    const seen: string[] = [];
    findClaudeExecutable({ PATH: 'C:\\tools' }, { platform: 'win32', home: 'C:\\Users\\a', isExecutable: (f) => (seen.push(f), false) });
    expect(seen.every((f) => f.endsWith('claude.exe') || f.endsWith('claude.cmd'))).toBe(true);
    // Every file is runnable, yet only an .exe comes back.
    expect(findClaudeExecutable({ PATH: 'C:\\tools' }, { platform: 'win32', home: 'C:\\Users\\a', isExecutable: (f) => !f.endsWith('claude.exe') })).toBeUndefined();
  });

  it('on Windows an npm claude.cmd gives the package’s claude.exe beside it', () => {
    const npm = 'C:\\Users\\a\\AppData\\Roaming\\npm';
    const packaged = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const files = new Set([`${npm}\\claude.cmd`, packaged]);
    const env = { Path: ['C:\\Windows', npm, 'D:\\tools'].join(';'), USERPROFILE: 'C:\\Users\\a' };
    expect(findClaudeExecutable(env, { platform: 'win32', isExecutable: (f) => files.has(f) })).toBe(packaged);

    // A claude.exe earlier on Path still wins; in the same folder the shim's own .exe comes second.
    files.add('C:\\Windows\\claude.exe');
    expect(findClaudeExecutable(env, { platform: 'win32', isExecutable: (f) => files.has(f) })).toBe('C:\\Windows\\claude.exe');
    files.delete('C:\\Windows\\claude.exe');
    files.add(`${npm}\\claude.exe`);
    expect(findClaudeExecutable(env, { platform: 'win32', isExecutable: (f) => files.has(f) })).toBe(`${npm}\\claude.exe`);
    files.delete(`${npm}\\claude.exe`);

    // The package's .exe is missing: the next candidate, never the .cmd.
    files.delete(packaged);
    files.add('D:\\tools\\claude.exe');
    expect(findClaudeExecutable(env, { platform: 'win32', isExecutable: (f) => files.has(f) })).toBe('D:\\tools\\claude.exe');
    files.delete('D:\\tools\\claude.exe');
    expect(findClaudeExecutable(env, { platform: 'win32', isExecutable: (f) => files.has(f) })).toBeUndefined();

    // A package .exe without the shim beside it isn't looked for.
    expect(findClaudeExecutable(env, { platform: 'win32', isExecutable: (f) => f === packaged })).toBeUndefined();
  });

  it('on POSIX no .cmd is looked for', () => {
    const seen: string[] = [];
    findClaudeExecutable({ PATH: '/usr/bin' }, { platform: 'linux', home: '/home/a', isExecutable: (f) => (seen.push(f), false) });
    expect(seen).toEqual(['/usr/bin/claude', '/home/a/.local/bin/claude', '/home/a/.claude/local/claude']);
  });

  it('resolves the dev-installed adapter from node_modules (a dev dependency only)', () => {
    expect(resolveClaudeAgentAcp()).toMatch(/claude-agent-acp[\\/]dist[\\/]index\.js$/);
  });
});

describe('masking secrets', () => {
  it('takes secret-looking variables only, longest first', () => {
    expect(secretValues({ ANTHROPIC_API_KEY: 'aaaa-long', GH_TOKEN: 'bbbbbb', DB_PASSWORD: 'cccc', client_secret: 'dddd', PATH: '/usr/bin', SHORT_KEY: 'ab' })).toEqual([
      'aaaa-long',
      'bbbbbb',
      'cccc',
      'dddd',
    ]);
  });

  it('masks whole values in text, and in a stream however the chunks split them', () => {
    const secrets = ['abcdef', 'efgh'];
    expect(maskSecrets('x abcdef y efgh', secrets)).toBe(`x ${MASKED} y ${MASKED}`);
    const text = 'start abcdef middle efgh abcdefgh end abcde';
    for (let size = 1; size <= 8; size++) {
      const masker = createStreamMasker(secrets);
      let out = '';
      for (let i = 0; i < text.length; i += size) out += masker.push(text.slice(i, i + size));
      out += masker.flush();
      expect(out, `chunks of ${size}`).toBe(maskSecrets(text, secrets));
      expect(out).not.toContain('abcdef');
    }
  });
});

describe('paths a search can reach (story 2.8 review F2)', () => {
  const cwd = join(tmpdir(), 'ogden-agents-repo');
  const search = (rawInput: Record<string, unknown>) => pathsOf({ toolCallId: 't', kind: 'search', rawInput }, cwd);

  it('names an absolute or ~ pattern as given, resolves a .. pattern against its folder, and names cwd for a search without one', () => {
    expect(search({ pattern: 'src/**/*.ts' })).toEqual([cwd]);
    expect(search({ pattern: 'src/**/*.ts', path: 'src' })).toEqual(['src']);
    expect(search({ pattern: '/Users/x/.ssh/*' })).toEqual(['/Users/x/.ssh/*', cwd]);
    expect(search({ pattern: '~/x/*' })).toEqual(['~/x/*', cwd]);
    expect(search({ pattern: '../../x/*' })).toEqual([join(cwd, '..', '..', 'x', '*'), cwd]);
    expect(search({ pattern: 'TODO', glob: '../secrets/*', path: 'src' })).toEqual(['src', join('src', '..', 'secrets', '*')]);
    expect(search({ pattern: '../x', path: '~/a' })).toEqual(['~/a']);
    expect(pathsOf({ toolCallId: 't', kind: 'read', rawInput: { file_path: 'a.ts' } }, cwd)).toEqual(['a.ts']);
  });
});
