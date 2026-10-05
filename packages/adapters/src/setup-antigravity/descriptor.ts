/**
 * What Antigravity is, as data (epic 6 entry 5, on the 6.3 contract): the
 * descriptor server wiring registers beside its chat and setup ports. Core
 * reads it and names no agent (AD-1). The facts are spike 6.1's
 * (`antigravity-acp` 1.3.0, probed on macOS, Linux and Windows).
 */
import type { AgentDescriptor, AgentPlatform } from '@ogden-agents/core';
import pins from './pins/antigravity-acp.json' with { type: 'json' };

/** Antigravity's stable agent id. */
export const ANTIGRAVITY_AGENT_ID = 'antigravity';

/** The product name the UI shows. */
export const ANTIGRAVITY = 'Antigravity';

/** The variable its key is read from (spike 6.1: the server reads it from its environment and never writes it to a file). */
export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';

/** The variable that moves its settings, sessions and transcripts into Ogden's data folder (spike 6.1). */
export const GEMINI_HOME_ENV = 'GEMINI_HOME';

/** Its own sign-in method ids, as its `initialize` lists them. */
export const ANTIGRAVITY_GOOGLE_LOGIN_ID = 'oauth-personal';
export const ANTIGRAVITY_API_KEY_METHOD_ID = 'gemini-api-key';

/** Its session modes (spike 6.1): `default` asks, `auto_edit` approves every file edit, `yolo` approves every tool. */
export const ANTIGRAVITY_MODE_IDS = { ask: 'default', autoEdit: 'auto_edit', skipAll: 'yolo' } as const;

/** One file the archive holds, as Ogden hashed it from the pinned archive (entry 7). */
export interface AntigravityFilePin {
  size: number;
  sha256: string;
}

/** One pinned archive: where it is, its SHA-256 (Ogden's own; Google publishes none), and the server in it. */
export interface AntigravityArchivePin {
  url: string;
  sha256: string;
  /** The archive's size in bytes, as sent with `Accept-Encoding: identity` (entry 7: a download never takes more). */
  size: number;
  /** Every file the archive holds, by name (no folders): the only entries an install unpacks (entry 7). */
  files: Readonly<Record<string, AntigravityFilePin>>;
  /** The server's file name inside the archive. */
  binary: string;
  /** The arguments it starts with (`--uid=` on Linux, as the ACP registry gives). */
  args: readonly string[];
}

export interface AntigravityPins {
  registry: string;
  version: string;
  archives: Readonly<Partial<Record<AgentPlatform, AntigravityArchivePin>>>;
}

/** The pinned `agy_acp_server` (`pins/antigravity-acp.json`, checked by `scripts/agent-pins.mjs --agent antigravity`). */
export const ANTIGRAVITY_PINS: Readonly<AntigravityPins> = pins as AntigravityPins;

export const ANTIGRAVITY_DESCRIPTOR: Readonly<AgentDescriptor> = Object.freeze<AgentDescriptor>({
  agentId: ANTIGRAVITY_AGENT_ID,
  displayName: ANTIGRAVITY,
  provider: 'Google',
  install: {
    kind: 'archive',
    version: ANTIGRAVITY_PINS.version,
    archives: Object.fromEntries(Object.entries(ANTIGRAVITY_PINS.archives).map(([platform, pin]) => [platform, { url: pin!.url, sha256: pin!.sha256 }])),
  },
  homeEnv: GEMINI_HOME_ENV,
  signInMethods: [
    { id: ANTIGRAVITY_GOOGLE_LOGIN_ID, kind: 'subscription', label: 'Sign in with Google' },
    { id: ANTIGRAVITY_API_KEY_METHOD_ID, kind: 'api_key', label: 'Use a Gemini API key', apiKey: { envNames: [GEMINI_API_KEY_ENV], format: 'Starts with AIza' } },
  ],
  // Ask and Skip all only, never Auto: its `auto_edit` approves the protected files Ogden's Auto keeps guarded (user, 2026-10-02).
  permissionModes: { ask: ANTIGRAVITY_MODE_IDS.ask, skip_all: ANTIGRAVITY_MODE_IDS.skipAll },
  // Its own workspace-trust question arrives as a permission card; Ogden's per-project trust (4.2) is not needed.
  needsProjectTrust: false,
  skillsFolder: '.agents/skills',
  // How Antigravity (Gemini models) says a quota or rate limit was reached (handoff, 2026-10-04): Google's
  // `RESOURCE_EXHAUSTED` and its quota wording. Narrow on purpose; the user's live check confirms them.
  usageLimitPatterns: [
    /\bRESOURCE_EXHAUSTED\b/,
    /\bquota (?:exceeded|exhausted|has been exhausted)\b/i,
    /exhausted your (?:capacity|quota)/i,
    /\b429\b[^\n]*\bToo Many Requests\b/i,
    /\brate limit (?:reached|exceeded)\b/i,
  ],
  // Gemini models hold far more context than a brief needs.
  handoffBudgetChars: 150_000,
});
