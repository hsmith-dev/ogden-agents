/**
 * The agent setup use-case (story 9.1): sign-in states become
 * `agent.auth_changed` events that never carry the URL or a code, one
 * sign-in runs per agent, and cancel, failure and dispose behave.
 */
import { AGENTS_STREAM, type AgentSetupStatus, type CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentSetupError,
  NotFoundError,
  SignInNotPendingError,
  ValidationError,
  createAgentSetup,
  type AgentSetupPort,
  type AgentSignIn,
} from '../src/index.js';
import { openTestCore } from './helpers.js';

const SECRET_URL = 'https://claude.ai/oauth/authorize?code=true&state=very-secret-state';

/** A port whose sign-ins the test finishes by hand. */
function fakePort(overrides: Partial<AgentSetupPort> = {}) {
  const started: Array<{ finish: (outcome: 'signed_in' | 'failed' | 'cancelled') => void; cancelled: boolean; codes: string[] }> = [];
  let auth: AgentSetupStatus['auth'] = 'needs_sign_in';
  const port: AgentSetupPort = {
    agentId: 'claude-code',
    displayName: 'Claude Code',
    status: async () => ({ agentId: 'claude-code', displayName: 'Claude Code', install: 'installed', version: null, auth }),
    install: async () => ({ version: null }),
    signIn: async (): Promise<AgentSignIn> => {
      let finish!: (outcome: 'signed_in' | 'failed' | 'cancelled') => void;
      const done = new Promise<'signed_in' | 'failed' | 'cancelled'>((resolve) => (finish = resolve));
      const entry = { finish: (outcome: 'signed_in' | 'failed' | 'cancelled') => {
        if (outcome === 'signed_in') auth = 'signed_in';
        finish(outcome);
      }, cancelled: false, codes: [] as string[] };
      started.push(entry);
      return {
        url: SECRET_URL,
        done,
        cancel: async () => {
          entry.cancelled = true;
          finish('cancelled');
        },
        submitCode: async (code) => void entry.codes.push(code),
      };
    },
    ...overrides,
  };
  return { port, started };
}

function authEvents(events: readonly CoreEvent[]) {
  return events.filter((event) => event.type === 'agent.auth_changed');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('agent setup', () => {
  it('a sign-in appends signing_in then signed_in, and no event ever carries the URL or the code', async () => {
    const core = openTestCore();
    const { port, started } = fakePort();
    const setup = createAgentSetup(core.events, [port]);
    expect(await setup.signIn('claude-code')).toEqual({ state: 'signing_in', url: SECRET_URL });
    expect((await setup.list())[0]!.auth).toBe('signing_in');
    await setup.submitCode('claude-code', 'pasted-code-123');
    expect(started[0]!.codes).toEqual(['pasted-code-123']);
    started[0]!.finish('signed_in');
    await settle();

    const events = authEvents(core.events.readAfter(0));
    expect(events.map((event) => event.payload.state)).toEqual(['signing_in', 'signed_in']);
    expect(events[1]!).toMatchObject({ workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId: 'claude-code', method: 'subscription' } });
    const everything = JSON.stringify(core.events.readAfter(0));
    expect(everything).not.toContain('claude.ai');
    expect(everything).not.toContain('very-secret-state');
    expect(everything).not.toContain('pasted-code-123');
    expect((await setup.list())[0]!.auth).toBe('signed_in');
  });

  it('a failed sign-in appends failed with the plain reason, shown by list until the next one', async () => {
    const core = openTestCore();
    const { port, started } = fakePort();
    const setup = createAgentSetup(core.events, [port]);
    await setup.signIn('claude-code');
    started[0]!.finish('failed');
    await settle();
    const reason = "Claude Code couldn't finish signing in. Try again.";
    expect(authEvents(core.events.readAfter(0)).at(-1)!.payload).toEqual({ agentId: 'claude-code', state: 'failed', reason });
    expect((await setup.list())[0]).toMatchObject({ auth: 'failed', reason });
    await setup.signIn('claude-code');
    expect((await setup.list())[0]!.reason).toBeUndefined();
  });

  it("a sign-in that can't start is failed with the adapter's plain reason", async () => {
    const core = openTestCore();
    const failures: string[] = [];
    const { port } = fakePort({
      signIn: async () => {
        throw new AgentSetupError("Sign-in isn't available on this computer: no pty");
      },
    });
    const setup = createAgentSetup(core.events, [port], { onFailure: (_agent, step) => failures.push(step) });
    expect(await setup.signIn('claude-code')).toEqual({ state: 'failed', url: null });
    expect(authEvents(core.events.readAfter(0)).map((event) => event.payload)).toEqual([
      { agentId: 'claude-code', state: 'signing_in' },
      { agentId: 'claude-code', state: 'failed', reason: "Sign-in isn't available on this computer: no pty" },
    ]);
    expect(failures).toEqual(['start']);
  });

  it('cancel stops the sign-in and appends needs_sign_in; cancelling again is harmless', async () => {
    const core = openTestCore();
    const { port, started } = fakePort();
    const setup = createAgentSetup(core.events, [port]);
    await setup.signIn('claude-code');
    await setup.cancelSignIn('claude-code');
    await setup.cancelSignIn('claude-code');
    await settle();
    expect(started[0]!.cancelled).toBe(true);
    expect(authEvents(core.events.readAfter(0)).map((event) => event.payload.state)).toEqual(['signing_in', 'needs_sign_in']);
    await expect(setup.submitCode('claude-code', 'abc')).rejects.toBeInstanceOf(SignInNotPendingError);
  });

  it('a new sign-in cancels the one before; only the new one reports', async () => {
    const core = openTestCore();
    const { port, started } = fakePort();
    const setup = createAgentSetup(core.events, [port]);
    await setup.signIn('claude-code');
    await setup.signIn('claude-code');
    expect(started[0]!.cancelled).toBe(true);
    started[1]!.finish('signed_in');
    await settle();
    expect(authEvents(core.events.readAfter(0)).map((event) => event.payload.state)).toEqual(['signing_in', 'signing_in', 'signed_in']);
  });

  it('an unknown agent is not found; a malformed code is refused without being echoed', async () => {
    const core = openTestCore();
    const { port } = fakePort();
    const setup = createAgentSetup(core.events, [port]);
    await expect(setup.signIn('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(setup.cancelSignIn('nope')).rejects.toBeInstanceOf(NotFoundError);
    await setup.signIn('claude-code');
    const bad = 'secret code; rm -rf';
    const refusal = await setup.submitCode('claude-code', bad).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ValidationError);
    expect((refusal as Error).message).not.toContain('secret');
  });

  it('dispose stops running sign-ins, including one still starting, and appends nothing', async () => {
    const core = openTestCore();
    let release!: () => void;
    let cancelled = false;
    const { port } = fakePort({
      signIn: () =>
        new Promise<AgentSignIn>((resolve) => {
          release = () =>
            resolve({ url: SECRET_URL, done: new Promise(() => {}), cancel: async () => void (cancelled = true) });
        }),
    });
    const setup = createAgentSetup(core.events, [port]);
    const starting = setup.signIn('claude-code');
    await settle();
    await setup.dispose();
    release();
    expect(await starting).toEqual({ state: 'needs_sign_in', url: null });
    expect(cancelled).toBe(true);
    expect(authEvents(core.events.readAfter(0)).map((event) => event.payload.state)).toEqual(['signing_in']);
  });
});
