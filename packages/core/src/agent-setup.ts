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
 * out (the agent itself would prefer the key over the subscription). A
 * status check that is slow or fails keeps the last confirmed state for
 * {@link LAST_KNOWN_AUTH_MAX_AGE_MS}, then means `unknown` (no key). A key
 * in the server's own environment (`inheritedEnv`) follows the same rule; a
 * saved key comes before it. The key is never evented, logged or returned:
 * {@link AgentSetup.list} says only whether one is saved and its last 4
 * characters, or that one comes from the environment.
 */
import {
  AGENTS_STREAM,
  type AgentAuthMethodKind,
  type AgentAuthState,
  type AgentSetupStatus,
  keyWordOf,
} from '@ogden-agents/shared';
import type { AgentInstallProgress, AgentPortStatus, AgentSetupPort, AgentSubscriptionState, ApiKeyVerification } from './agent-setup-port.js';
import { AgentBusyError, AgentSetupError, LAST_KNOWN_AUTH_MAX_AGE_MS, apiKeySecretName, type AgentSetup, type AgentSetupOptions, type Flight, type SavedKey } from './agent-setup-types.js';
import { ApiKeyRefusedError, NotFoundError, SecretsUnavailableError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { SecretStorePort } from './secret-store-port.js';
import { createSignIns, stopSignIn } from './agent-setup-sign-in.js';
import { inheritedKeyOf, installingStatus, keyOnlyWords, shown, subscriptionOf } from './agent-setup-status.js';
import { PROGRESS_INTERVAL_MS } from './toolchain.js';

// Not `Flight`, `newFlight` or `SavedKey`: they stay inside this use-case.
export { AgentBusyError, AgentSetupError, LAST_KNOWN_AUTH_MAX_AGE_MS, SignInNotPendingError, apiKeySecretName, type AgentReadiness, type AgentSetup, type AgentSetupOptions } from './agent-setup-types.js';

export function createAgentSetup(events: EventLog, ports: readonly AgentSetupPort[], options: AgentSetupOptions = {}): AgentSetup {
  const byId = new Map(ports.map((port) => [port.agentId, port]));
  const flights = new Map<string, Flight>();
  /** The last failed sign-in's plain reason, shown until the next sign-in starts or the agent reports signed in. */
  const lastFailure = new Map<string, string>();
  /** Each agent's saved API key, read from the secret store at `load()` and kept in step with it. */
  const keys = new Map<string, SavedKey>();
  /** Each agent's subscription state, as last read; missing means `unknown`. */
  const subscriptions = new Map<string, AgentSubscriptionState>();
  /**
   * Each agent's last status as `statusFor` read it, and when (6.3: a new
   * chat's readiness). Dropped whenever its sign-in, key or install changes,
   * so a readiness never answers from a reading that is out of date.
   */
  const lastStatus = new Map<string, { status: AgentSetupStatus; at: number; unread: boolean }>();
  /** Status reads under way for a readiness, by agent: concurrent ones share one. */
  const readinessReads = new Map<string, Promise<unknown>>();
  /** When each agent's subscription state was last read. */
  const readAt = new Map<string, number>();
  /** Each agent's last confirmed subscription state (never `unknown`), and when it was confirmed. */
  const confirmed = new Map<string, { state: AgentSubscriptionState; at: number }>();
  /** Bumped at each subscription change, so a status read that started before one (a sign-in finishing) is dropped. */
  const generations = new Map<string, number>();
  const generationOf = (agentId: string) => generations.get(agentId) ?? 0;
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
  const now = options.now ?? (() => performance.now());
  const progressInterval = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  /** Each running install's latest progress, and when it is done. */
  const installs = new Map<string, { progress: AgentInstallProgress; done: Promise<void> }>();
  /** Agents being uninstalled (epic 6 entry 7): no install starts meanwhile. */
  const uninstalling = new Set<string>();
  /** Agents being signed out: no uninstall meanwhile, and the other way round. */
  const signingOut = new Set<string>();
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

  const report = (agentId: string, step: string, error: unknown) => {
    try {
      options.onFailure?.(agentId, step, error);
    } catch {
      // Logging must never change the outcome.
    }
  };

  const announce = (agentId: string, state: AgentAuthState, extra: { method?: AgentAuthMethodKind; reason?: string } = {}) => {
    lastStatus.delete(agentId);
    if (disposed) return;
    try {
      events.append({ type: 'agent.auth_changed', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId, state, ...extra } });
    } catch (error) {
      // Only a closed log (the server is stopping) lands here.
      report(agentId, 'append', error);
    }
  };

  /**
   * Stores a subscription state. A read passes the generation it started at;
   * when something changed the state meanwhile, its stale result is dropped.
   */
  const setSubscription = (agentId: string, state: AgentSubscriptionState, startedAt?: number) => {
    if (startedAt !== undefined && generationOf(agentId) !== startedAt) return;
    lastStatus.delete(agentId);
    generations.set(agentId, generationOf(agentId) + 1);
    const at = now();
    subscriptions.set(agentId, state);
    readAt.set(agentId, at);
    if (state !== 'unknown') confirmed.set(agentId, { state, at });
  };

  /**
   * The subscription state the key rule follows: the last read, or, when that
   * couldn't tell (`unknown`), the last confirmed state while it is under
   * {@link LAST_KNOWN_AUTH_MAX_AGE_MS} old.
   */
  const subscriptionFor = (agentId: string): AgentSubscriptionState => {
    const state = subscriptions.get(agentId) ?? 'unknown';
    if (state !== 'unknown') return state;
    const last = confirmed.get(agentId);
    if (last === undefined) return 'unknown';
    // A negative age (a clock that went backwards) counts as expired.
    const age = now() - last.at;
    return age >= 0 && age < LAST_KNOWN_AUTH_MAX_AGE_MS ? last.state : 'unknown';
  };

  const inheritedKey = (port: AgentSetupPort): string | undefined => inheritedKeyOf(port, options.inheritedEnv);

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

  /** Reads the subscription state `port.status()` reports now (`unknown` when it throws); a read overtaken by a newer change is dropped. */
  const readSubscription = async (port: AgentSetupPort): Promise<void> => {
    const startedAt = generationOf(port.agentId);
    let state: AgentSubscriptionState;
    try {
      state = subscriptionOf(await port.status());
    } catch (error) {
      report(port.agentId, 'status', error);
      state = 'unknown';
    }
    setSubscription(port.agentId, state, startedAt);
  };

  /** The secrets store, or the refusal a missing one means. */
  const store = (port?: AgentSetupPort): SecretStorePort => {
    if (options.secrets === undefined) throw keyOnlyWords(port, new SecretsUnavailableError());
    return options.secrets;
  };

  /** A store failure as `SecretsUnavailableError`, reported by its code only. */
  const unavailable = (agentId: string, step: string, error: unknown): SecretsUnavailableError => {
    report(agentId, step, error);
    const refusal = error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' });
    return keyOnlyWords(byId.get(agentId), refusal);
  };

  /** Whether the agent's key is in use: there is one, and the subscription is known to be signed out. */
  const keyInUse = (port: AgentSetupPort) => keyFor(port) !== undefined && subscriptionFor(port.agentId) === 'signed_out';

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
    const subscription = subscriptionFor(port.agentId);
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

  /** {@link readStatus}, kept as the agent's last status unless something changed it meanwhile. */
  const statusFor = async (port: AgentSetupPort): Promise<AgentSetupStatus> => {
    const mark = { unread: false };
    const read = await readStatus(port, mark);
    const provider = options.providerOf?.(port.agentId);
    const status = provider === undefined ? read : { ...read, provider };
    lastStatus.set(port.agentId, { status, at: now(), unread: mark.unread });
    return status;
  };

  /** One agent's setup as `list` shows it. `mark.unread` is set when its port's status threw (nobody could tell). */
  const readStatus = async (port: AgentSetupPort, mark: { unread: boolean }): Promise<AgentSetupStatus> => {
    // A key write that failed (timed out) may have completed since: show what the store holds.
    if (resync.has(port.agentId)) await syncFromStore(port);
    let status: AgentSetupStatus;
    const startedAt = generationOf(port.agentId);
    try {
      const reported = await port.status();
      setSubscription(port.agentId, subscriptionOf(reported), startedAt);
      status = shown(reported);
    } catch (error) {
      report(port.agentId, 'status', error);
      mark.unread = true;
      setSubscription(port.agentId, 'unknown', startedAt);
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

  const signIns = createSignIns({
    flights,
    lastFailure,
    portFor,
    disposed: () => disposed,
    report,
    announce,
    setSubscription: (agentId, state) => setSubscription(agentId, state),
    keyFor,
    readSubscription,
  });

  return {
    ...signIns,

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

    async readiness(agentId, maxAgeMs) {
      const port = ports.find((candidate) => candidate.agentId === agentId);
      // An agent with nothing to install or sign into (a test agent) is always ready.
      if (port === undefined) return { install: 'installed', auth: 'signed_in' };
      const last = lastStatus.get(agentId);
      const age = last === undefined ? Number.POSITIVE_INFINITY : now() - last.at;
      // A negative age (a clock that went backwards) counts as stale.
      let reading = last !== undefined && age >= 0 && age < maxAgeMs ? last : undefined;
      if (reading === undefined) {
        let read = readinessReads.get(agentId);
        if (read === undefined) {
          read = statusFor(port).finally(() => readinessReads.delete(agentId));
          readinessReads.set(agentId, read);
        }
        const status = (await read) as AgentSetupStatus;
        reading = lastStatus.get(agentId) ?? { status, at: now(), unread: false };
      }
      const { status } = reading;
      const shownState = { install: status.install, auth: status.auth };
      // A status the port couldn't give is "can't tell": it never refuses a chat.
      if (reading.unread) return shownState;
      if (status.install !== 'installed') return { ...shownState, blocked: 'agent_not_installed' };
      if (status.auth === 'signed_in') return shownState;
      // Only a sign-out the agent confirmed refuses a chat: "can't tell" never does.
      return subscriptionFor(agentId) === 'signed_out' ? { ...shownState, blocked: 'agent_signed_out' } : shownState;
    },

    async install(agentId) {
      const port = portFor(agentId);
      if (disposed) throw new AgentSetupError(`${port.displayName} couldn't be installed. Try again.`);
      if (uninstalling.has(agentId)) throw new AgentBusyError(`${port.displayName} is being uninstalled. Try again when it finishes.`);
      if (installs.has(agentId)) return { started: false, agent: await statusFor(port) };
      // Claimed before any await, so two clicks start one install.
      const progress: AgentInstallProgress = { step: `Installing ${port.displayName}`, percent: 0 };
      let release!: () => void;
      installs.set(agentId, { progress, done: new Promise<void>((resolve) => (release = resolve)) });
      lastStatus.delete(agentId);
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
        lastStatus.delete(agentId);
        release();
      });
      return { started: true, agent: withApiKey(port, installingStatus(shown(detected), progress)) };
    },

    async uninstall(agentId) {
      const port = portFor(agentId);
      if (port.uninstall === undefined) throw new ValidationError(`${port.displayName} can't be uninstalled from Ogden Agents.`, []);
      if (installs.has(agentId)) throw new AgentBusyError(`${port.displayName} is being installed. Try again when it finishes.`);
      if (uninstalling.has(agentId)) throw new AgentBusyError(`${port.displayName} is already being uninstalled.`);
      if (signingOut.has(agentId)) throw new AgentBusyError(`${port.displayName} is signing out. Try again when it finishes.`);
      uninstalling.add(agentId);
      try {
        // A sign-in in progress runs the installed copy: stop it first.
        const flight = flights.get(agentId);
        if (flight !== undefined) {
          flights.delete(agentId);
          await stopSignIn(flight);
          announce(agentId, 'needs_sign_in');
        }
        try {
          await port.uninstall();
        } catch (error) {
          report(agentId, 'uninstall', error);
          throw new AgentBusyError(error instanceof AgentSetupError ? error.message : `${port.displayName} couldn't be uninstalled. Try again.`, { cause: error });
        }
        installFailure.delete(agentId);
        lastStatus.delete(agentId);
        await readSubscription(port);
        appendInstall(agentId, { type: 'agent.uninstalled', workspaceId: null, streamId: AGENTS_STREAM, payload: { agentId } });
        return await statusFor(port);
      } finally {
        uninstalling.delete(agentId);
      }
    },

    async signOut(agentId) {
      const port = portFor(agentId);
      if (port.signOut === undefined) throw new ValidationError(`${port.displayName} can't be signed out from Ogden Agents.`, []);
      if (installs.has(agentId) || uninstalling.has(agentId)) throw new AgentBusyError(`${port.displayName} is being installed or uninstalled. Try again when it finishes.`);
      if (signingOut.has(agentId)) throw new AgentBusyError(`${port.displayName} is already signing out.`);
      signingOut.add(agentId);
      try {
        const flight = flights.get(agentId);
        if (flight !== undefined) {
          flights.delete(agentId);
          await stopSignIn(flight);
        }
        try {
          await port.signOut();
        } catch (error) {
          report(agentId, 'sign_out', error);
          throw new AgentBusyError(error instanceof AgentSetupError ? error.message : `${port.displayName} couldn't sign out. Try again.`, { cause: error });
        }
      } finally {
        signingOut.delete(agentId);
      }
      lastFailure.delete(agentId);
      // Signed out: a key, saved or from the environment, takes over (story 9.2's rule).
      setSubscription(agentId, 'signed_out');
      if (keyFor(port) !== undefined) announce(agentId, 'signed_in', { method: 'api_key' });
      else announce(agentId, 'needs_sign_in');
      return statusFor(port);
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
      const secrets = store(port);
      // One at a time per agent, check included, so the store and the card end on the later call.
      return serially(agentId, async () => {
        let verification: ApiKeyVerification;
        try {
          verification = await support.verify(value, lifetime.signal);
        } catch (error) {
          report(agentId, 'verify_api_key', error);
          verification = 'unchecked';
        }
        if (verification === 'refused') throw new ApiKeyRefusedError(keyWordOf(support.keyName));
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
        lastStatus.delete(agentId);
        // Subscription first: the key is used only when the subscription is known to be signed out.
        await readSubscription(port);
        if (subscriptionFor(agentId) === 'signed_out' && !wasInUse) announce(agentId, 'signed_in', { method: 'api_key' });
      });
    },

    async deleteApiKey(agentId) {
      const port = portFor(agentId);
      if (port.apiKey === undefined) return;
      const secrets = store(port);
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
        lastStatus.delete(agentId);
        await readSubscription(port);
        if (wasInUse && !keyInUse(port)) announce(agentId, 'needs_sign_in');
      });
    },

    agentEnv(agentId) {
      const port = byId.get(agentId);
      if (port?.apiKey === undefined || subscriptionFor(agentId) !== 'signed_out') return {};
      const key = keyFor(port);
      return key === undefined ? {} : { [port.apiKey.envName]: key };
    },

    async refreshIfStale(agentId, maxAgeMs) {
      const port = byId.get(agentId);
      if (port?.apiKey === undefined || keyFor(port) === undefined) return;
      const at = readAt.get(agentId);
      // A negative age (a clock that went backwards) counts as stale.
      const age = at === undefined ? undefined : now() - at;
      if (age !== undefined && age >= 0 && age < maxAgeMs) return;
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

    async dispose() {
      disposed = true;
      lifetime.abort();
      const running = [...flights.values()];
      flights.clear();
      await Promise.all(running.map(stopSignIn));
      // Whatever a port still runs (an install, a sign-out) stops with the server (epic 6 entry 7).
      for (const port of ports) {
        try {
          port.close?.();
        } catch (error) {
          report(port.agentId, 'close', error);
        }
      }
    },
  };
}
