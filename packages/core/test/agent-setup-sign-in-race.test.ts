/**
 * A code sent while a sign-in is still starting (story 10.8): `signIn`
 * announces `signing_in` before the port's `signIn` resolves, so the page can
 * offer the code box (and the user can paste) before there is a handle to
 * type into. The code waits for the start, then is delivered, or refused as
 * `SignInNotPendingError` when the start fails or is cancelled meanwhile.
 */
import { describe, expect, it } from 'vitest';
import { AgentSetupError, SignInNotPendingError, createAgentSetup, type AgentSetupPort, type AgentSignIn } from '../src/index.js';
import { openTestCore } from './helpers.js';

const SECRET_URL = 'https://claude.ai/oauth/authorize?code=true&state=very-secret-state';

/** A port whose `signIn` is held until the test resolves or rejects it. */
function heldPort() {
  const codes: string[] = [];
  let cancelled = false;
  let resolveStart!: () => void;
  let rejectStart!: (error: unknown) => void;
  const port: AgentSetupPort = {
    agentId: 'claude-code',
    displayName: 'Claude Code',
    status: async () => ({ agentId: 'claude-code', displayName: 'Claude Code', install: 'installed', version: null, auth: 'needs_sign_in' }),
    install: async () => ({ version: null }),
    signIn: () =>
      new Promise<AgentSignIn>((resolve, reject) => {
        rejectStart = reject;
        resolveStart = () =>
          resolve({
            url: SECRET_URL,
            done: new Promise(() => {}),
            cancel: async () => void (cancelled = true),
            submitCode: async (code) => void codes.push(code),
          });
      }),
  };
  return { port, codes, start: () => resolveStart(), fail: (error: unknown) => rejectStart(error), wasCancelled: () => cancelled };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('agent setup: a code sent while the sign-in starts (story 10.8)', () => {
  it('waits for the handle, then is delivered', async () => {
    const core = openTestCore();
    const held = heldPort();
    const setup = createAgentSetup(core.events, [held.port]);
    const starting = setup.signIn('claude-code');
    await tick();
    expect((await setup.list())[0]!.auth).toBe('signing_in');
    let delivered = false;
    const sending = setup.submitCode('claude-code', 'pasted-code-123').then(() => void (delivered = true));
    await tick();
    expect(delivered).toBe(false);
    held.start();
    await sending;
    expect(held.codes).toEqual(['pasted-code-123']);
    expect(await starting).toEqual({ state: 'signing_in', url: SECRET_URL });
  });

  it('is refused when the start fails meanwhile', async () => {
    const core = openTestCore();
    const held = heldPort();
    const setup = createAgentSetup(core.events, [held.port]);
    const starting = setup.signIn('claude-code');
    await tick();
    const sending = setup.submitCode('claude-code', 'pasted-code-123').catch((error: unknown) => error);
    held.fail(new AgentSetupError("Sign-in isn't available on this computer: no pty"));
    expect(await sending).toBeInstanceOf(SignInNotPendingError);
    expect(await starting).toMatchObject({ state: 'failed' });
    expect(held.codes).toEqual([]);
  });

  it('is refused when the sign-in is cancelled meanwhile, even if the start then resolves', async () => {
    const core = openTestCore();
    const held = heldPort();
    const setup = createAgentSetup(core.events, [held.port]);
    const starting = setup.signIn('claude-code');
    await tick();
    const sending = setup.submitCode('claude-code', 'pasted-code-123').catch((error: unknown) => error);
    await setup.cancelSignIn('claude-code');
    expect(await sending).toBeInstanceOf(SignInNotPendingError);
    held.start();
    expect(await starting).toEqual({ state: 'needs_sign_in', url: null });
    expect(held.wasCancelled()).toBe(true);
    expect(held.codes).toEqual([]);
  });

  it('with no sign-in at all is refused at once, as before', async () => {
    const core = openTestCore();
    const held = heldPort();
    const setup = createAgentSetup(core.events, [held.port]);
    await expect(setup.submitCode('claude-code', 'pasted-code-123')).rejects.toBeInstanceOf(SignInNotPendingError);
  });
});
