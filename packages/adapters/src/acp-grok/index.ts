/**
 * `acp-grok` (epic 12 entries 4 and 7): core's `AgentPort` for xAI's Grok,
 * through its own `grok agent stdio`, on the shared ACP client (`acp-base`);
 * see `grok-agent.ts`. {@link GROK_SHIPPED} turns on with entry 8 (Install and the xAI
 * API access token in the UI).
 */
export {
  GROK,
  GROK_AGENT_ID,
  GROK_API_KEY_ENV,
  GROK_AUTH_METHOD_IDS,
  GROK_BINARY_SHA256,
  GROK_CODE_API_KEY_ENV,
  GROK_DISABLE_AUTOUPDATER_ENV,
  GROK_FOLDER_TRUST_ENV,
  GROK_HOME_ENV,
  GROK_MODE_IDS,
  GROK_PACKAGE,
} from './constants.js';
export { createGrokAgent, GROK_ARGS, GROK_BINARY_CHANGED, type GrokAgentOptions, type GrokServerCommand } from './grok-agent.js';

/**
 * Whether a shipped install registers Grok. The slot's on switch lives here,
 * in Grok's own folder, so the shared wiring list never changes (entry 4).
 * On since entry 8 put Install and the token in the UI; tests leave Grok out
 * (`grok: false`, the helper's default) or register it through their own options and hooks.
 */
export const GROK_SHIPPED = true;
