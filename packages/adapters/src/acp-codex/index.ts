/**
 * `acp-codex` (epic 12 entries 4 and 5): core's `AgentPort` for OpenAI's
 * Codex, through the pinned `codex-acp` adapter, on the shared ACP client
 * (`acp-base`). Entry 4 adds the slot: this stub is not set up (the port
 * refuses a chat as "not set up") and {@link CODEX_SHIPPED} is off, so a shipped
 * install lists Claude Code (and Antigravity) alone until entry 5 fills the
 * adapter and entry 6 turns Install and sign-in on.
 */
export { CODEX, CODEX_ADAPTER_PACKAGE, CODEX_AGENT_ID, CODEX_API_KEY_ENV, CODEX_AUTH_METHOD_IDS, CODEX_CLI_PACKAGE, CODEX_HOME_ENV, CODEX_INITIAL_MODE_ENV, CODEX_MODE_IDS, CODEX_OPTION_IDS, OPENAI_API_KEY_ENV } from './constants.js';
export { createCodexAgent, type CodexAgentOptions } from './codex-agent.js';

/**
 * Whether a shipped install registers Codex. The slot's on switch lives here,
 * in Codex's own folder, so the shared wiring list never changes (entry 4).
 * Off until Install and sign-in are in the UI (entry 6); tests register Codex
 * through their own options and hooks regardless.
 */
export const CODEX_SHIPPED = false;
