/**
 * `setup-memory` (story 2.3): an in-memory `AgentSetupPort` for tests; the
 * server runs the real install and sign-in adapters (`setup-claude-code`,
 * onboarding 9.1 to 9.3). Deterministic: install reports two steps and succeeds, and sign-in
 * returns a fixed placeholder URL and succeeds when `complete` is called
 * (or is cancelled). It installs nothing and signs into nothing.
 */
import type { AgentSetupPort, AgentSignIn } from '@ogden-agents/core';
import type { AgentAuthState, AgentSetupStatus } from '@ogden-agents/shared';

export interface MemoryAgentSetupOptions {
  agentId?: string;
  displayName?: string;
  installed?: boolean;
  auth?: AgentAuthState;
  /** A code its sign-in gives, to type on the sign-in page (a device code; epic 6, entry 6). */
  userCode?: string;
}

/** The placeholder a memory sign-in returns; it names no real service. */
export const MEMORY_SIGN_IN_URL = 'https://sign-in.invalid/memory';

export interface MemoryAgentSetup extends AgentSetupPort {
  /** Finishes the sign-in under way as signed in (tests). */
  complete(): void;
}

export function createMemoryAgentSetup(options: MemoryAgentSetupOptions = {}): MemoryAgentSetup {
  const agentId = options.agentId ?? 'claude-code';
  const displayName = options.displayName ?? 'Claude Code';
  let installed = options.installed ?? false;
  let auth: AgentAuthState = options.auth ?? 'needs_sign_in';
  let finish: ((outcome: 'signed_in' | 'failed' | 'cancelled') => void) | undefined;

  return {
    agentId,
    displayName,

    async status(): Promise<AgentSetupStatus> {
      return {
        agentId,
        displayName,
        install: installed ? 'installed' : 'not_installed',
        version: installed ? '0.0.0-memory' : null,
        auth,
        ...(auth === 'signed_in' ? { method: 'subscription' as const } : {}),
      };
    },

    async install(onProgress) {
      onProgress({ step: `Downloading ${displayName}`, percent: 50 });
      onProgress({ step: `Installing ${displayName}`, percent: 100 });
      installed = true;
      return { version: '0.0.0-memory' };
    },

    async signIn(): Promise<AgentSignIn> {
      finish?.('cancelled');
      auth = 'signing_in';
      const done = new Promise<'signed_in' | 'failed' | 'cancelled'>((resolve) => {
        finish = (outcome) => {
          finish = undefined;
          auth = outcome === 'signed_in' ? 'signed_in' : 'needs_sign_in';
          resolve(outcome);
        };
      });
      return {
        url: MEMORY_SIGN_IN_URL,
        ...(options.userCode === undefined ? {} : { userCode: options.userCode }),
        done,
        cancel: async () => finish?.('cancelled'),
      };
    },

    complete() {
      finish?.('signed_in');
    },
  };
}
