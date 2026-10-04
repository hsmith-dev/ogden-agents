/**
 * Story 3.4 (E3-R5): no handoff between the chat and the agent's own
 * terminal leaves a session stuck. Each row of the plan's matrix ends with
 * the chat driving (`ui`, idle, a message gets a reply) or the terminal
 * driving with a live CLI, and no CLI left unkilled. A scripted agent and a
 * fake terminal with the failure modes (an `open` that rejects, a CLI that
 * ignores its kill, one that crashes on start); fake timers for the bounds.
 * Core depends on no adapter, so the fake terminal is core's own
 * (`support/fake-terminal.ts`, with `terminal-memory`'s modes; story 3.9).
 */
import type { CoreEvent, SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChat,
  InvalidOperationError,
  SessionNotIdleError,
  TERMINAL_CLOSE_WAIT_MS,
  TERMINAL_EXIT_GRACE_MS,
  TERMINAL_IMPORT_PENDING_REF,
  TERMINAL_RELEASE_TIMEOUT_MS,
  TERMINAL_STEP_TIMEOUT_MS,
  TerminalHandoffError,
  TerminalUnavailableError,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type AgentTerminalResume,
  type AgentTranscriptTurn,
  type Core,
  type TerminalPort,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';
import { fakeTerminal as handoffTerminal } from './support/fake-terminal.js';

afterEach(() => {
  vi.useRealTimers();
});

/** Lets pending promise callbacks run (`setImmediate` is never faked here). */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

const useFakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

/** The CLI's record as the test grows it: one exchange per `say`, sharing its user turn's id. */
function cliRecord() {
  const turns: AgentTranscriptTurn[] = [];
  let next = 0;
  return {
    turns,
    say(text: string, reply?: string) {
      const id = `u${++next}`;
      turns.push({ id, role: 'user', text });
      if (reply !== undefined) turns.push({ id, role: 'agent', text: reply });
      return id;
    },
  };
}

/**
 * A Claude-Code-like agent: it answers `re: <text>` (at once, or when the
 * test calls `end` while `hold` is on), resumes its sessions, and its CLI
 * reads back `record`. `closing` makes its process slow (or never) to stop.
 */
function handoffAgent(record = cliRecord(), resume: Partial<AgentTerminalResume> = {}) {
  let hold = false;
  const ends: Array<() => void> = [];
  let closing: () => Promise<void> = async () => {};
  let closed = 0;
  let sessions = 0;
  const reopens: string[] = [];
  const transcriptReads: number[] = [];
  const open = (agentSessionId: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const emit = (event: AgentEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        emit({ type: 'state', state: 'working' });
        if (hold) await new Promise<void>((resolve) => ends.push(resolve));
        emit({ type: 'message_chunk', text: `re: ${text}` });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {
        closed++;
        await closing();
      },
    };
  };
  const port: AgentPort = {
    displayName: 'Claude Code',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async () => open(`agent-${++sessions}`),
    async reopenSession(input) {
      reopens.push(input.agentSessionId);
      return { session: open(input.agentSessionId), restored: 'resumed' };
    },
    terminalResume: {
      command: async (id, env) => ({ file: 'claude', args: ['--resume', id], env: { ...env } }),
      locate: async () => ({ found: true }),
      transcript: async () => {
        transcriptReads.push(Date.now());
        return [...record.turns];
      },
      ...resume,
    },
  };
  return {
    port,
    record,
    reopens,
    transcriptReads,
    closed: () => closed,
    holdReplies: (on: boolean) => (hold = on),
    end: () => ends.shift()?.(),
    slowClose: (gate: () => Promise<void>) => (closing = gate),
  };
}

/** A chat that answered once, on `terminal`, logging internal errors. */
async function answeredOnce(terminal = handoffTerminal(), agent = handoffAgent(), core: Core = openTestCore()) {
  const internal: unknown[] = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent.port),
    terminal: terminal.port,
    onInternalError: (_sessionId, error) => internal.push(error),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = chat.createChatSession(workspace.id);
  agent.record.say('first question', 're: first question');
  chat.sendMessage(workspace.id, session.id, 'first question');
  await chat.settled();
  return { core, chat, agent, terminal, workspace, session, internal };
}

const sessionEvents = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);

const driverChanges = (core: Core, sessionId: SessionId) =>
  sessionEvents(core, sessionId).flatMap((e) => (e.type === 'session.driver_changed' ? [[e.payload.previous, e.payload.driver, e.payload.cause]] : []));

const messages = (core: Core, sessionId: SessionId) =>
  sessionEvents(core, sessionId).flatMap((e) => (e.type === 'session.message_completed' ? [[e.payload.role, e.payload.content, e.payload.origin]] : []));

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

/**
 * Never stuck: the chat drives, idle, no terminal is held, every CLI opened
 * has exited and was killed (its tree with it), and a message gets a reply.
 */
async function expectChatDrives(setup: Awaited<ReturnType<typeof answeredOnce>>, reply = 'are you there?') {
  const { core, chat, terminal, workspace, session } = setup;
  await chat.settled();
  const now = core.entities.getSession(session.id)!;
  expect(now.driver).toBe('ui');
  expect(now.state).toBe('idle');
  expect(chat.attachTerminal(session.id)).toBeUndefined();
  for (const cli of terminal.processes) {
    expect(cli.kills()).toBeGreaterThan(0);
  }
  chat.sendMessage(workspace.id, session.id, reply);
  await chat.settled();
  expect(messages(core, session.id).at(-1)).toEqual(['agent', `re: ${reply}`, undefined]);
}

describe('the handoff never leaves a session stuck (story 3.4)', () => {
  it('a switch while working or with queued messages is refused, and nothing changes or is interrupted', async () => {
    const setup = await answeredOnce();
    const { core, chat, agent, terminal, workspace, session } = setup;
    agent.holdReplies(true);
    chat.sendMessage(workspace.id, session.id, 'working');
    await settle();
    const queued = chat.sendMessage(workspace.id, session.id, 'queued');
    expect(queued.queued).toBe(true);
    const before = sessionEvents(core, session.id).length;
    expect(await refusal(chat.switchDriver(workspace.id, session.id, 'terminal'))).toBeInstanceOf(SessionNotIdleError);
    expect(sessionEvents(core, session.id)).toHaveLength(before);
    expect(agent.closed()).toBe(0);
    expect(terminal.processes).toEqual([]);
    agent.end();
    await settle();
    agent.end();
    agent.holdReplies(false);
    await chat.settled();
    expect(messages(core, session.id).slice(-2)).toEqual([
      ['user', 'queued', undefined],
      ['agent', 're: queued', undefined],
    ]);
    await expectChatDrives(setup);
    await chat.close();
  });

  it('a message during a switch either way is refused as not idle, and stored nowhere', async () => {
    let release!: () => void;
    const setup = await answeredOnce(handoffTerminal(), handoffAgent(cliRecord(), {}));
    const { core, chat, agent, workspace, session } = setup;
    const gate = () => new Promise<void>((resolve) => (release = resolve));
    agent.port.terminalResume!.locate = async () => (await gate(), { found: true });
    const toTerminal = chat.switchDriver(workspace.id, session.id, 'terminal');
    await settle();
    const before = sessionEvents(core, session.id).length;
    expect(() => chat.sendMessage(workspace.id, session.id, 'mid-switch')).toThrow(SessionNotIdleError);
    release();
    expect((await toTerminal).driver).toBe('terminal');

    // Back: the driver still reads `terminal` until the switch is done; the refusal is the switch's.
    agent.port.terminalResume!.transcript = async () => (await gate(), [...agent.record.turns]);
    const toChat = chat.switchDriver(workspace.id, session.id, 'ui');
    await settle();
    expect(() => chat.sendMessage(workspace.id, session.id, 'mid-switch')).toThrow(SessionNotIdleError);
    release();
    expect((await toChat).driver).toBe('ui');
    expect(JSON.stringify(sessionEvents(core, session.id).slice(before))).not.toContain('mid-switch');
    await expectChatDrives(setup);
    await chat.close();
  });

  it('two switch requests race: the second is refused, and only one driver change is appended each way', async () => {
    const setup = await answeredOnce();
    const { core, chat, workspace, session } = setup;
    const first = chat.switchDriver(workspace.id, session.id, 'terminal');
    expect(await refusal(chat.switchDriver(workspace.id, session.id, 'terminal'))).toBeInstanceOf(SessionNotIdleError);
    expect(await refusal(chat.switchDriver(workspace.id, session.id, 'ui'))).toBeInstanceOf(SessionNotIdleError);
    expect((await first).driver).toBe('terminal');
    const back = chat.switchDriver(workspace.id, session.id, 'ui');
    expect(await refusal(chat.switchDriver(workspace.id, session.id, 'ui'))).toBeInstanceOf(SessionNotIdleError);
    expect((await back).driver).toBe('ui');
    expect(driverChanges(core, session.id)).toEqual([
      ['ui', 'terminal', 'user'],
      ['terminal', 'ui', 'user'],
    ]);
    await expectChatDrives(setup);
    await chat.close();
  });

  it(`an agent that doesn't stop within ${TERMINAL_RELEASE_TIMEOUT_MS} ms: refused "still stopping", the chat drives, idle; its next message waits for it`, async () => {
    useFakeTimers();
    const setup = await answeredOnce();
    const { core, chat, agent, terminal, workspace, session, internal } = setup;
    let stopped!: () => void;
    agent.slowClose(() => new Promise<void>((resolve) => (stopped = resolve)));
    const switching = refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
    await settle();
    await vi.advanceTimersByTimeAsync(TERMINAL_RELEASE_TIMEOUT_MS - 1);
    expect(core.entities.getSession(session.id)!.driver).toBe('ui');
    await vi.advanceTimersByTimeAsync(1);
    const error = await switching;
    expect(error).toBeInstanceOf(SessionNotIdleError);
    expect((error as Error).message).toBe('Claude Code is still stopping. Try again.');
    expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_release_timeout']);
    expect(terminal.processes).toEqual([]);
    expect(driverChanges(core, session.id)).toEqual([]);
    // Once it has stopped, the chat goes on.
    stopped();
    agent.slowClose(async () => {});
    vi.useRealTimers();
    await expectChatDrives(setup);
    await chat.close();
  });

  it('an agent that stops after the bound: the switch is still refused, then one log line says when it stopped (story 3.9; 3.4 review F5)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const setup = await answeredOnce();
    const { core, chat, agent, terminal, workspace, session, internal } = setup;
    let stopped!: () => void;
    agent.slowClose(() => new Promise<void>((resolve) => (stopped = resolve)));
    const switching = refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
    await settle();
    await vi.advanceTimersByTimeAsync(TERMINAL_RELEASE_TIMEOUT_MS);
    expect(await switching).toBeInstanceOf(SessionNotIdleError);
    expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_release_timeout']);
    await vi.advanceTimersByTimeAsync(4_000);
    stopped();
    await settle();
    expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_release_timeout', 'TerminalHandoffError: terminal_release_late (14000 ms)']);
    expect((internal[1] as TerminalHandoffError).elapsedMs).toBe(14_000);
    // Nothing else changed: no terminal, no driver change, and the chat goes on.
    expect(terminal.processes).toEqual([]);
    expect(driverChanges(core, session.id)).toEqual([]);
    agent.slowClose(async () => {});
    vi.useRealTimers();
    await expectChatDrives(setup);
    expect(internal).toHaveLength(2);
    await chat.close();
  });

  it('a CLI that fails to spawn: refused terminal_unavailable in plain words; the chat drives, and its next message resumes the session', async () => {
    const setup = await answeredOnce(handoffTerminal({ openError: new Error('posix_spawnp failed: /usr/local/bin/claude') }));
    const { core, chat, agent, workspace, session, internal } = setup;
    const error = await refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
    expect(error).toBeInstanceOf(TerminalUnavailableError);
    expect((error as TerminalUnavailableError).terminal).toEqual({ available: false, code: 'pty_unavailable', reason: "Claude Code's terminal couldn't start. Try again." });
    expect(String(internal[0])).toContain('posix_spawnp');
    expect(driverChanges(core, session.id)).toEqual([]);
    await expectChatDrives(setup);
    expect(agent.reopens).toEqual(['agent-1']);
    await chat.close();
  });

  it('a CLI that crashes later: its tree is killed, its turns imported, the agent notes the exit code, and the chat drives (cli_exited)', async () => {
    const setup = await answeredOnce();
    const { core, chat, agent, terminal, workspace, session } = setup;
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    const ends: Array<number | null> = [];
    chat.attachTerminal(session.id)!.onEnd(({ exitCode }) => ends.push(exitCode));
    agent.record.say('typed in the terminal', 'answered in the terminal');
    terminal.processes[0]!.exit(70);
    expect(ends).toEqual([70]);
    // Until it is done, the session is between drivers.
    expect(() => chat.sendMessage(workspace.id, session.id, 'too soon')).toThrow(SessionNotIdleError);
    await chat.settled();
    expect(terminal.processes[0]!.kills()).toBe(1);
    expect(messages(core, session.id).slice(-3)).toEqual([
      ['user', 'typed in the terminal', 'terminal'],
      ['agent', 'answered in the terminal', undefined],
      ['agent', "Claude Code's terminal closed unexpectedly (exit code 70).", undefined],
    ]);
    expect(driverChanges(core, session.id)).toEqual([
      ['ui', 'terminal', 'user'],
      ['terminal', 'ui', 'cli_exited'],
    ]);
    expect(core.entities.getSession(session.id)!.adapterRefs[TERMINAL_IMPORT_PENDING_REF]).toBe('');
    await expectChatDrives(setup);
    await chat.close();
  });

  it('a CLI that leaves by itself (exit 0): its turns are imported, with no note', async () => {
    const setup = await answeredOnce();
    const { core, chat, agent, terminal, workspace, session } = setup;
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    agent.record.say('bye now', 'bye');
    terminal.processes[0]!.exit(0);
    await chat.settled();
    expect(messages(core, session.id).slice(-2)).toEqual([
      ['user', 'bye now', 'terminal'],
      ['agent', 'bye', undefined],
    ]);
    expect(driverChanges(core, session.id).at(-1)).toEqual(['terminal', 'ui', 'cli_exited']);
    await expectChatDrives(setup);
    await chat.close();
  });

  for (const lateExitAtOnce of [false, true]) {
    it(`a CLI that crashes on start (its exit reported ${lateExitAtOnce ? 'as core listens' : 'a moment later'}): the chat drives with the note, and the CLI is killed`, async () => {
      const setup = await answeredOnce(handoffTerminal({ exitOnOpen: 70, lateExitAtOnce }));
      const { core, chat, terminal, workspace, session } = setup;
      const switched = await chat.switchDriver(workspace.id, session.id, 'terminal');
      // Reported while the switch still held the session: that switch ends at `ui` itself.
      if (lateExitAtOnce) expect(switched.driver).toBe('ui');
      await settle();
      await chat.settled();
      expect(terminal.processes[0]!.kills()).toBe(1);
      expect(messages(core, session.id).at(-1)).toEqual(['agent', "Claude Code's terminal closed unexpectedly (exit code 70).", undefined]);
      expect(driverChanges(core, session.id)).toEqual([
        ['ui', 'terminal', 'user'],
        ['terminal', 'ui', 'cli_exited'],
      ]);
      await expectChatDrives(setup);
      await chat.close();
    });
  }

  it('a CLI that exits while switching back: one driver change (user), one import', async () => {
    const setup = await answeredOnce();
    const { core, chat, agent, terminal, workspace, session } = setup;
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    agent.record.say('typed', 'answered');
    const reads = agent.transcriptReads.length;
    const back = chat.switchDriver(workspace.id, session.id, 'ui');
    terminal.processes[0]!.exit(0);
    expect((await back).driver).toBe('ui');
    await chat.settled();
    expect(agent.transcriptReads.length - reads).toBe(1);
    expect(messages(core, session.id).filter(([, content]) => content === 'typed')).toHaveLength(1);
    expect(driverChanges(core, session.id)).toEqual([
      ['ui', 'terminal', 'user'],
      ['terminal', 'ui', 'user'],
    ]);
    await expectChatDrives(setup);
    await chat.close();
  });

  it(`a CLI that ignores its kill: the switch back completes after ${TERMINAL_EXIT_GRACE_MS} ms, with a code in the log`, async () => {
    useFakeTimers();
    const setup = await answeredOnce(handoffTerminal({ exitOnKill: false }));
    const { core, chat, terminal, workspace, session, internal } = setup;
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    let done = false;
    const back = chat.switchDriver(workspace.id, session.id, 'ui').then((s) => ((done = true), s));
    await settle();
    await vi.advanceTimersByTimeAsync(TERMINAL_EXIT_GRACE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await back).driver).toBe('ui');
    expect(terminal.processes[0]!.kills()).toBe(1);
    expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_exit_timeout']);
    expect(driverChanges(core, session.id).at(-1)).toEqual(['terminal', 'ui', 'user']);
    vi.useRealTimers();
    await expectChatDrives(setup);
    await chat.close();
  });

  it('a failing import after a crash: the chat still drives, with only a code logged', async () => {
    const setup = await answeredOnce();
    const { chat, agent, terminal, workspace, session, internal } = setup;
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    agent.port.terminalResume!.transcript = async () => {
      throw new Error('EACCES /home/someone/.claude/projects/x.jsonl');
    };
    terminal.processes[0]!.exit(1);
    await chat.settled();
    expect(internal.map(String)).toEqual(['TerminalImportError: terminal_import_unreadable']);
    agent.port.terminalResume!.transcript = async () => [...agent.record.turns];
    await expectChatDrives(setup);
    await chat.close();
  });

  describe('a close during a switch waits for it; the caller is told the server is stopping, and no terminal is left', () => {
    const stages = ['releasing the agent', 'locating the CLI', 'opening the terminal'] as const;
    for (const stage of stages) {
      it(stage, async () => {
        let release!: () => void;
        const gate = () => new Promise<void>((resolve) => (release = resolve));
        const agent = handoffAgent();
        const terminal = handoffTerminal(stage === 'opening the terminal' ? { opening: gate } : {});
        if (stage === 'locating the CLI') agent.port.terminalResume!.locate = async () => (await gate(), { found: true });
        const { core, chat, workspace, session } = await answeredOnce(terminal, agent);
        if (stage === 'releasing the agent') agent.slowClose(gate);
        const switching = refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
        await settle();
        let closed = false;
        const closing = chat.close().then(() => (closed = true));
        await settle();
        expect(closed).toBe(false);
        release();
        await closing;
        expect(await switching).toBeInstanceOf(InvalidOperationError);
        expect(core.entities.getSession(session.id)!.driver).toBe('ui');
        expect(chat.attachTerminal(session.id)).toBeUndefined();
        for (const cli of terminal.processes) expect(cli.exitCode()).not.toBeUndefined();
      });
    }

    it('switching back: it completes, then the close finds no terminal', async () => {
      let release!: () => void;
      const setup = await answeredOnce();
      const { core, chat, agent, terminal, workspace, session } = setup;
      await chat.switchDriver(workspace.id, session.id, 'terminal');
      agent.port.terminalResume!.transcript = async () => (await new Promise<void>((resolve) => (release = resolve)), []);
      const back = chat.switchDriver(workspace.id, session.id, 'ui');
      await settle();
      const closing = chat.close();
      await settle();
      release();
      await closing;
      expect((await back).driver).toBe('ui');
      expect(driverChanges(core, session.id)).toEqual([
        ['ui', 'terminal', 'user'],
        ['terminal', 'ui', 'user'],
      ]);
      expect(terminal.processes[0]!.exitCode()).toBeNull();
    });

    it(`a check that hangs: the close waits only until the switch gives up (${TERMINAL_STEP_TIMEOUT_MS} ms, within ${TERMINAL_CLOSE_WAIT_MS} ms)`, async () => {
      useFakeTimers();
      const setup = await answeredOnce();
      const { core, chat, agent, workspace, session, internal } = setup;
      agent.port.terminalResume!.locate = () => new Promise(() => undefined);
      const switching = refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
      await settle();
      let closed = false;
      const closing = chat.close().then(() => (closed = true));
      await settle();
      await vi.advanceTimersByTimeAsync(TERMINAL_STEP_TIMEOUT_MS - 1);
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(await switching).toBeInstanceOf(TerminalUnavailableError);
      expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_open_timeout']);
      expect(core.entities.getSession(session.id)!.driver).toBe('ui');
    });
  });

  describe(`every wait under the lock is bounded (${TERMINAL_STEP_TIMEOUT_MS} ms; review F1): the lock is released and settled() resolves`, () => {
    const hang = () => new Promise<never>(() => undefined);
    const cases: Array<[string, (agent: ReturnType<typeof handoffAgent>) => TerminalPort | undefined]> = [
      ['node-pty’s check', () => ({ available: hang, open: hang })],
      ['the CLI lookup', (agent) => ((agent.port.terminalResume!.locate = hang), undefined)],
      ['the CLI’s command', (agent) => ((agent.port.terminalResume!.command = hang), undefined)],
    ];
    for (const [name, hangIt] of cases) {
      it(`${name} hangs: refused as too slow, with a code; the chat drives and answers`, async () => {
        useFakeTimers();
        const agent = handoffAgent();
        const terminal = handoffTerminal();
        const setup = await answeredOnce(terminal, agent);
        const { core, chat, workspace, session, internal } = setup;
        const port = hangIt(agent);
        if (port !== undefined) Object.assign(terminal.port, port);
        const switching = refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
        await settle();
        expect(() => chat.sendMessage(workspace.id, session.id, 'too soon')).toThrow(SessionNotIdleError);
        await vi.advanceTimersByTimeAsync(TERMINAL_STEP_TIMEOUT_MS);
        const error = (await switching) as TerminalUnavailableError;
        expect(error).toBeInstanceOf(TerminalUnavailableError);
        expect(error.terminal).toEqual({ available: false, code: 'pty_unavailable', reason: "Claude Code's terminal took too long to start. Try again." });
        expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_open_timeout']);
        // The agent was never released: nothing was stopped for a switch that didn't happen.
        expect(agent.closed()).toBe(0);
        await chat.settled();
        expect(driverChanges(core, session.id)).toEqual([]);
        vi.useRealTimers();
        await expectChatDrives(setup);
        await chat.close();
      });
    }

    it('the spawn hangs: refused as too slow; a CLI that starts after all is killed at once', async () => {
      useFakeTimers();
      let started!: () => void;
      const terminal = handoffTerminal({ opening: () => new Promise<void>((resolve) => (started = resolve)) });
      const setup = await answeredOnce(terminal);
      const { chat, workspace, session, internal } = setup;
      const switching = refusal(chat.switchDriver(workspace.id, session.id, 'terminal'));
      await settle();
      await vi.advanceTimersByTimeAsync(TERMINAL_STEP_TIMEOUT_MS);
      expect(await switching).toBeInstanceOf(TerminalUnavailableError);
      expect(internal.map(String)).toEqual(['TerminalHandoffError: terminal_open_timeout']);
      started();
      await settle();
      expect(terminal.processes[0]!.kills()).toBe(1);
      expect(terminal.processes[0]!.exitCode()).toBeNull();
      vi.useRealTimers();
      await expectChatDrives(setup);
      await chat.close();
    });

    it('a read of the CLI’s record that hangs: the switch goes on, either way, as with an unreadable record', async () => {
      useFakeTimers();
      const setup = await answeredOnce();
      const { core, chat, agent, workspace, session, internal } = setup;
      agent.port.terminalResume!.transcript = hang;
      const toTerminal = chat.switchDriver(workspace.id, session.id, 'terminal');
      await settle();
      await vi.advanceTimersByTimeAsync(TERMINAL_STEP_TIMEOUT_MS);
      expect((await toTerminal).driver).toBe('terminal');
      const back = chat.switchDriver(workspace.id, session.id, 'ui');
      await settle();
      await vi.advanceTimersByTimeAsync(TERMINAL_STEP_TIMEOUT_MS);
      expect((await back).driver).toBe('ui');
      await chat.settled();
      expect(internal.map(String)).toEqual(['TerminalImportError: terminal_import_unreadable', 'TerminalImportError: terminal_import_unreadable']);
      expect(driverChanges(core, session.id)).toEqual([
        ['ui', 'terminal', 'user'],
        ['terminal', 'ui', 'user'],
      ]);
      vi.useRealTimers();
      await expectChatDrives(setup);
      await chat.close();
    });
  });

  it('a start whose crash-import sweep fails still starts; the failure is logged (review F4)', async () => {
    const core = openTestCore();
    const internal: unknown[] = [];
    const broken = new Proxy(core.entities, {
      get: (target, key, receiver) =>
        key === 'listWorkspaces'
          ? () => {
              throw new Error('database is locked');
            }
          : Reflect.get(target, key, receiver),
    });
    const chat = createChat({
      dataDir: tempDir('ogden-agents-data-'),
      entities: broken,
      sessionEvents: core.sessionEvents,
      agents: soleAgent(handoffAgent().port),
      terminal: handoffTerminal().port,
      onInternalError: (_sessionId, error) => internal.push(error),
    });
    expect(internal.map(String)).toEqual(['Error: database is locked']);
    await chat.settled();
    await chat.close();
  });

  it('a clean stop imports the terminal’s turns before giving the chat back (server_stopped), and kills the CLI', async () => {
    const { core, chat, agent, terminal, workspace, session } = await answeredOnce();
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    agent.record.say('typed before the stop', 'answered before the stop');
    await chat.close();
    expect(terminal.processes[0]!.kills()).toBe(1);
    expect(messages(core, session.id).slice(-2)).toEqual([
      ['user', 'typed before the stop', 'terminal'],
      ['agent', 'answered before the stop', undefined],
    ]);
    expect(driverChanges(core, session.id).at(-1)).toEqual(['terminal', 'ui', 'server_stopped']);
    expect(core.entities.getSession(session.id)!.adapterRefs[TERMINAL_IMPORT_PENDING_REF]).toBe('');
  });

  it('a start after a crash that left a chat in the terminal: the chat drives (server_restarted), idle, and the turns typed come in once', async () => {
    const core = openTestCore();
    const first = await answeredOnce(handoffTerminal(), handoffAgent(), core);
    await first.chat.switchDriver(first.workspace.id, first.session.id, 'terminal');
    first.agent.record.say('typed before the crash', 'answered before the crash');
    // The server dies: no close. The next start gives the chat back, then the chat imports.
    expect(core.entities.getSession(first.session.id)!.adapterRefs[TERMINAL_IMPORT_PENDING_REF]).toBe('1');
    core.entities.releaseTerminalDrivers();
    const internal: unknown[] = [];
    const next = createChat({
      dataDir: tempDir('ogden-agents-data-'),
      entities: core.entities,
      sessionEvents: core.sessionEvents,
      agents: soleAgent(first.agent.port),
      terminal: handoffTerminal().port,
      onInternalError: (_sessionId, error) => internal.push(error),
    });
    // The import holds the session, as a switch does.
    expect(() => next.sendMessage(first.workspace.id, first.session.id, 'too soon')).toThrow(SessionNotIdleError);
    await next.settled();
    expect(messages(core, first.session.id).slice(-2)).toEqual([
      ['user', 'typed before the crash', 'terminal'],
      ['agent', 'answered before the crash', undefined],
    ]);
    expect(core.entities.getSession(first.session.id)!.adapterRefs[TERMINAL_IMPORT_PENDING_REF]).toBe('');
    expect(driverChanges(core, first.session.id).at(-1)).toEqual(['terminal', 'ui', 'server_restarted']);
    expect(core.entities.getSession(first.session.id)!.state).toBe('idle');
    next.sendMessage(first.workspace.id, first.session.id, 'still there?');
    await next.settled();
    expect(messages(core, first.session.id).at(-1)).toEqual(['agent', 're: still there?', undefined]);
    // Once: another start imports nothing again.
    const count = messages(core, first.session.id).length;
    const again = createChat({ dataDir: tempDir('ogden-agents-data-'), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(first.agent.port)});
    await again.settled();
    expect(messages(core, first.session.id)).toHaveLength(count);
    expect(internal).toEqual([]);
    await Promise.all([next.close(), again.close()]);
    // The abandoned chat's own terminal: stop it as its (dead) server would have.
    await first.chat.close();
  });

  it('a terminal_unavailable reason from node-pty or the CLI lookup never carries a path, a stack or a second line', async () => {
    const reasons: string[] = [];
    for (const reason of ['Cannot find module /opt/x/pty.node', 'bad\nsecond line', '~/lib/x', 'C:\\x\\pty.node', 'boom at load (index.js:1:2)', 'not on drive D: here', 'ANTHROPIC_API_KEY=sk-ant-secret']) {
      const { chat, workspace, session } = await answeredOnce(handoffTerminal({ available: { ok: false, reason } }));
      const error = (await refusal(chat.switchDriver(workspace.id, session.id, 'terminal'))) as TerminalUnavailableError;
      reasons.push(error.message);
      await chat.close();
    }
    expect(new Set(reasons)).toEqual(new Set(["The terminal couldn't start on this computer: the terminal module could not be loaded"]));
    const plain = await answeredOnce(handoffTerminal({ available: { ok: false, reason: 'no prebuilt terminal for this platform' } }));
    expect(((await refusal(plain.chat.switchDriver(plain.workspace.id, plain.session.id, 'terminal'))) as Error).message).toBe(
      "The terminal couldn't start on this computer: no prebuilt terminal for this platform",
    );
    await plain.chat.close();
    const long = await answeredOnce(handoffTerminal({ available: { ok: false, reason: 'x'.repeat(500) } }));
    const cut = ((await refusal(long.chat.switchDriver(long.workspace.id, long.session.id, 'terminal'))) as Error).message;
    expect(cut).toBe(`The terminal couldn't start on this computer: ${'x'.repeat(197)}...`);
    await long.chat.close();
    const lookup = await answeredOnce(handoffTerminal(), handoffAgent(cliRecord(), { locate: async () => ({ found: false, reason: 'not at /usr/local/bin/claude' }) }));
    expect(((await refusal(lookup.chat.switchDriver(lookup.workspace.id, lookup.session.id, 'terminal'))) as Error).message).toBe(
      "Claude Code's terminal couldn't be found on this computer.",
    );
    await lookup.chat.close();
  });
});
