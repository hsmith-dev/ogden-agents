/**
 * `acp-codex` (epic 12 entries 4 and 5): core's `AgentPort` for OpenAI's
 * Codex, through the pinned `codex-acp` adapter, on the shared ACP client
 * (`acp-base`); see `codex-agent.ts`. {@link CODEX_SHIPPED} stays off until
 * entry 6 puts Install and the API key in the UI, so a shipped install lists
 * Claude Code (and Antigravity) alone until then.
 */
export { CODEX, CODEX_ADAPTER_PACKAGE, CODEX_AGENT_ID, CODEX_API_KEY_ENV, CODEX_AUTH_METHOD_IDS, CODEX_CLI_PACKAGE, CODEX_HOME_ENV, CODEX_INITIAL_MODE_ENV, CODEX_MODE_IDS, CODEX_OPTION_IDS, OPENAI_API_KEY_ENV } from './constants.js';
export { createCodexAgent, type CodexAgentOptions, type CodexServerCommand } from './codex-agent.js';
export { CODEX_CONFIG_TOML, ensureCodexConfig } from './config.js';

/**
 * Whether a shipped install registers Codex. The slot's on switch lives here,
 * in Codex's own folder, so the shared wiring list never changes (entry 4).
 * Off until Install and sign-in are in the UI (entry 6); tests register Codex
 * through their own options and hooks regardless.
 */
export const CODEX_SHIPPED = false;
