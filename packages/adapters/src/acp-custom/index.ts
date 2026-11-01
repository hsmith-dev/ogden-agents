/**
 * `acp-custom` (epic 21): an ACP agent the user brings by its command line,
 * on the shared ACP client (`acp-base`); see `custom-agent.ts`.
 */
export { createCustomAgent, neverAsksMode, probeCustomAgent, CUSTOM_AGENT_ID_PREFIX, CUSTOM_AGENT_LOCAL_ONLY_REASON, customAgentDescriptor, type CustomAgentOptions } from './custom-agent.js';
