/**
 * The port for installing an agent and signing into it (story 2.3 contract;
 * onboarding 9.1 to 9.5 fill it, AD-21: no standard flow needs a terminal).
 * One implementation per agent; core names none. An adapter never touches
 * the database or the event log (AD-11): core turns what it reports into
 * `agent.*` events, which never carry a URL, a code or a key (AD-15, AD-16).
 */
import type { AgentSetupStatus } from '@ogden-agents/shared';

/** One step of an install, as the adapter reports it. `percent` is 0 to 100, or `null` when it can't tell. */
export interface AgentInstallProgress {
  step: string;
  percent: number | null;
}

/**
 * A sign-in under way. `url` is where the user finishes it (opened in a new
 * tab), or `null` when there is none; it is a secret-like value and travels
 * only in a `no-store` REST response, never an event or a log line.
 */
export interface AgentSignIn {
  url: string | null;
  /**
   * A code the user types on the sign-in page (a device code), when the
   * agent's sign-in gives one (epic 6, entry 6). Secret-like, as `url`.
   */
  userCode?: string;
  /** Resolves with the outcome once the agent reports signed in, or the sign-in failed or was cancelled. */
  done: Promise<'signed_in' | 'failed' | 'cancelled'>;
  /** Stops the sign-in; `done` resolves `cancelled`. Safe to call more than once. */
  cancel(): Promise<void>;
  /** Sends a code the user pasted back from the sign-in page, for agents that ask for one. */
  submitCode?(code: string): Promise<void>;
}

/**
 * Whether the user's own subscription is signed in, as the agent's CLI
 * reports it without any API key in its environment: `unknown` when it
 * couldn't tell (story 9.2's precedence rule never injects a key then).
 */
export type AgentSubscriptionState = 'signed_in' | 'signed_out' | 'unknown';

/**
 * What a port's {@link AgentSetupPort.status} reports: the setup the UI
 * shows, plus (optionally) the subscription state behind it. Core strips
 * `subscription` before anything leaves it; without it, core derives one
 * (`signed_in` from `auth`, `signed_out` from an installed agent needing
 * sign-in with nothing to say, else `unknown`).
 */
export type AgentPortStatus = AgentSetupStatus & { subscription?: AgentSubscriptionState };

/** How a {@link AgentApiKeySupport.verify} check came out: accepted, refused (401/403), or not checked (network, timeout, 5xx). */
export type ApiKeyVerification = 'ok' | 'refused' | 'unchecked';

/**
 * An agent that can run on an API key instead of a subscription (story 9.2,
 * AD-16). Core names no agent (AD-1): the port declares the environment
 * variable, the format check and the free verify call.
 */
export interface AgentApiKeySupport {
  /** The environment variable the agent's chat process reads its key from (Claude Code: `ANTHROPIC_API_KEY`). */
  readonly envName: string;
  /** Plain words when `value` can't be a key for this agent, else `undefined`. Never echoes the value. */
  check(value: string): string | undefined;
  /**
   * Asks the agent's provider, with a call that costs nothing, whether the key
   * works. Never throws; never logs the key or the response body.
   */
  verify(value: string, signal: AbortSignal): Promise<ApiKeyVerification>;
}

export interface AgentSetupPort {
  /** The agent's stable kebab-case id (`AgentId`). */
  readonly agentId: string;
  /** The agent's product name for the UI. */
  readonly displayName: string;
  /** Whether the agent is installed and signed in. Never throws for a missing agent: that is `not_installed`. */
  status(): Promise<AgentPortStatus>;
  /** Installs the agent, reporting each step. Rejects with plain words when it fails; nothing half-installed stays. */
  install(onProgress: (progress: AgentInstallProgress) => void): Promise<{ version: string | null }>;
  /** Starts signing in with the user's own account. */
  signIn(): Promise<AgentSignIn>;
  /**
   * Removes what Install put in the data folder (epic 6 entry 7), keeping the
   * agent's own home (its chats and sign-in). Present only for an agent that
   * can; rejects with plain words (`AgentSetupError`) when it can't now (a
   * file in use).
   */
  uninstall?(): Promise<void>;
  /**
   * Signs the agent out of the user's own account (epic 6 entry 7). Present
   * only for an agent that can; rejects with plain words when it couldn't,
   * and then it is still signed in.
   */
  signOut?(): Promise<void>;
  /** Present when the agent can use an API key instead (story 9.2). */
  readonly apiKey?: AgentApiKeySupport;
}
