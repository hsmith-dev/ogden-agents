/**
 * The agent setup use-case (story 9.1): every supported agent's install and
 * sign-in state, and signing in with the user's own account through each
 * agent's {@link AgentSetupPort}. Core names no agent (AD-1): the ports do.
 *
 * Only core appends events (AD-11): each sign-in state change becomes an
 * `agent.auth_changed` event, which never carries the sign-in URL, a pasted
 * code or a key (AD-15, AD-16). The URL goes back only to the caller of
 * {@link AgentSetup.signIn}, for its `no-store` response.
 *
 * One sign-in runs per agent: starting a new one cancels the one before.
 *
 * Install (story 9.3): one install per agent at a time, only when the user
 * asks. Its start, throttled progress, completion and failure become
 * `agent.install_*` events with plain words only (the port's details go to
 * `onFailure`, for the log); the last failure is shown until the agent is
 * found installed or another install starts.
 *
 * API keys (story 9.2, AD-16): a key is checked with the agent's free verify
 * call, stored through {@link SecretStorePort} under `agent-api-key/<agentId>`
 * and kept in memory for {@link AgentSetup.agentEnv}, which puts it in the
 * agent's chat environment only while the subscription is known to be signed
 * out (the agent itself would prefer the key over the subscription). A key
 * in the server's own environment (`inheritedEnv`) follows the same rule; a
 * saved key comes before it. The key is never evented, logged or returned:
 * {@link AgentSetup.list} says only whether one is saved and its last 4
 * characters, or that one comes from the environment.
 */
import {
  AGENTS_STREAM,
  SignInCodeRequest,
  type AgentAuthMethodKind,
  type AgentAuthState,
  type AgentSetupStatus,
  type SignInResponse,
} from '@ogden-agents/shared';
import type { AgentInstallProgress, AgentPortStatus, AgentSetupPort, AgentSignIn, AgentSubscriptionState, ApiKeyVerification } from './agent-setup-port.js';
import { ApiKeyRefusedError, CoreError, NotFoundError, SecretsUnavailableError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { SecretStorePort } from './secret-store-port.js';
import { PROGRESS_INTERVAL_MS } from './toolchain.js';

/** The secret name an agent's API key is stored under. */
export const apiKeySecretName = (agentId: string) => `agent-api-key/${agentId}`;

/**
 * An agent setup step that failed, with plain words for the user in
 * `message` (never a secret). Adapters throw it when a sign-in can't start.
 */
export class AgentSetupError extends CoreError {
  override readonly name = 'AgentSetupError';
  /** For the log only (an install's step and npm's error code, say); never a secret, a URL or the agent's output. */
  readonly details: Readonly<Record<string, unknown>>;
  constructor(message: string, options: { cause?: unknown; details?: Record<string, unknown> } = {}) {
    super('agent_setup_failed', message);
    this.details = options.details ?? {};
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** A sign-in code was sent, but no sign-in that takes one is in progress for the agent. */
export class SignInNotPendingError extends CoreError {
  override readonly name = 'SignInNotPendingError';
  constructor(agentId: string) {
    super('sign_in_not_pending', `no sign-in is in progress for ${agentId}`);
  }
}

export interface AgentSetup {
  /**
   * Reads each agent's saved API key from the secret store, and the
   * subscription state of each agent that has one. Call once before serving.
   * Never throws: an unreadable store means no key (the failure is reported).
   */
  load(): Promise<void>;
  /**
   * Every supported agent's setup, with a sign-in in progress or the last
   * failure laid over what its port reports, and its API key's state
   * (never the key). Refreshes the subscription state.
   */
  list(): Promise<AgentSetupStatus[]>;
  /**
   * Checks `apiKey` with the agent's free verify call and stores it. Rejects
   * with `ValidationError` (a malformed key, or an agent that takes none),
   * `ApiKeyRefusedError` (nothing stored) or `SecretsUnavailableError`
   * (no keychain; nothing stored). A key that couldn't be checked is saved.
   */
  setApiKey(agentId: string, apiKey: string): Promise<void>;
  /** Removes the agent's API key. Idempotent. Rejects with `SecretsUnavailableError` when the store can't be used. */
  deleteApiKey(agentId: string): Promise<void>;
  /**
   * What the agent's chat process gets on top of its environment: the API
   * key under the port's variable name, only while its subscription is known
   * to be signed out; otherwise nothing. Never logged.
   */
  agentEnv(agentId: string): Record<string, string>;
  /**
   * Re-reads the agent's subscription state when it has a key (saved or from
   * the environment) and the last reading is older than `maxAgeMs`, so a
   * sign-in made outside the app stops the key being used before the next
   * chat starts. Bounded by the port's own status timeout; a failure means
   * `unknown` (no key). Never throws.
   */
  refreshIfStale(agentId: string, maxAgeMs: number): Promise<void>;
  /**
   * Starts signing in to `agentId`, cancelling a sign-in already running for
   * it. Resolves with `signing_in` and the URL to open (a secret: only for a
   * `no-store` response), or `failed` when it couldn't start (the reason is
   * in the event and in {@link list}).
   */
  signIn(agentId: string): Promise<SignInResponse>;
  /** Types a code the user pasted into the running sign-in. Never logged, evented or stored. */
  submitCode(agentId: string, code: string): Promise<void>;
  /** Stops the running sign-in, if there is one. Idempotent. */
  cancelSignIn(agentId: string): Promise<void>;
  /**
   * Starts installing `agentId`, only when the user asks, unless it is
   * already installed or an install is running (`started: false`, with its
   * status). Returns at once; progress and the outcome arrive as
   * `agent.install_*` events.
   */
  install(agentId: string): Promise<{ started: boolean; agent: AgentSetupStatus }>;
  /** Resolves once no install is running (tests, shutdown). */
  settled(): Promise<void>;
  /** Stops every sign-in (server stop). Appends nothing. */
  dispose(): Promise<void>;
}

export interface AgentSetupOptions {
  /** Called with every failure, for the log. Never carries the URL, a code, a key or the agent's output. */
  onFailure?: (agentId: string, step: string, error: unknown) => void;
  /** Where API keys are kept (AD-16). Without it, saving a key is refused as {@link SecretsUnavailableError}. */
  secrets?: SecretStorePort;
  /**
   * The server's own environment, read at each use: an agent's key variable
   * set there (any case) is used under the same precedence rule as a saved
   * key, which comes first. Never logged.
   */
  inheritedEnv?: () => Readonly<Record<string, string | undefined>>;
  /** The clock for the subscription state's age and install progress throttling. Default `Date.now`. */
  now?: () => number;
  /** Minimum time between two install progress events. Default {@link PROGRESS_INTERVAL_MS}. */
  progressIntervalMs?: number;
}

/** A saved API key, in memory only. `unchecked`: the provider couldn't be asked when it was saved (not kept across a restart). */
interface SavedKey {
  value: string;
  unchecked: boolean;
}

/** The subscription state a port reports, or the one derived from its status (see `AgentPortStatus`). */
function subscriptionOf(status: AgentPortStatus): AgentSubscriptionState {
  if (status.subscription !== undefined) return status.subscription;
  if (status.auth === 'signed_in' && status.method !== 'api_key') return 'signed_in';
  if (status.install === 'installed' && status.auth === 'needs_sign_in' && status.reason === undefined) return 'signed_out';
  return 'unknown';
}

/** The port status as core shows it: no subscription state, which never leaves core. */
function shown(reported: AgentPortStatus): AgentSetupStatus {
  const { subscription: _subscription, ...rest } = reported;
  return rest;
}

/** `status` while an install runs: its progress in place of a reason or a size. */
function installingStatus(status: AgentSetupStatus, progress: AgentInstallProgress): AgentSetupStatus {
  const { reason: _reason, installSize: _size, method: _method, ...rest } = status;
  return { ...rest, install: 'installing', progress: { step: progress.step, percent: progress.percent } };
}

interface Flight {
  /** Set once the port's `signIn` resolved. */
  handle: AgentSignIn | undefined;
  /** Cancelled (or superseded, or disposed) before or after the handle arrived. */
  stopped: boolean;
}

export function createAgentSetup(events: EventLog, ports: readonly AgentSetupPort[], options: AgentSetupOptions = {}): AgentSetup {
  const byId = new Map(ports.map((port) => [port.agentId, port]));
  const flights = new Map<string, Flight>();
  /** The last failed sign-in's plain reason, shown until the next sign-in starts or the agent reports signed in. */
  const lastFailure = new Map<string, string>();
  /** Each agent's saved API key, read from the secret store at `load()` and kept in step with it. */
  const keys = new Map<string, SavedKey>();
  /** Each agent's subscription state, as last read; missing means `unknown`. */
  const subscriptions = new Map<string, AgentSubscriptionState>();
  /** When each agent's subscription state was last read. */
  const readAt = new Map<string, number>();
  /** A refresh under way per agent, so concurrent chats share one status read. */
  const refreshing = new Map<string, Promise<void>>();
  /** Each agent's key writes (save or remove), run one at a time in call order; settles, never rejects. */
  const keyWrites = new Map<string, Promise<void>>();
  /** Runs `write` after the agent's earlier key writes have finished (failed ones too); other agents' writes don't wait. */
  const serially = <T>(agentId: string, write: () => Promise<T>): Promise<T> => {
    const result = (keyWrites.get(agentId) ?? Promise.resolve()).then(write);
    const done = result.then(
      () => undefined,
      () => undefined,
    );
    keyWrites.set(agentId, done);
    void done.then(() => {
      if (keyWrites.get(agentId) === done) keyWrites.delete(agentId);
    });
    return result;
  };
  /** Agents whose last key write failed (a timeout may still complete): re-read from the store at each `list()` until a write succeeds. */
  const resync = new Set<string>();
  const now = options.now ?? Date.now;
  const progressInterval = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  /** Each running install's latest progress, and when it is done. */
  const installs = new Map<string, { progress: AgentInstallProgress; done: Promise<void> }>();
  /** The last failed install's plain reason, shown until the agent is found installed or another install starts. */
  const installFailure = new Map<string, string>();
  /** Aborted by `dispose`, so a verify call in flight stops with the server. */
  const lifetime = new AbortController();
  let disposed = false;

  const portFor = (agentId: string): AgentSetupPort => {
    const port = byId.get(agentId);
    if (port === undefined) throw new NotFoundError('agent', agentId);
    return port;
  };

  const failed = (port: AgentSetupPort) => `${port.displayName} couldn't finish signing in. Try again.`;

  const report = (agentId: string, step: string, error: unknown) => {
    try {
      options.onFailure?.(agentId, step, error);
    } catch {
      // Logging must never change the outcome.
    }
  };

  const announce = (agentId: string, state: AgentAuthState, extra: { method?: AgentAuthMethodKind; reason?: string } = {}) => {
    if (disposed) return;
    try {
      events.append({ type: 'agent.auth_changed', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId, state, ...extra } });
    } catch (error) {
      // Only a closed log (the server is stopping) lands here.
      report(agentId, 'append', error);
    }
  };

  const setSubscription = (agentId: string, state: AgentSubscriptionState) => {
    subscriptions.set(agentId, state);
    readAt.set(agentId, now());
  };

  /** The agent's key variable in the server's own environment, whatever its case; `undefined` when unset or empty. */
  const inheritedKey = (port: AgentSetupPort): string | undefined => {
    const name = port.apiKey?.envName;
    if (name === undefined || options.inheritedEnv === undefined) return undefined;
    const env = options.inheritedEnv();
    const exact = env[name];
    if (exact !== undefined && exact !== '') return exact;
    for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === name.toUpperCase() && value !== undefined && value !== '') return value;
    return undefined;
  };

  /** The key the agent would use: the saved one, else the one from the environment. */
  const keyFor = (port: AgentSetupPort): string | undefined => keys.get(port.agentId)?.value ?? inheritedKey(port);

  /** Makes the in-memory key match the store. `false` when the store couldn't be read (memory is left as it was). */
  const syncFromStore = async (port: AgentSetupPort): Promise<boolean> => {
    if (options.secrets === undefined) return false;
    let value: string | undefined;
    try {
      value = await options.secrets.get(apiKeySecretName(port.agentId));
    } catch (error) {
      report(port.agentId, 'read_api_key', error);
      return false;
    }
    const known = keys.get(port.agentId);
    if (value === undefined || value === '') keys.delete(port.agentId);
    else if (known?.value !== value) keys.set(port.agentId, { value, unchecked: false });
    return true;
  };

  /** The subscription state `port.status()` reports now; `unknown` when it throws. */
  const readSubscription = async (port: AgentSetupPort): Promise<AgentSubscriptionState> => {
    let state: AgentSubscriptionState;
    try {
      state = subscriptionOf(await port.status());
    } catch (error) {
      report(port.agentId, 'status', error);
      state = 'unknown';
    }
    setSubscription(port.agentId, state);
    return state;
  };

  /** The secrets store, or the refusal a missing one means. */
  const store = (): SecretStorePort => {
    if (options.secrets === undefined) throw new SecretsUnavailableError();
    return options.secrets;
  };

  /** A store failure as `SecretsUnavailableError`, reported by its code only. */
  const unavailable = (agentId: string, step: string, error: unknown): SecretsUnavailableError => {
    report(agentId, step, error);
    return error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' });
  };

  /** Whether the agent's key is in use: there is one, and the subscription is known to be signed out. */
  const keyInUse = (port: AgentSetupPort) => keyFor(port) !== undefined && subscriptions.get(port.agentId) === 'signed_out';

  /** The API key's state and its effect on the sign-in state, laid over what the port reports. Never the key. */
  const withApiKey = (port: AgentSetupPort, status: AgentSetupStatus): AgentSetupStatus => {
    if (port.apiKey === undefined) return status;
    const key = keys.get(port.agentId);
    const fromEnvironment = key === undefined && inheritedKey(port) !== undefined;
    if (key === undefined && !fromEnvironment) return { ...status, apiKey: { saved: false } };
    const apiKey =
      key === undefined
        ? { saved: false, fromEnvironment: true }
        : { saved: true, lastFour: key.value.slice(-4), ...(key.unchecked ? { unchecked: true } : {}) };
    const subscription = subscriptions.get(port.agentId) ?? 'unknown';
    // A sign-in under way keeps its own state; the key takes over again if it doesn't finish.
    if (status.install !== 'installed' || status.auth === 'signing_in') return { ...status, apiKey };
    if (subscription === 'signed_out') {
      const { reason: _reason, ...rest } = status;
      return { ...rest, auth: 'signed_in', method: 'api_key', apiKey };
    }
    if (subscription === 'unknown' && status.auth !== 'failed') {
      return { ...status, reason: `Ogden Agents couldn't check your ${port.displayName} sign-in, so your API key isn't in use.`, apiKey };
    }
    return { ...status, apiKey };
  };

  /** Appends an install event, unless the server is stopping. */
  const appendInstall = (agentId: string, event: Parameters<EventLog['append']>[0]) => {
    if (disposed) return;
    try {
      events.append(event);
    } catch (error) {
      report(agentId, 'append', error);
    }
  };

  /** One agent's setup as `list` shows it. */
  const statusFor = async (port: AgentSetupPort): Promise<AgentSetupStatus> => {
    // A key write that failed (timed out) may have completed since: show what the store holds.
    if (resync.has(port.agentId)) await syncFromStore(port);
    let status: AgentSetupStatus;
    try {
      const reported = await port.status();
      setSubscription(port.agentId, subscriptionOf(reported));
      status = shown(reported);
    } catch (error) {
      report(port.agentId, 'status', error);
      setSubscription(port.agentId, 'unknown');
      status = {
        agentId: port.agentId,
        displayName: port.displayName,
        install: 'not_installed',
        version: null,
        auth: 'needs_sign_in',
        reason: `Ogden Agents couldn't check ${port.displayName}. Try again.`,
      };
    }
    const install = installs.get(port.agentId);
    if (install !== undefined) return withApiKey(port, installingStatus(status, install.progress));
    if (status.install === 'installed') installFailure.delete(port.agentId);
    else {
      const failure = installFailure.get(port.agentId);
      if (failure !== undefined) return withApiKey(port, { ...status, install: 'failed', reason: failure });
    }
    if (flights.has(port.agentId)) {
      const { reason: _reason, method: _method, ...rest } = status;
      return withApiKey(port, { ...rest, auth: 'signing_in' });
    }
    const failure = lastFailure.get(port.agentId);
    if (status.auth === 'signed_in') lastFailure.delete(port.agentId);
    else if (failure !== undefined) return withApiKey(port, { ...status, auth: 'failed', reason: failure });
    return withApiKey(port, status);
  };

  /** Runs the port's install, turning what it reports into events. Never throws. */
  const runInstall = async (port: AgentSetupPort, progress: AgentInstallProgress): Promise<void> => {
    const agentId = port.agentId;
    let lastEmitted = Number.NEGATIVE_INFINITY;
    /** The step and percent last sent; the same pair is never sent twice. */
    let emitted: string | undefined;
    const key = () => `${progress.step}\u0000${progress.percent ?? ''}`;
    const emit = () => {
      lastEmitted = now();
      emitted = key();
      appendInstall(agentId, { type: 'agent.install_progress', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId, step: progress.step, percent: progress.percent } });
    };
    try {
      const { version } = await port.install((next) => {
        progress.step = next.step;
        progress.percent = next.percent === null ? null : Math.max(0, Math.min(100, next.percent));
        if (key() === emitted) return;
        if (progress.percent === 100 || now() - lastEmitted >= progressInterval) emit();
      });
      // The last step always goes out, even when it was throttled.
      if (key() !== emitted) emit();
      // Read the new install's status before announcing it, so the page's refetch finds it installed.
      await readSubscription(port);
      installFailure.delete(agentId);
      appendInstall(agentId, {
        type: 'agent.install_completed',
        workspaceId: null,
        streamId: AGENTS_STREAM,
        payload: { agentId, ...(version === null ? {} : { version }) },
      });
    } catch (error) {
      report(agentId, 'install', error);
      const reason = error instanceof AgentSetupError ? error.message : `${port.displayName} couldn't be installed. Try again.`;
      installFailure.set(agentId, reason);
      appendInstall(agentId, { type: 'agent.install_failed', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId, reason } });
    }
  };

  const stop = async (flight: Flight) => {
    flight.stopped = true;
    try {
      await flight.handle?.cancel();
    } catch {
      // Cancelling is best effort; the adapter's own timeout still stops it.
    }
  };

  const follow = (agentId: string, port: AgentSetupPort, flight: Flight, handle: AgentSignIn) => {
    handle.done.then(
      (outcome) => {
        if (flights.get(agentId) !== flight) return;
        flights.delete(agentId);
        if (outcome === 'signed_in') {
          lastFailure.delete(agentId);
          // The subscription now comes first: a saved key stops being used.
          setSubscription(agentId, 'signed_in');
          announce(agentId, 'signed_in', { method: 'subscription' });
        } else if (outcome === 'failed') {
          lastFailure.set(agentId, failed(port));
          announce(agentId, 'failed', { reason: failed(port) });
        } else {
          announce(agentId, 'needs_sign_in');
        }
        if (outcome !== 'signed_in' && keyFor(port) !== undefined) void readSubscription(port);
      },
      (error: unknown) => {
        report(agentId, 'sign_in', error);
        if (flights.get(agentId) !== flight) return;
        flights.delete(agentId);
        lastFailure.set(agentId, failed(port));
        announce(agentId, 'failed', { reason: failed(port) });
      },
    );
  };

  return {
    async load() {
      await Promise.all(
        ports.map(async (port) => {
          if (port.apiKey === undefined) return;
          await syncFromStore(port);
          // Only an agent with a key (saved or from the environment) needs its subscription before the first chat.
          if (keyFor(port) !== undefined) await readSubscription(port);
        }),
      );
    },

    async list() {
      return Promise.all(ports.map(statusFor));
    },

    async install(agentId) {
      const port = portFor(agentId);
      if (disposed) throw new AgentSetupError(`${port.displayName} couldn't be installed. Try again.`);
      if (installs.has(agentId)) return { started: false, agent: await statusFor(port) };
      // Claimed before any await, so two clicks start one install.
      const progress: AgentInstallProgress = { step: `Installing ${port.displayName}`, percent: 0 };
      let release!: () => void;
      installs.set(agentId, { progress, done: new Promise<void>((resolve) => (release = resolve)) });
      let detected: AgentPortStatus;
      try {
        detected = await port.status();
      } catch (error) {
        report(agentId, 'status', error);
        detected = { agentId, displayName: port.displayName, install: 'not_installed', version: null, auth: 'needs_sign_in' };
      }
      if (detected.install === 'installed' || disposed) {
        installs.delete(agentId);
        release();
        return { started: false, agent: await statusFor(port) };
      }
      installFailure.delete(agentId);
      appendInstall(agentId, { type: 'agent.install_started', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId } });
      void runInstall(port, progress).finally(() => {
        installs.delete(agentId);
        release();
      });
      return { started: true, agent: withApiKey(port, installingStatus(shown(detected), progress)) };
    },

    async settled() {
      for (;;) {
        const running = [...installs.values()];
        if (running.length === 0) return;
        await Promise.all(running.map((install) => install.done));
      }
    },

    async setApiKey(agentId, apiKey) {
      const port = portFor(agentId);
      const support = port.apiKey;
      if (support === undefined) throw new ValidationError(`${port.displayName} can't use an API key.`, []);
      const value = apiKey.trim();
      // The value is never echoed, not even in the error.
      const problem = support.check(value);
      if (problem !== undefined) throw new ValidationError(problem, []);
      const secrets = store();
      // One at a time per agent, check included, so the store and the card end on the later call.
      return serially(agentId, async () => {
        let verification: ApiKeyVerification;
        try {
          verification = await support.verify(value, lifetime.signal);
        } catch (error) {
          report(agentId, 'verify_api_key', error);
          verification = 'unchecked';
        }
        if (verification === 'refused') throw new ApiKeyRefusedError();
        if (disposed) throw new SecretsUnavailableError(undefined, { cause: 'stopping' });

        const wasInUse = keyInUse(port);
        try {
          await secrets.set(apiKeySecretName(agentId), value);
        } catch (error) {
          const refusal = unavailable(agentId, 'save_api_key', error);
          // A write that timed out may have landed (or still land): match memory to the store.
          resync.add(agentId);
          await syncFromStore(port);
          if (keyFor(port) !== undefined) await readSubscription(port);
          throw refusal;
        }
        resync.delete(agentId);
        keys.set(agentId, { value, unchecked: verification === 'unchecked' });
        // Subscription first: the key is used only when the subscription is known to be signed out.
        const subscription = await readSubscription(port);
        if (subscription === 'signed_out' && !wasInUse) announce(agentId, 'signed_in', { method: 'api_key' });
      });
    },

    async deleteApiKey(agentId) {
      const port = portFor(agentId);
      if (port.apiKey === undefined) return;
      const secrets = store();
      const name = apiKeySecretName(agentId);
      return serially(agentId, async () => {
        const wasInUse = keyInUse(port);
        try {
          await secrets.delete(name);
        } catch (error) {
          const refusal = unavailable(agentId, 'delete_api_key', error);
          resync.add(agentId);
          await syncFromStore(port);
          if (keyFor(port) !== undefined) await readSubscription(port);
          throw refusal;
        }
        resync.delete(agentId);
        // Re-read, so the card shows what the store holds now; unreadable counts as deleted.
        if (!(await syncFromStore(port))) keys.delete(agentId);
        await readSubscription(port);
        if (wasInUse && !keyInUse(port)) announce(agentId, 'needs_sign_in');
      });
    },

    agentEnv(agentId) {
      const port = byId.get(agentId);
      if (port?.apiKey === undefined || subscriptions.get(agentId) !== 'signed_out') return {};
      const key = keyFor(port);
      return key === undefined ? {} : { [port.apiKey.envName]: key };
    },

    async refreshIfStale(agentId, maxAgeMs) {
      const port = byId.get(agentId);
      if (port?.apiKey === undefined || keyFor(port) === undefined) return;
      const at = readAt.get(agentId);
      if (at !== undefined && now() - at < maxAgeMs) return;
      let running = refreshing.get(agentId);
      if (running === undefined) {
        running = readSubscription(port).then(
          () => undefined,
          () => undefined,
        );
        refreshing.set(agentId, running);
        void running.finally(() => refreshing.delete(agentId));
      }
      await running;
    },

    async signIn(agentId) {
      const port = portFor(agentId);
      if (disposed) throw new AgentSetupError(failed(port));
      const previous = flights.get(agentId);
      const flight: Flight = { handle: undefined, stopped: false };
      // Claimed before any await, so two clicks run one sign-in.
      flights.set(agentId, flight);
      lastFailure.delete(agentId);
      if (previous !== undefined) await stop(previous);
      announce(agentId, 'signing_in');

      let handle: AgentSignIn;
      try {
        handle = await port.signIn();
      } catch (error) {
        report(agentId, 'start', error);
        if (flights.get(agentId) !== flight) return { state: 'needs_sign_in', url: null };
        flights.delete(agentId);
        const reason = error instanceof AgentSetupError ? error.message : failed(port);
        lastFailure.set(agentId, reason);
        announce(agentId, 'failed', { reason });
        return { state: 'failed', url: null };
      }
      if (flight.stopped || flights.get(agentId) !== flight) {
        // Cancelled, superseded or disposed while it started.
        await handle.cancel().catch(() => {});
        return { state: 'needs_sign_in', url: null };
      }
      flight.handle = handle;
      follow(agentId, port, flight, handle);
      return { state: 'signing_in', url: handle.url };
    },

    async submitCode(agentId, code) {
      portFor(agentId);
      const parsed = SignInCodeRequest.safeParse({ code });
      // The code is never echoed, not even in the error.
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'That is not a sign-in code.', []);
      const handle = flights.get(agentId)?.handle;
      if (handle?.submitCode === undefined) throw new SignInNotPendingError(agentId);
      try {
        await handle.submitCode(parsed.data.code);
      } catch (error) {
        report(agentId, 'submit_code', error);
        throw new SignInNotPendingError(agentId);
      }
    },

    async cancelSignIn(agentId) {
      portFor(agentId);
      const flight = flights.get(agentId);
      if (flight === undefined) return;
      flights.delete(agentId);
      await stop(flight);
      announce(agentId, 'needs_sign_in');
    },

    async dispose() {
      disposed = true;
      lifetime.abort();
      const running = [...flights.values()];
      flights.clear();
      await Promise.all(running.map(stop));
    },
  };
}
