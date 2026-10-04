/**
 * What Claude Code is, as data (epic 6 contract, 6.3): the descriptor server
 * wiring registers beside its chat and setup ports. Core reads it and names
 * no agent (AD-1).
 */
import type { AgentDescriptor } from '@ogden-agents/core';
import { ACP_MODE_IDS, CLAUDE_AGENT_ACP_PACKAGE, CLAUDE_CODE } from '../acp-claude-code/constants.js';
import { ANTHROPIC_API_KEY_ENV } from './api-key.js';
import { CLAUDE_AI_LOGIN_ID } from './auth-method.js';
import { pinnedVersion } from './install.js';

/** Claude Code's stable agent id. */
export const CLAUDE_CODE_AGENT_ID = 'claude-code';

export const CLAUDE_CODE_DESCRIPTOR: Readonly<AgentDescriptor> = Object.freeze<AgentDescriptor>({
  agentId: CLAUDE_CODE_AGENT_ID,
  displayName: CLAUDE_CODE,
  provider: 'Anthropic',
  // The pinned Claude Agent ACP adapter; each tarball's integrity is in `pins/package-lock.json` (story 9.3).
  install: { kind: 'npm', package: CLAUDE_AGENT_ACP_PACKAGE, version: pinnedVersion() },
  // No home variable: Claude Code uses the user's own `~/.claude`, where their subscription sign-in lives.
  signInMethods: [
    { id: CLAUDE_AI_LOGIN_ID, kind: 'subscription', label: 'Sign in with your Claude account' },
    { id: 'anthropic-api-key', kind: 'api_key', label: 'Use an Anthropic API key', apiKey: { envNames: [ANTHROPIC_API_KEY_ENV], format: 'Starts with sk-ant-' } },
  ],
  permissionModes: { ask: ACP_MODE_IDS.ask, auto: ACP_MODE_IDS.auto, skip_all: ACP_MODE_IDS.skip_all },
  needsProjectTrust: false,
  skillsFolder: '.claude/skills',
});
