/**
 * What Codex is, as data (epic 12 entry 4, on the 6.3 contract): the
 * descriptor server wiring registers beside its chat and setup ports. Core
 * reads it and names no agent (AD-1). The facts are spike 12.1's
 * (`@agentclientprotocol/codex-acp` 2.1.1, probed on macOS, Linux and Windows).
 */
import type { AgentDescriptor } from '@ogden-agents/core';
import {
  CODEX,
  CODEX_AGENT_ID,
  CODEX_API_KEY_ENV,
  CODEX_AUTH_METHOD_IDS,
  CODEX_ADAPTER_PACKAGE,
  CODEX_HOME_ENV,
  CODEX_MODE_IDS,
  OPENAI_API_KEY_ENV,
} from '../acp-codex/constants.js';
import { pinnedCodexVersion } from './install.js';

export const CODEX_DESCRIPTOR: Readonly<AgentDescriptor> = Object.freeze<AgentDescriptor>({
  agentId: CODEX_AGENT_ID,
  displayName: CODEX,
  provider: 'OpenAI',
  // The pinned `codex-acp` adapter with its bundled Codex CLI; each tarball's integrity is in `pins/package-lock.json`.
  install: { kind: 'npm', package: CODEX_ADAPTER_PACKAGE, version: pinnedCodexVersion() },
  // Its settings, sessions, logs and sign-in file live in Ogden's data folder, never `~/.codex`.
  homeEnv: CODEX_HOME_ENV,
  signInMethods: [
    // The only way in (user decision, 2026-10-05): an OpenAI API key the user supplies. No ChatGPT or account sign-in,
    // because OpenAI's terms don't allow other apps to use subscription sign-in. Both names are kept out of every other process: `OPENAI_API_KEY` is the one a user's own environment may hold.
    { id: CODEX_AUTH_METHOD_IDS.apiKey, kind: 'api_key', label: 'Use an OpenAI API key', apiKey: { envNames: [CODEX_API_KEY_ENV, OPENAI_API_KEY_ENV], format: 'Starts with sk-' } },
  ],
  // Ask is `read-only` (set explicitly: its own default is Auto) and Skip all is `agent-full-access`. Auto (`agent`) is
  // declared by the chat adapter only if Codex can keep Ogden's protected paths guarded (epic 12 entry 5); `workspace-write` is never offered.
  permissionModes: { ask: CODEX_MODE_IDS.ask, skip_all: CODEX_MODE_IDS.skipAll },
  // Codex asks for its own sandbox and approvals; it reads no project settings, hooks or MCP file Ogden would have to trust.
  needsProjectTrust: false,
  // Its own config folder joins the protected paths (an edit there is always a card), beside `.agents`, which is already protected.
  configFolders: ['.codex'],
  skillsFolder: '.agents/skills',
  // How Codex says a plan's or the API's usage limit was reached. Narrow on purpose: a miss is an ordinary error.
  // The user's live check confirms them.
  usageLimitPatterns: [
    /hit your (?:[\w-]+ )?usage limit/i,
    /usage limit (?:reached|exceeded)/i,
    /\binsufficient_quota\b/i,
    /exceeded your current quota/i,
  ],
  // Its models hold far more than a brief needs.
  handoffBudgetChars: 100_000,
  // `codex-acp` advertises no `_session/steering`: a message sent right away stops the current step (`session/cancel`).
  sendNow: 'interrupt',
});
