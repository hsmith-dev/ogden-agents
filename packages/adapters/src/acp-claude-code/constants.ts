/**
 * Claude Code's names, as a leaf module: the chat adapter, its descriptor
 * (`setup-claude-code/descriptor.ts`) and its install all read them, and the
 * chat adapter reads the descriptor, so they live apart to keep imports
 * acyclic (6.4).
 */
import type { PermissionMode } from '@ogden-agents/shared';

/** The product name the UI shows (EXPERIENCE.md Voice: the agent by its product name). */
export const CLAUDE_CODE = 'Claude Code';

/** The adapter's npm package; a dev dependency only, never a runtime one. */
export const CLAUDE_AGENT_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp';

/** The ACP session mode each Ogden permission mode is (claude-agent-acp 0.84). */
export const ACP_MODE_IDS: Readonly<Record<PermissionMode, string>> = { ask: 'default', auto: 'auto', skip_all: 'bypassPermissions' };
