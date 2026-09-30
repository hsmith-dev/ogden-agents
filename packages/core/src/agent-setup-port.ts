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
  /** Resolves with the outcome once the agent reports signed in, or the sign-in failed or was cancelled. */
  done: Promise<'signed_in' | 'failed' | 'cancelled'>;
  /** Stops the sign-in; `done` resolves `cancelled`. Safe to call more than once. */
  cancel(): Promise<void>;
  /** Sends a code the user pasted back from the sign-in page, for agents that ask for one. */
  submitCode?(code: string): Promise<void>;
}

export interface AgentSetupPort {
  /** The agent's stable kebab-case id (`AgentId`). */
  readonly agentId: string;
  /** The agent's product name for the UI. */
  readonly displayName: string;
  /** Whether the agent is installed and signed in. Never throws for a missing agent: that is `not_installed`. */
  status(): Promise<AgentSetupStatus>;
  /** Installs the agent, reporting each step. Rejects with plain words when it fails; nothing half-installed stays. */
  install(onProgress: (progress: AgentInstallProgress) => void): Promise<{ version: string | null }>;
  /** Starts signing in with the user's own account. */
  signIn(): Promise<AgentSignIn>;
}
