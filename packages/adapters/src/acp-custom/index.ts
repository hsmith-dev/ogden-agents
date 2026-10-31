/**
 * `acp-custom` (epic 21): an ACP agent the user brings by its command line,
 * on the shared ACP client (`acp-base`); see `custom-agent.ts`.
 */
export { createCustomAgent, CUSTOM_AGENT_ID_PREFIX, CUSTOM_ASK_MODE_ID, CUSTOM_SKILLS_FOLDER, customAgentDescriptor, type CustomAgentOptions } from './custom-agent.js';
