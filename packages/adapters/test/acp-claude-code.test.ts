/**
 * The `acp-claude-code` adapter against the fake ACP agent
 * (`tests/fixtures/fake-acp-agent.mjs`), which speaks real ACP over stdio.
 * No test runs a real agent or touches an account.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError, type AgentEvent, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeCodeAgent, createStreamMasker, findClaudeExecutable, MASKED, maskSecrets, resolveClaudeAgentAcp, secretValues } from '../src/index.js';

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

async function startFake(options: { env?: Record<string, string>; claudeExecutable?: string | null } = {}) {
  const diagnostics: string[] = [];
  const agent = createClaudeCodeAgent({
    adapterPath: FAKE_AGENT,
    claudeExecutable: options.claudeExecutable === undefined ? null : options.claudeExecutable,
    onDiagnostic: (message, fields) => diagnostics.push(`${message} ${JSON.stringify(fields ?? {})}`),
  });
  const session = await agent.startSession({ cwd: tempDir(), env: baseEnv(options.env) });
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
    expect(seen).toEqual(['C:\\Program Files\\Claude\\claude.exe', 'D:\\tools\\claude.exe']);
    const home: string[] = [];
    findClaudeExecutable({ PATH: '' , USERPROFILE: 'C:\\Users\\a' }, { platform: 'win32', isExecutable: (f) => (home.push(f), false) });
    expect(home).toEqual(['C:\\Users\\a\\.local\\bin\\claude.exe', 'C:\\Users\\a\\.claude\\local\\claude.exe']);
  });

  it('on Windows only claude.exe counts', () => {
    const seen: string[] = [];
    findClaudeExecutable({ PATH: 'C:\\tools' }, { platform: 'win32', home: 'C:\\Users\\a', isExecutable: (f) => (seen.push(f), false) });
    expect(seen.every((f) => f.endsWith('claude.exe'))).toBe(true);
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
