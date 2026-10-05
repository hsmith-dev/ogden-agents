/**
 * How the agent setup use-case reads a port's status (story 9.1, 9.2, 9.3;
 * moved out of `agent-setup.ts` by story 6.9 to keep it under 600 lines).
 */
import type { AgentSetupStatus } from '@ogden-agents/shared';
import type { AgentInstallProgress, AgentPortStatus, AgentSetupPort, AgentSubscriptionState } from './agent-setup-port.js';
import type { AgentSetupOptions } from './agent-setup-types.js';
import { SECRETS_UNAVAILABLE_MESSAGE, SecretsUnavailableError, secretsUnavailableKeyOnlyMessage } from './errors.js';

/** The subscription state a port reports, or the one derived from its status (see `AgentPortStatus`). */
export function subscriptionOf(status: AgentPortStatus): AgentSubscriptionState {
  if (status.subscription !== undefined) return status.subscription;
  if (status.auth === 'signed_in' && status.method !== 'api_key') return 'signed_in';
  if (status.install === 'installed' && status.auth === 'needs_sign_in' && status.reason === undefined) return 'signed_out';
  return 'unknown';
}

/** The port status as core shows it: no subscription state, which never leaves core. */
export function shown(reported: AgentPortStatus): AgentSetupStatus {
  const { subscription: _subscription, ...rest } = reported;
  return rest;
}

/** `status` while an install runs: its progress in place of a reason or a size. */
export function installingStatus(status: AgentSetupStatus, progress: AgentInstallProgress): AgentSetupStatus {
  const { reason: _reason, installSize: _size, method: _method, ...rest } = status;
  return { ...rest, install: 'installing', progress: { step: progress.step, percent: progress.percent } };
}

/** The agent's key variable in the server's own environment, whatever its case; `undefined` when unset or empty. */
export function inheritedKeyOf(port: AgentSetupPort, inheritedEnv: AgentSetupOptions['inheritedEnv']): string | undefined {
  const name = port.apiKey?.envName;
  if (name === undefined || inheritedEnv === undefined) return undefined;
  const env = inheritedEnv();
  const exact = env[name];
  if (exact !== undefined && exact !== '') return exact;
  for (const [key, value] of Object.entries(env)) if (key.toUpperCase() === name.toUpperCase() && value !== undefined && value !== '') return value;
  return undefined;
}

/** An agent that takes only an API key is never told to sign in with an account instead (user decision, 2026-10-05). */
export function keyOnlyWords(port: AgentSetupPort | undefined, error: SecretsUnavailableError): SecretsUnavailableError {
  return port?.apiKeyOnly === true && error.message === SECRETS_UNAVAILABLE_MESSAGE
    ? new SecretsUnavailableError(secretsUnavailableKeyOnlyMessage(port.displayName), typeof error.cause === 'string' ? { cause: error.cause } : {})
    : error;
}
