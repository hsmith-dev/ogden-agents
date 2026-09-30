import { z } from 'zod';
import { AgentAuthMethodKind, AgentAuthState, AgentId } from './events.js';

/**
 * The onboarding and app-shortcut REST contract (story 2.3 contracts; filled
 * by onboarding 9.1 to 9.5 and story 2.4). Routes are in `API_ROUTES`.
 *
 * Nothing here ever carries a key back: an API key goes in, once, in
 * {@link SetApiKeyRequest}, and is stored through `SecretStorePort` (AD-16).
 * The sign-in URL travels only in a `no-store` {@link SignInResponse}, never
 * in an event (AD-15).
 */

/** Whether an agent's CLI (and its ACP adapter) is installed. */
export const AGENT_INSTALL_STATES = ['not_installed', 'installing', 'installed', 'failed'] as const;
export const AgentInstallState = z.enum(AGENT_INSTALL_STATES);
export type AgentInstallState = z.infer<typeof AgentInstallState>;

/** One agent's setup as Welcome and Settings: Agents show it. */
export const AgentSetupStatus = z.object({
  agentId: AgentId,
  /** The agent's product name ("Claude Code"). */
  displayName: z.string().min(1),
  install: AgentInstallState,
  /** The installed version, when known. */
  version: z.string().min(1).nullable(),
  auth: AgentAuthState,
  /** How it is signed in, when it is. */
  method: AgentAuthMethodKind.optional(),
  /** Plain words when there is something to say (why an install or sign-in failed). Never a secret. */
  reason: z.string().min(1).optional(),
});
export type AgentSetupStatus = z.infer<typeof AgentSetupStatus>;

/** `GET /api/v1/agents`: every supported agent and its setup. */
export const AgentsResponse = z.object({ agents: z.array(AgentSetupStatus) });
export type AgentsResponse = z.infer<typeof AgentsResponse>;

/**
 * `POST /api/v1/agents/:agentId/sign-in` (sent `Cache-Control: no-store`):
 * the page opens `url` in a new tab when there is one ("Finish signing in in
 * the tab that just opened"); the outcome arrives as `agent.auth_changed`.
 */
export const SignInResponse = z.object({
  state: AgentAuthState,
  url: z.url().nullable(),
});
export type SignInResponse = z.infer<typeof SignInResponse>;

/** `PUT /api/v1/agents/:agentId/api-key`: the key, stored in the keychain. Never logged, never echoed. */
export const SetApiKeyRequest = z.object({
  apiKey: z.string().trim().min(1, 'Paste your API key.').max(1000, 'That is too long to be an API key.'),
});
export type SetApiKeyRequest = z.infer<typeof SetApiKeyRequest>;

/** `GET` and `PATCH /api/v1/onboarding`: whether the first-run Welcome is done. */
export const OnboardingState = z.object({ welcomeCompleted: z.boolean() });
export type OnboardingState = z.infer<typeof OnboardingState>;

/**
 * `GET /api/v1/app-shortcut` (E2-R10): whether this computer can have the
 * Ogden Agents shortcut, whether it has it, and whether the first-run offer
 * is still to be shown. `platform` is the server's OS as Node names it.
 */
export const AppShortcutStatus = z.object({
  platform: z.string().min(1),
  supported: z.boolean(),
  installed: z.boolean(),
  offerPending: z.boolean(),
});
export type AppShortcutStatus = z.infer<typeof AppShortcutStatus>;
