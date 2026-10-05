/**
 * What Grok is, as data (epic 12 entry 4, on the 6.3 contract): the
 * descriptor server wiring registers beside its chat and setup ports. Core
 * reads it and names no agent (AD-1). The facts are spike 12.2's
 * (`@xai-official/grok` 1.0.49, probed on macOS, Linux and Windows) and the
 * follow-up probes of epic 12 entry 7.
 */
import type { AgentDescriptor } from '@ogden-agents/core';
import {
  GROK,
  GROK_AGENT_ID,
  GROK_API_KEY_ENV,
  GROK_AUTH_METHOD_IDS,
  GROK_BINARY_SHA256,
  GROK_CODE_API_KEY_ENV,
  GROK_HOME_ENV,
  GROK_MODE_IDS,
  GROK_PACKAGE,
} from '../acp-grok/constants.js';
import { pinnedGrokVersion } from './install.js';

/**
 * The files Grok runs from a project once Ogden's trust has been given (its hooks, MCP servers, permission
 * rules and instructions): the trust is bound to their contents, so a change asks again (epic 12, 12.3).
 * Not `.claude` as a whole: BMad setup writes skills there.
 */
export const GROK_PROJECT_FILES: readonly string[] = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', '.grok', '.cursor/hooks.json'];

export const GROK_DESCRIPTOR: Readonly<AgentDescriptor> = Object.freeze<AgentDescriptor>({
  agentId: GROK_AGENT_ID,
  displayName: GROK,
  provider: 'xAI',
  // The pinned package; each tarball's integrity is in `pins/package-lock.json`, and Ogden checks the decompressed binary's SHA-256 itself.
  install: { kind: 'npm', package: GROK_PACKAGE, version: pinnedGrokVersion(), binarySha256: GROK_BINARY_SHA256 },
  // Its settings, sign-in token, sessions and logs live in Ogden's data folder, never `~/.grok`.
  homeEnv: GROK_HOME_ENV,
  signInMethods: [
    // The only way in (user decision, 2026-10-05): an xAI API access token the user supplies, through the unadvertised
    // `xai.api_key` method. No account sign-in (`grok.com`, "Sign in with Grok"). Both names are kept out of every other process.
    { id: GROK_AUTH_METHOD_IDS.apiKey, kind: 'api_key', label: 'Use an xAI API access token', apiKey: { envNames: [GROK_API_KEY_ENV, GROK_CODE_API_KEY_ENV], format: 'Starts with xai-' } },
  ],
  // Grok has no session modes: a mode is given once at chat start (`modeFixedAtStart`). Ask is the default and Skip all is
  // `yoloMode`. Auto (`autoMode`) is not offered: it asks only about calls Grok's classifier will not allow, and fails
  // them in an ACP session, and Ogden cannot make it ask before writing its protected paths.
  permissionModes: { ask: GROK_MODE_IDS.ask, skip_all: GROK_MODE_IDS.skipAll },
  modeFixedAtStart: true,
  // Grok follows the project's own `.claude/settings.json`, hooks and `.mcp.json`: a chat starts only in a project the user trusted.
  needsProjectTrust: true,
  projectFiles: GROK_PROJECT_FILES,
  // Its own config folder joins the protected paths (an edit there is always a card), beside `.agents`, which is already protected.
  configFolders: ['.grok'],
  // Grok reads `.claude/skills` (BMad's skills are already placed there for Claude Code) as well as `.grok/skills` and `.agents/skills`.
  skillsFolder: '.claude/skills',
  // How xAI says a quota or credit limit was reached. Narrow on purpose: a miss is an ordinary error.
  // The user's live check confirms them.
  usageLimitPatterns: [/exhausted your (?:[\w-]+ )?credits/i, /exceeded your (?:current )?(?:quota|credit)/i, /usage limit (?:reached|exceeded)/i, /\bout of credits\b/i],
  // Its context is 500,000 tokens: far more than a brief needs.
  handoffBudgetChars: 100_000,
  // Grok advertises no `_session/steering`: a message sent right away stops the current step (`session/cancel`).
  sendNow: 'interrupt',
});
