/**
 * The agent setup use-case (story 9.1): sign-in states become
 * `agent.auth_changed` events that never carry the URL or a code, one
 * sign-in runs per agent, and cancel, failure and dispose behave. API keys
 * (story 9.2): checked, stored through the secret store, and put in the chat
 * environment only while the subscription is known to be signed out.
 */
import { AGENTS_STREAM, type AgentSetupStatus, type CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentSetupError,
  ApiKeyRefusedError,
  KEYCHAIN_NO_ANSWER_MESSAGE,
  NotFoundError,
  SecretsUnavailableError,
  SignInNotPendingError,
  ValidationError,
  createAgentSetup,
  type AgentApiKeySupport,
  type AgentPortStatus,
  type AgentSetupPort,
  type AgentSignIn,
  type AgentSubscriptionState,
  type ApiKeyVerification,
  type SecretStorePort,
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

const API_KEY = 'sk-ant-api03-core_TEST_ONLY_0123456789abcdefWXYZ';

/** An in-memory secret store the test can break and inspect. */
function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let failing = false;
  const guard = () => {
    if (failing) throw new SecretsUnavailableError(undefined, { cause: 'GenericFailure' });
  };
  const store: SecretStorePort = {
    backend: 'memory',
    get: async (name) => (guard(), values.get(name)),
    set: async (name, value) => void (guard(), values.set(name, value)),
    delete: async (name) => void (guard(), values.delete(name)),
  };
  return { store, values, fail: (on = true) => void (failing = on) };
}

/** A port that can use an API key, whose subscription and verify outcome the test sets. */
function keyPort(options: { subscription?: AgentSubscriptionState; verify?: ApiKeyVerification | (() => Promise<ApiKeyVerification>) } = {}) {
  let subscription: AgentSubscriptionState | 'throws' = options.subscription ?? 'signed_out';
  const verified: string[] = [];
  const apiKey: AgentApiKeySupport = {
    envName: 'FAKE_API_KEY',
    check: (value) => (/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(value) ? undefined : "That doesn't look like an Anthropic API key."),
    verify: async (value) => {
      verified.push(value);
      const outcome = options.verify ?? 'ok';
      return typeof outcome === 'function' ? outcome() : outcome;
    },
  };
  const { port } = fakePort({
    apiKey,
    status: async (): Promise<AgentPortStatus> => {
      if (subscription === 'throws') throw new Error('status unreadable');
      return {
        agentId: 'claude-code',
        displayName: 'Claude Code',
        install: 'installed',
        version: null,
        auth: subscription === 'signed_in' ? 'signed_in' : 'needs_sign_in',
        ...(subscription === 'signed_in' ? { method: 'subscription' as const } : {}),
        ...(subscription === 'unknown' ? { reason: 'could not check' } : {}),
        subscription,
      };
    },
  });
  return { port, verified, setSubscription: (next: AgentSubscriptionState | 'throws') => void (subscription = next) };
}

describe('agent setup: API keys (story 9.2)', () => {
  it('signed out: saving stores the key under agent-api-key/<id>, injects it, and appends signed_in api_key without the key', async () => {
    const core = openTestCore();
    const secrets = memoryStore();
    const { port, verified } = keyPort({ subscription: 'signed_out' });
    const setup = createAgentSetup(core.events, [port], { secrets: secrets.store });
    await setup.load();
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]).toMatchObject({ auth: 'needs_sign_in', apiKey: { saved: false } });

    await setup.setApiKey('claude-code', `  ${API_KEY}  `);
    expect(verified).toEqual([API_KEY]);
    expect(secrets.values.get('agent-api-key/claude-code')).toBe(API_KEY);
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
    const [status] = await setup.list();
    expect(status).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: 'WXYZ' } });
    expect(status!.apiKey!.unchecked).toBeUndefined();
    expect(status!.reason).toBeUndefined();

    const events = authEvents(core.events.readAfter(0));
    expect(events.map((event) => event.payload)).toEqual([{ agentId: 'claude-code', state: 'signed_in', method: 'api_key' }]);
    const everything = JSON.stringify(core.events.readAfter(0));
    expect(everything).not.toContain(API_KEY);
    expect(everything).not.toContain('WXYZ');
    expect(JSON.stringify(await setup.list())).not.toContain(API_KEY);
  });

  it('subscription signed in: the key is saved but never injected, and no event is appended', async () => {
    const core = openTestCore();
    const secrets = memoryStore();
    const { port } = keyPort({ subscription: 'signed_in' });
    const setup = createAgentSetup(core.events, [port], { secrets: secrets.store });
    await setup.setApiKey('claude-code', API_KEY);
    expect(secrets.values.get('agent-api-key/claude-code')).toBe(API_KEY);
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]).toMatchObject({ auth: 'signed_in', method: 'subscription', apiKey: { saved: true, lastFour: 'WXYZ' } });
    expect(authEvents(core.events.readAfter(0))).toEqual([]);
  });

  it('unknown sign-in (unreadable, or a status that throws): never injected, and list says why', async () => {
    const core = openTestCore();
    const { port, setSubscription } = keyPort({ subscription: 'unknown' });
    const setup = createAgentSetup(core.events, [port], { secrets: memoryStore().store });
    await setup.setApiKey('claude-code', API_KEY);
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]).toMatchObject({
      auth: 'needs_sign_in',
      reason: "Ogden Agents couldn't check your Claude Code sign-in, so your API key isn't in use.",
      apiKey: { saved: true, lastFour: 'WXYZ' },
    });
    setSubscription('throws');
    await setup.list();
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect(authEvents(core.events.readAfter(0))).toEqual([]);
  });

  it('the cache follows list(): a subscription signed in elsewhere stops the injection at the next refresh', async () => {
    const core = openTestCore();
    const { port, setSubscription } = keyPort({ subscription: 'signed_out' });
    const setup = createAgentSetup(core.events, [port], { secrets: memoryStore().store });
    await setup.setApiKey('claude-code', API_KEY);
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
    setSubscription('signed_in');
    // A known limit: until the next refresh the cache still says signed out.
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
    await setup.list();
    expect(setup.agentEnv('claude-code')).toEqual({});
  });

  it('a sign-in that finishes makes the subscription come first at once', async () => {
    const core = openTestCore();
    const { port } = keyPort({ subscription: 'signed_out' });
    let finish!: (outcome: 'signed_in') => void;
    const signingPort: AgentSetupPort = {
      ...port,
      signIn: async () => ({ url: SECRET_URL, done: new Promise((resolve) => (finish = resolve)), cancel: async () => {} }),
    };
    const setup = createAgentSetup(core.events, [signingPort], { secrets: memoryStore().store });
    await setup.setApiKey('claude-code', API_KEY);
    await setup.signIn('claude-code');
    finish('signed_in');
    await settle();
    expect(setup.agentEnv('claude-code')).toEqual({});
  });

  it('load() reads the saved key (the restart path), so the key is in use and list shows its last 4', async () => {
    const core = openTestCore();
    const secrets = memoryStore({ 'agent-api-key/claude-code': API_KEY });
    const { port } = keyPort({ subscription: 'signed_out' });
    const setup = createAgentSetup(core.events, [port], { secrets: secrets.store });
    expect(setup.agentEnv('claude-code')).toEqual({});
    await setup.load();
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
    expect((await setup.list())[0]).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: 'WXYZ' } });
  });

  it('load() with an unusable keychain reports it and carries on with no key', async () => {
    const core = openTestCore();
    const failures: string[] = [];
    const secrets = memoryStore({ 'agent-api-key/claude-code': API_KEY });
    secrets.fail();
    const { port } = keyPort();
    const setup = createAgentSetup(core.events, [port], { secrets: secrets.store, onFailure: (_agent, step) => failures.push(step) });
    await setup.load();
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect(failures).toEqual(['read_api_key']);
  });

  it('a refused key is not stored; a malformed one is refused without a check and never echoed', async () => {
    const core = openTestCore();
    const secrets = memoryStore();
    const refusing = keyPort({ verify: 'refused' });
    const setup = createAgentSetup(core.events, [refusing.port], { secrets: secrets.store });
    await expect(setup.setApiKey('claude-code', API_KEY)).rejects.toBeInstanceOf(ApiKeyRefusedError);
    expect(secrets.values.size).toBe(0);

    for (const bad of ['', '   ', 'not-a-key-at-all-but-long-enough', 'sk-ant-short']) {
      const error = await setup.setApiKey('claude-code', bad).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as Error).message).toBe("That doesn't look like an Anthropic API key.");
    }
    expect(refusing.verified).toEqual([API_KEY]);
    expect(secrets.values.size).toBe(0);
    expect(authEvents(core.events.readAfter(0))).toEqual([]);
  });

  it("a key that couldn't be checked (or whose check threw) is saved, marked unchecked", async () => {
    const core = openTestCore();
    const { port } = keyPort({ verify: async () => { throw new Error(`boom ${API_KEY}`); } });
    const failures: unknown[] = [];
    const setup = createAgentSetup(core.events, [port], { secrets: memoryStore().store, onFailure: (_agent, step) => failures.push(step) });
    await setup.setApiKey('claude-code', API_KEY);
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: true, lastFour: 'WXYZ', unchecked: true });
    expect(failures).toEqual(['verify_api_key']);
    const second = keyPort({ verify: 'unchecked' });
    const other = createAgentSetup(openTestCore().events, [second.port], { secrets: memoryStore().store });
    await other.setApiKey('claude-code', API_KEY);
    expect((await other.list())[0]!.apiKey).toEqual({ saved: true, lastFour: 'WXYZ', unchecked: true });
  });

  it('no keychain: saving is refused with a plain reason and nothing is kept in memory either', async () => {
    const core = openTestCore();
    const secrets = memoryStore();
    secrets.fail();
    const { port } = keyPort();
    const setup = createAgentSetup(core.events, [port], { secrets: secrets.store });
    const error = await setup.setApiKey('claude-code', API_KEY).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretsUnavailableError);
    expect((error as Error).message).toBe("There's no keychain on this computer to keep an API key in. Sign in with your account instead.");
    expect(setup.agentEnv('claude-code')).toEqual({});
    // No store at all is the same refusal.
    const without = createAgentSetup(core.events, [keyPort().port]);
    await expect(without.setApiKey('claude-code', API_KEY)).rejects.toBeInstanceOf(SecretsUnavailableError);
  });

  it('remove deletes the key, re-reads the store, stops the injection and appends needs_sign_in; removing again is harmless', async () => {
    const core = openTestCore();
    const secrets = memoryStore();
    const { port } = keyPort({ subscription: 'signed_out' });
    const setup = createAgentSetup(core.events, [port], { secrets: secrets.store });
    await setup.setApiKey('claude-code', API_KEY);
    await setup.deleteApiKey('claude-code');
    await setup.deleteApiKey('claude-code');
    expect(secrets.values.size).toBe(0);
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]).toMatchObject({ auth: 'needs_sign_in', apiKey: { saved: false } });
    expect(authEvents(core.events.readAfter(0)).map((event) => event.payload)).toEqual([
      { agentId: 'claude-code', state: 'signed_in', method: 'api_key' },
      { agentId: 'claude-code', state: 'needs_sign_in' },
    ]);
    secrets.fail();
    await expect(setup.deleteApiKey('claude-code')).rejects.toBeInstanceOf(SecretsUnavailableError);
  });

  it('an unknown agent is not found; an agent without API key support refuses a key and has no apiKey in list', async () => {
    const core = openTestCore();
    const { port } = fakePort();
    const setup = createAgentSetup(core.events, [port], { secrets: memoryStore().store });
    await expect(setup.setApiKey('nope', API_KEY)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setup.deleteApiKey('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(setup.setApiKey('claude-code', API_KEY)).rejects.toBeInstanceOf(ValidationError);
    await setup.deleteApiKey('claude-code');
    expect((await setup.list())[0]!.apiKey).toBeUndefined();
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect(setup.agentEnv('nope')).toEqual({});
  });

  it("list never passes on the port's subscription field", async () => {
    const core = openTestCore();
    const setup = createAgentSetup(core.events, [keyPort().port], { secrets: memoryStore().store });
    expect((await setup.list())[0]).not.toHaveProperty('subscription');
  });
});

describe('agent setup: API key review fixes (story 9.2)', () => {
  const ENV_KEY = 'sk-ant-api03-core_ENVIRONMENT_0123456789-envK';

  it("F1: a key from the server's environment (any case) is used only signed out, and a saved key comes first", async () => {
    const core = openTestCore();
    const { port, setSubscription } = keyPort({ subscription: 'signed_out' });
    const env: Record<string, string> = { fake_api_key: ENV_KEY };
    const setup = createAgentSetup(core.events, [port], { secrets: memoryStore().store, inheritedEnv: () => env });
    await setup.load();
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: ENV_KEY });
    expect((await setup.list())[0]).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: false, fromEnvironment: true } });

    await setup.setApiKey('claude-code', API_KEY);
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: true, lastFour: 'WXYZ' });

    setSubscription('signed_in');
    await setup.list();
    expect(setup.agentEnv('claude-code')).toEqual({});
    setSubscription('unknown');
    await setup.list();
    expect(setup.agentEnv('claude-code')).toEqual({});
    await setup.deleteApiKey('claude-code');
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: false, fromEnvironment: true });
    // No key anywhere: nothing.
    delete env.fake_api_key;
    setSubscription('signed_out');
    await setup.list();
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain(ENV_KEY);
  });

  it('F2: a write that timed out re-reads the store at once and at each list, so memory matches a late completion', async () => {
    const core = openTestCore();
    const values = new Map<string, string>();
    let land!: () => void;
    const store: SecretStorePort = {
      backend: 'keychain',
      get: async (name) => values.get(name),
      // The prompt is answered after the timeout: the write lands late.
      set: async (name, value) => {
        void new Promise<void>((resolve) => (land = resolve)).then(() => values.set(name, value));
        throw new SecretsUnavailableError(KEYCHAIN_NO_ANSWER_MESSAGE, { cause: 'timeout' });
      },
      delete: async () => {
        throw new SecretsUnavailableError(KEYCHAIN_NO_ANSWER_MESSAGE, { cause: 'timeout' });
      },
    };
    const { port } = keyPort({ subscription: 'signed_out' });
    const setup = createAgentSetup(core.events, [port], { secrets: store });
    const error = await setup.setApiKey('claude-code', API_KEY).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretsUnavailableError);
    expect((error as Error).message).toBe(KEYCHAIN_NO_ANSWER_MESSAGE);
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: false });

    land();
    await settle();
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: true, lastFour: 'WXYZ' });
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });

    // A removal that times out keeps what the store still holds.
    await expect(setup.deleteApiKey('claude-code')).rejects.toMatchObject({ message: KEYCHAIN_NO_ANSWER_MESSAGE });
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: true, lastFour: 'WXYZ' });
  });

  it('F2: a write that timed out but had landed is shown as saved at once', async () => {
    const core = openTestCore();
    const values = new Map<string, string>();
    const store: SecretStorePort = {
      backend: 'keychain',
      get: async (name) => values.get(name),
      set: async (name, value) => {
        values.set(name, value);
        throw new SecretsUnavailableError(KEYCHAIN_NO_ANSWER_MESSAGE, { cause: 'timeout' });
      },
      delete: async (name) => void values.delete(name),
    };
    const setup = createAgentSetup(core.events, [keyPort().port], { secrets: store });
    await expect(setup.setApiKey('claude-code', API_KEY)).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
  });

  it('F4: refreshIfStale re-reads the subscription only when a key exists and the state is older than the limit; a failure means no key', async () => {
    const core = openTestCore();
    let clock = 1_000;
    let reads = 0;
    const { port, setSubscription } = keyPort({ subscription: 'signed_out' });
    const counted: AgentSetupPort = {
      ...port,
      status: async () => {
        reads++;
        return port.status();
      },
    };
    const setup = createAgentSetup(core.events, [counted], { secrets: memoryStore().store, now: () => clock });
    // No key: nothing to refresh.
    await setup.refreshIfStale('claude-code', 30_000);
    expect(reads).toBe(0);
    await setup.setApiKey('claude-code', API_KEY);
    const afterSave = reads;
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });

    setSubscription('signed_in');
    clock += 29_999;
    await setup.refreshIfStale('claude-code', 30_000);
    expect(reads).toBe(afterSave);
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: API_KEY });
    clock += 1;
    // Two chats starting together share one read.
    await Promise.all([setup.refreshIfStale('claude-code', 30_000), setup.refreshIfStale('claude-code', 30_000)]);
    expect(reads).toBe(afterSave + 1);
    expect(setup.agentEnv('claude-code')).toEqual({});

    setSubscription('throws');
    clock += 30_000;
    await setup.refreshIfStale('claude-code', 30_000);
    expect(setup.agentEnv('claude-code')).toEqual({});
    await expect(setup.refreshIfStale('nope', 0)).resolves.toBeUndefined();
  });
});

describe('agent setup: key writes run one at a time per agent (story 9.6; 9.2 review F7)', () => {
  const OTHER_KEY = 'sk-ant-api03-core_TEST_ONLY_9876543210fedcbaQRST';

  /** A keychain whose writes wait until the test lets each one finish, in order; `failNext` makes the next write throw. */
  function slowStore() {
    const values = new Map<string, string>();
    const calls: string[] = [];
    const waiting: Array<() => void> = [];
    let failNext = false;
    const write = async (call: string, apply: () => void) => {
      calls.push(call);
      await new Promise<void>((resolve) => waiting.push(resolve));
      if (failNext) {
        failNext = false;
        throw new SecretsUnavailableError(undefined, { cause: 'GenericFailure' });
      }
      apply();
    };
    const store: SecretStorePort = {
      backend: 'keychain',
      get: async (name) => values.get(name),
      set: (name, value) => write(`set ${name} ${value.slice(-4)}`, () => values.set(name, value)),
      delete: (name) => write(`delete ${name}`, () => void values.delete(name)),
    };
    const finishNext = async () => {
      await expect.poll(() => waiting.length).toBeGreaterThan(0);
      waiting.shift()!();
    };
    return { store, values, calls, finishNext, failNext: () => void (failNext = true) };
  }

  it('a save and a removal for one agent run in call order: the store and the card end on the removal', async () => {
    const core = openTestCore();
    const secrets = slowStore();
    const setup = createAgentSetup(core.events, [keyPort().port], { secrets: secrets.store });
    const saving = setup.setApiKey('claude-code', API_KEY);
    const removing = setup.deleteApiKey('claude-code');
    await expect.poll(() => secrets.calls.length).toBe(1);
    for (let i = 0; i < 5; i++) await settle();
    // The removal waits for the save to finish.
    expect(secrets.calls).toEqual(['set agent-api-key/claude-code WXYZ']);
    await secrets.finishNext();
    await saving;
    await secrets.finishNext();
    await removing;
    expect(secrets.calls).toEqual(['set agent-api-key/claude-code WXYZ', 'delete agent-api-key/claude-code']);
    expect(secrets.values.size).toBe(0);
    expect(setup.agentEnv('claude-code')).toEqual({});
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: false });
  });

  it('two saves end on the later key, and a failed earlier save does not block the next', async () => {
    const core = openTestCore();
    const secrets = slowStore();
    const setup = createAgentSetup(core.events, [keyPort().port], { secrets: secrets.store });
    secrets.failNext();
    const first = setup.setApiKey('claude-code', API_KEY);
    const second = setup.setApiKey('claude-code', OTHER_KEY);
    await secrets.finishNext();
    await expect(first).rejects.toBeInstanceOf(SecretsUnavailableError);
    await secrets.finishNext();
    await second;
    expect(secrets.calls).toEqual(['set agent-api-key/claude-code WXYZ', 'set agent-api-key/claude-code QRST']);
    expect(secrets.values.get('agent-api-key/claude-code')).toBe(OTHER_KEY);
    expect(setup.agentEnv('claude-code')).toEqual({ FAKE_API_KEY: OTHER_KEY });
    expect((await setup.list())[0]!.apiKey).toEqual({ saved: true, lastFour: 'QRST' });
  });

  it("different agents' key writes don't wait for each other", async () => {
    const core = openTestCore();
    const secrets = slowStore();
    const other: AgentSetupPort = { ...keyPort().port, agentId: 'other-agent', displayName: 'Other Agent' };
    const setup = createAgentSetup(core.events, [keyPort().port, other], { secrets: secrets.store });
    const saving = setup.setApiKey('claude-code', API_KEY);
    const savingOther = setup.setApiKey('other-agent', OTHER_KEY);
    await expect.poll(() => secrets.calls.length).toBe(2);
    await secrets.finishNext();
    await secrets.finishNext();
    await Promise.all([saving, savingOther]);
    expect(secrets.values.get('agent-api-key/claude-code')).toBe(API_KEY);
    expect(secrets.values.get('agent-api-key/other-agent')).toBe(OTHER_KEY);
  });
});

describe('agent setup: install (story 9.3)', () => {
  /** A port that is not installed until its install finishes; the test drives each install by hand. */
  function installablePort() {
    let installed = false;
    const runs: Array<{ progress: (step: string, percent: number | null) => void; finish: (version: string) => void; fail: (error: unknown) => void }> = [];
    const { port } = fakePort({
      status: async () => ({ agentId: 'claude-code', displayName: 'Claude Code', install: installed ? 'installed' : 'not_installed', version: installed ? '0.84.0' : null, auth: 'needs_sign_in', ...(installed ? {} : { installSize: 'small' as const }) }),
      install: (onProgress) =>
        new Promise((resolve, reject) => {
          runs.push({
            progress: (step, percent) => onProgress({ step, percent }),
            finish: (version) => {
              installed = true;
              resolve({ version });
            },
            fail: reject,
          });
        }),
    });
    return { port, runs };
  }

  const installEvents = (events: readonly CoreEvent[]) =>
    events.filter((event) => event.type.startsWith('agent.install_')).map((event) => [event.type, (event as { payload: unknown }).payload]);

  it('one install at a time: started, throttled progress, completed, and list follows it', async () => {
    const core = openTestCore();
    const { port, runs } = installablePort();
    let clock = 0;
    const setup = createAgentSetup(core.events, [port], { now: () => clock, progressIntervalMs: 500 });
    const first = await setup.install('claude-code');
    expect(first.started).toBe(true);
    expect(first.agent).toMatchObject({ install: 'installing', progress: { percent: 0 } });
    expect(first.agent.installSize).toBeUndefined();
    // A second click while it runs starts nothing.
    const second = await setup.install('claude-code');
    expect(second).toMatchObject({ started: false, agent: { install: 'installing' } });
    await settle();
    expect(runs).toHaveLength(1);

    runs[0]!.progress('Downloading Claude Code', 10);
    runs[0]!.progress('Downloading Claude Code', 20); // throttled
    clock = 600;
    runs[0]!.progress('Downloading Claude Code', 50);
    expect((await setup.list())[0]).toMatchObject({ install: 'installing', progress: { step: 'Downloading Claude Code', percent: 50 } });
    runs[0]!.progress('Checking Claude Code', 100);
    runs[0]!.finish('0.84.0');
    await setup.settled();
    expect(installEvents(core.events.readAfter(0))).toEqual([
      ['agent.install_started', { agentId: 'claude-code' }],
      ['agent.install_progress', { agentId: 'claude-code', step: 'Downloading Claude Code', percent: 10 }],
      ['agent.install_progress', { agentId: 'claude-code', step: 'Downloading Claude Code', percent: 50 }],
      ['agent.install_progress', { agentId: 'claude-code', step: 'Checking Claude Code', percent: 100 }],
      ['agent.install_completed', { agentId: 'claude-code', version: '0.84.0' }],
    ]);
    expect((await setup.list())[0]).toMatchObject({ install: 'installed', version: '0.84.0', auth: 'needs_sign_in' });
    // Installed: Install starts nothing.
    expect(await setup.install('claude-code')).toMatchObject({ started: false, agent: { install: 'installed' } });
  });

  it('a failed install appends the plain reason (details go to onFailure only), list shows it, and Try again clears it', async () => {
    const core = openTestCore();
    const { port, runs } = installablePort();
    const failures: Array<[string, unknown]> = [];
    const setup = createAgentSetup(core.events, [port], { onFailure: (_agentId, step, error) => failures.push([step, error]) });
    await setup.install('claude-code');
    await settle();
    runs[0]!.fail(new AgentSetupError("The download didn't match the expected files, so nothing was installed. Try again.", { details: { npmCode: 'EINTEGRITY' } }));
    await setup.settled();
    const failed = core.events.readAfter(0).find((event) => event.type === 'agent.install_failed');
    expect(failed?.payload).toEqual({ agentId: 'claude-code', reason: "The download didn't match the expected files, so nothing was installed. Try again." });
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain('EINTEGRITY');
    expect(failures[0]![0]).toBe('install');
    expect((failures[0]![1] as AgentSetupError).details).toEqual({ npmCode: 'EINTEGRITY' });
    expect((await setup.list())[0]).toMatchObject({ install: 'failed', reason: "The download didn't match the expected files, so nothing was installed. Try again." });

    // An unexpected error gets the generic words.
    expect((await setup.install('claude-code')).started).toBe(true);
    expect((await setup.list())[0]!.install).toBe('installing');
    await settle();
    runs[1]!.fail(new Error('/secret/path exploded'));
    await setup.settled();
    expect((await setup.list())[0]!.reason).toBe("Claude Code couldn't be installed. Try again.");
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain('/secret/path');

    await setup.install('claude-code');
    await settle();
    runs[2]!.finish('0.84.0');
    await setup.settled();
    expect((await setup.list())[0]).toMatchObject({ install: 'installed' });
    expect((await setup.list())[0]!.reason).toBeUndefined();
  });

  it('an unknown agent is not found; after dispose an install appends nothing', async () => {
    const core = openTestCore();
    const { port, runs } = installablePort();
    const setup = createAgentSetup(core.events, [port]);
    await expect(setup.install('nope')).rejects.toBeInstanceOf(NotFoundError);
    await setup.install('claude-code');
    await settle();
    await setup.dispose();
    runs[0]!.fail(new AgentSetupError('Installing Claude Code was stopped.'));
    await setup.settled();
    expect(installEvents(core.events.readAfter(0)).map(([type]) => type)).toEqual(['agent.install_started']);
    await expect(setup.install('claude-code')).rejects.toBeInstanceOf(AgentSetupError);
  });
});
