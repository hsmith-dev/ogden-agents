/**
 * `acp-opencode` (epic 14): core's `AgentPort` for the Local model, through
 * the pinned OpenCode's `opencode acp`, on the shared ACP client
 * (`acp-base`); see `opencode-agent.ts`. {@link LOCAL_SHIPPED} turns on once
 * the chat is complete (story 14.6).
 */
export {
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_OUTPUT_TOKENS,
  localHome,
  opencodeChatEnv,
  opencodeConfig,
  opencodeEnvProblems,
  SAFE_MODEL_ID,
  writeOpenCodeConfig,
  type LocalHome,
  type LocalModel,
  type OpenCodeConfigInput,
} from './config.js';
export {
  ENDPOINT_KEY_ENV,
  ENDPOINT_KEY_REFERENCE,
  ENDPOINT_URL_ENV,
  LOCAL,
  LOCAL_AGENT_ID,
  LOCAL_MODE_IDS,
  LOCAL_SKILLS_FOLDER,
  NPM_REGISTRY_SINK,
  OPENCODE,
  OPENCODE_CONFIG_ENV,
  OPENCODE_PROVIDER_ID,
  OPENCODE_SWITCHES,
} from './constants.js';
/** The id a model has in the harness's own list (and so in the chat's model picker): `ogden/<server's id>`. */
export const localModelId = (id: string): string => `ogden/${id}`;
export { withEndpointWatch, WATCH_INTERVAL_MS, WATCH_MISSES, type EndpointWatchOptions } from './watch.js';
export { FAILURE_WORDS, localFailureWords } from './failures.js';
export { createLocalAgent, type LocalAgentOptions, type LocalServerCommand } from './opencode-agent.js';

/**
 * Whether a shipped install registers the Local model. The slot's on switch
 * lives here, in its own folder, so the shared wiring list never changes.
 * On since the chat is complete (story 14.6); tests leave it out (`local: false`, the helper's default) or register it through
 * their own options and hooks.
 */
export const LOCAL_SHIPPED = true;
