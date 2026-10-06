import { z } from 'zod';
import { FirstProjectChoice } from './bmad.js';
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
  /** Who makes it ("Anthropic"), as the agent card names it (epic 6, entry 6). Absent from older servers. */
  provider: z.string().min(1).optional(),
  install: AgentInstallState,
  /** The installed version, when known. */
  version: z.string().min(1).nullable(),
  auth: AgentAuthState,
  /** How it is signed in, when it is. */
  method: AgentAuthMethodKind.optional(),
  /** Plain words when there is something to say (why an install or sign-in failed). Never a secret. */
  reason: z.string().min(1).optional(),
  /**
   * Who opens the sign-in page (9.1): `page` when the agent's own browser
   * opening is suppressed, so the page opens it in a new tab; `agent` when
   * the agent opens it itself, so the page shows a link instead of a second tab.
   */
  signInTab: z.enum(['page', 'agent']).optional(),
  /**
   * The agent's API key (9.2), for agents that can use one: whether one is
   * saved in the keychain, its last 4 characters (never more), whether
   * Ogden Agents couldn't check it with the provider when it was saved, and
   * (with none saved) whether one comes from the environment Ogden Agents
   * was started in, which follows the same rule: used only when signed out.
   */
  apiKey: z
    .object({
      saved: z.boolean(),
      lastFour: z.string().length(4).optional(),
      unchecked: z.boolean().optional(),
      fromEnvironment: z.boolean().optional(),
    })
    .optional(),
  /**
   * What Install downloads (9.3), while not installed: `small` (about 60 MB)
   * when the agent can run the user's own CLI, `large` (about 250 MB) when it
   * brings its own.
   */
  installSize: z.enum(['small', 'large']).optional(),
  /**
   * `false` when Install can't help on this computer (no pinned download for
   * its system; epic 6 entry 7): the card shows `reason` and no Install
   * button. Absent means it can.
   */
  canInstall: z.boolean().optional(),
  /** `true` when Ogden Agents installed the agent and can remove it (epic 6 entry 7). */
  canUninstall: z.boolean().optional(),
  /**
   * `true` for an agent that takes only an API key, never an account sign-in (Codex, Grok; user decision, 2026-10-05): the card
   * offers no Sign in, asks for the key, and its notices say why.
   */
  apiKeyOnly: z.boolean().optional(),
  /** `true` for an agent that needs no account and no key (epic 14: the Local model): no Sign in and no key box; its card shows its endpoint's state. */
  noAccount: z.boolean().optional(),
  /** What the agent calls its key in the card's words, when it is not "API key" (Grok: "xAI API access token"). */
  apiKeyName: z.string().min(1).max(60).optional(),
  /** `true` when the agent is signed in with the user's account through Ogden Agents and can be signed out here (epic 6 entry 7). */
  canSignOut: z.boolean().optional(),
  /** `false` when the agent's sign-in never asks for a code to paste back, so the card offers no code box (epic 6 entry 7). Absent means it may. */
  signInTakesCode: z.boolean().optional(),
  /** Plain words about what Install puts where, shown beside Install and Uninstall (epic 6 entry 7). Never a secret. */
  installNote: z.string().min(1).optional(),
  /**
   * Plain-words notices the agent card shows (epic 12, 12.3): known
   * limitations and network use ("Codex keeps its sign-in in a file in
   * Ogden Agents' data folder"). Never a secret or a path.
   */
  notices: z.array(z.string().min(1)).max(8).optional(),
  /** Plain words to read before signing in (terms, where to finish; epic 6 entry 7). Never a secret. */
  signInNote: z.string().min(1).optional(),
  /** The step under way and how far it is (0 to 100, or `null` when it can't tell), while `install` is `installing` (9.3). */
  progress: z.object({ step: z.string().min(1), percent: z.number().min(0).max(100).nullable() }).optional(),
});
export type AgentSetupStatus = z.infer<typeof AgentSetupStatus>;

/**
 * The one word an agent's key goes by in plain sentences: "key" for an API key, the last word of its own name for it
 * otherwise (Grok's "xAI API access token" is a "token").
 */
export const keyWordOf = (apiKeyName: string | undefined): string => apiKeyName?.trim().split(/\s+/).at(-1) ?? 'key';

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
  /**
   * A code the user types on the sign-in page, when the agent's sign-in gives
   * one (a device code; epic 6, entry 6). Like the URL, secret-like: only in
   * this response and the tab's memory.
   */
  code: z.string().min(1).max(64).optional(),
});
export type SignInResponse = z.infer<typeof SignInResponse>;

/** The characters a pasted sign-in code may have (9.1): letters, digits and `. _ # ~ -`. */
export const SIGN_IN_CODE_PATTERN = /^[A-Za-z0-9._#~-]+$/;
/** The longest sign-in code accepted, in characters. */
export const MAX_SIGN_IN_CODE_LENGTH = 512;

/**
 * `POST /api/v1/agents/:agentId/sign-in/code` (sent `Cache-Control: no-store`):
 * the code the sign-in page showed, typed into the agent's sign-in. Never
 * logged, evented, stored or echoed, not even in a validation message (AD-16).
 */
export const SignInCodeRequest = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Paste the code from the sign-in page.')
    .max(MAX_SIGN_IN_CODE_LENGTH, 'That is too long to be a sign-in code.')
    .regex(SIGN_IN_CODE_PATTERN, "That doesn't look like a sign-in code. Copy it again from the sign-in page."),
});
export type SignInCodeRequest = z.infer<typeof SignInCodeRequest>;

/** The longest API key accepted, in characters. */
export const MAX_API_KEY_LENGTH = 1000;

/**
 * `PUT /api/v1/agents/:agentId/api-key` (sent `Cache-Control: no-store`; 9.2):
 * the key, stored in the keychain. Never logged, evented, stored anywhere
 * else or echoed, not even in a validation message (AD-16). A blank or
 * malformed key is refused by the agent's own format check, with plain words.
 */
export const SetApiKeyRequest = z.object({
  apiKey: z.string().trim().max(MAX_API_KEY_LENGTH, 'That is too long to be an API key.'),
});
export type SetApiKeyRequest = z.infer<typeof SetApiKeyRequest>;

/**
 * `GET` and `PATCH /api/v1/onboarding`: whether the first-run Welcome is
 * done, and (story 10.2's contract; entry 10.4 asks it) the answer to
 * "Simple chats or BMad Method?" for the first project, once given, so
 * Welcome never asks again. Absent in records from before epic 10.
 */
export const OnboardingState = z.object({ welcomeCompleted: z.boolean(), firstProjectChoice: FirstProjectChoice.optional() });
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
