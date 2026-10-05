/**
 * Codex's names, as a leaf module (epic 12 entry 4): the chat adapter, its
 * descriptor and its install all read them, and the chat adapter reads the
 * descriptor, so they live apart to keep imports acyclic (as Claude Code's
 * `constants.ts`). The facts are spike 12.1's (`@agentclientprotocol/codex-acp`
 * 2.1.1 with `@openai/codex` 0.159.3, probed on macOS, Linux and Windows).
 */

/** Codex's stable agent id. */
export const CODEX_AGENT_ID = 'codex';

/** The product name the UI shows. */
export const CODEX = 'Codex';

/** The ACP adapter's npm package, from the ACP registry (`@zed-industries/codex-acp` is stale; never use it). */
export const CODEX_ADAPTER_PACKAGE = '@agentclientprotocol/codex-acp';

/** The Codex CLI the adapter bundles (and starts as `codex app-server`); pinned exactly beside the adapter. */
export const CODEX_CLI_PACKAGE = '@openai/codex';

/** The variable that moves Codex's settings, sessions, logs and sign-in file into Ogden's data folder (spike 12.1). */
export const CODEX_HOME_ENV = 'CODEX_HOME';

/**
 * The variables Codex reads an API key from: the first is the one Ogden sets
 * in Codex's chat process, both are kept out of every other process (AD-16;
 * `OPENAI_API_KEY` is the one a user's own environment is likely to hold).
 */
export const CODEX_API_KEY_ENV = 'CODEX_API_KEY';
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';

/**
 * Its own sign-in method ids, as its `initialize` lists them (spike 12.1). Ogden uses only `apiKey`
 * (user decision, 2026-10-05: Codex is API key only; `chatgpt*` are never offered or called).
 */
export const CODEX_AUTH_METHOD_IDS = {
  /** Opens the browser on the machine running the adapter; hidden when `NO_BROWSER` is set. */
  chatgpt: 'chat-gpt',
  /** Offered only to a client that advertises URL elicitation, which Ogden's client doesn't. */
  chatgptDeviceCode: 'chat-gpt-device-code',
  /** Takes the key from `CODEX_API_KEY` (or `OPENAI_API_KEY`) in its environment. */
  apiKey: 'api-key',
} as const;

/**
 * Its session modes (spike 12.1): `read-only` asks before edits and network
 * use (Ask), `workspace-write` has no Ogden match and is never offered,
 * `agent` (Auto review) asks only for actions it judges unsafe and is the
 * adapter's default, and `agent-full-access` never asks and has no sandbox
 * (Skip all). `INITIAL_AGENT_MODE` starts sessions in a mode.
 */
export const CODEX_MODE_IDS = { ask: 'read-only', workspaceWrite: 'workspace-write', auto: 'agent', skipAll: 'agent-full-access' } as const;

/** The variable the adapter reads the mode a session starts in from. */
export const CODEX_INITIAL_MODE_ENV = 'INITIAL_AGENT_MODE';

/** Its permission option ids (from the 2.1.1 source): Allow once is `allow_once`; Deny is `decline` (a command), else the one `reject_once` there is. */
export const CODEX_OPTION_IDS = { allowOnce: 'allow_once', decline: 'decline', cancel: 'cancel' } as const;
