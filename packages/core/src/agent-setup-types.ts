/**
 * The agent setup use-case's errors, constants and interfaces (story 9.1),
 * split from `agent-setup.ts`, which re-exports them.
 */
import type { AgentAuthState, AgentInstallState, AgentSetupStatus, SignInResponse } from '@ogden-agents/shared';
import type { AgentSignIn } from './agent-setup-port.js';
import { CoreError } from './errors.js';
import type { SecretStorePort } from './secret-store-port.js';

/**
 * How long the last confirmed subscription state (`signed_in` or
 * `signed_out`, read from the agent's status or set by a sign-in finishing
 * in the app) stands in for a status check that is slow or fails. Older than
 * this, such a check means `unknown`, which never injects a key (user
 * decision, 2026-10-01).
 */
// Accepted risk (user's trade-off, 2026-10-01): a sign-in made outside the app while checks fail leaves a recent confirmed signed_out in place, so the key is still used for up to 5 minutes.
export const LAST_KNOWN_AUTH_MAX_AGE_MS = 5 * 60_000;

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

/**
 * Whether a new chat can be started with an agent now (6.3): its install and
 * sign-in state as last read, and, when it can't, why. `blocked` is set only
 * on a state the agent confirmed: a status that couldn't be read never blocks.
 */
export interface AgentReadiness {
  install: AgentInstallState;
  auth: AgentAuthState;
  blocked?: 'agent_not_installed' | 'agent_signed_out' | undefined;
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
   * Whether a new chat can be started with `agentId` (6.3), from its status
   * as last read when that is under `maxAgeMs` old, else read now (bounded
   * by the port's own status timeout). An agent with no setup port is ready.
   * Never throws.
   */
  readiness(agentId: string, maxAgeMs: number): Promise<AgentReadiness>;
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
  /**
   * Who makes each agent ("Anthropic"), from its descriptor (epic 6, entry
   * 6): added to its status as `provider`, so the agent card names it.
   */
  providerOf?: (agentId: string) => string | undefined;
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
  /** The clock for the subscription state's age and install progress throttling. Default `performance.now` (monotonic). */
  now?: () => number;
  /** Minimum time between two install progress events. Default `PROGRESS_INTERVAL_MS` (`toolchain.ts`). */
  progressIntervalMs?: number;
}

/** A saved API key, in memory only. `unchecked`: the provider couldn't be asked when it was saved (not kept across a restart). */
export interface SavedKey {
  value: string;
  unchecked: boolean;
}

/** A sign-in under way for one agent. */
export interface Flight {
  /** Set once the port's `signIn` resolved. */
  handle: AgentSignIn | undefined;
  /** Cancelled (or superseded, or disposed) before or after the handle arrived. */
  stopped: boolean;
  /** Settles once the handle arrives, or the start fails or is stopped, so a code sent meanwhile can wait for it. */
  started: Promise<void>;
  settle: () => void;
}

export function newFlight(): Flight {
  let settle!: () => void;
  const started = new Promise<void>((resolve) => (settle = resolve));
  return { handle: undefined, stopped: false, started, settle };
}
