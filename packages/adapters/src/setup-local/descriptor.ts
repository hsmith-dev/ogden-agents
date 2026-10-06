/**
 * What the Local model is, as data (epic 14, story 14.2, on the 6.3 contract):
 * the descriptor server wiring registers beside its chat and setup ports.
 * Core reads it and names no agent (AD-1). The facts are spike 14.1's
 * (`opencode` 1.18.34, probed on macOS, Linux and Windows).
 */
import type { AgentDescriptor, AgentPlatform } from '@ogden-agents/core';
import { LOCAL, LOCAL_AGENT_ID, LOCAL_MODE_IDS, LOCAL_SKILLS_FOLDER } from '../acp-opencode/constants.js';
import pins from './pins/opencode.json' with { type: 'json' };

/** One file an archive holds, as Ogden hashed it from the pinned archive. */
export interface LocalFilePin {
  size: number;
  sha256: string;
}

/** One pinned OpenCode archive: where it is, its SHA-256 (the ACP registry's), its size and the binary in it. */
export interface LocalArchivePin {
  url: string;
  sha256: string;
  /** The archive's size in bytes (a download never takes more). */
  size: number;
  format: 'zip' | 'tar.gz';
  /** The executable's file name inside the archive (`opencode`, or `opencode.exe` on Windows: the registry's `cmd` lacks the extension). */
  binary: string;
  /** What it is started with. */
  args: readonly string[];
  /** Every file the archive holds, by name: the only entries an install unpacks. */
  files: Readonly<Record<string, LocalFilePin>>;
}

/** Windows only: ripgrep, which the harness would download from GitHub on its first search (spike 14.1). */
export interface LocalRipgrepPin {
  url: string;
  sha256: string;
  size: number;
  /** The path of `rg.exe` inside the zip. */
  member: string;
  file: LocalFilePin;
}

export interface LocalPins {
  registry: string;
  version: string;
  archives: Readonly<Partial<Record<AgentPlatform, LocalArchivePin>>>;
  ripgrep: { version: string; archives: Readonly<Partial<Record<AgentPlatform, LocalRipgrepPin>>> };
}

/** The pinned OpenCode and ripgrep (`pins/opencode.json`, checked by `scripts/agent-pins.mjs --agent local`). */
export const LOCAL_PINS: Readonly<LocalPins> = pins as LocalPins;

export const LOCAL_DESCRIPTOR: Readonly<AgentDescriptor> = Object.freeze<AgentDescriptor>({
  agentId: LOCAL_AGENT_ID,
  displayName: LOCAL,
  // Whose server it talks to is the user's choice, so no company is named.
  provider: 'Your own server',
  install: {
    kind: 'archive',
    version: LOCAL_PINS.version,
    archives: Object.fromEntries(Object.entries(LOCAL_PINS.archives).map(([platform, pin]) => [platform, { url: pin!.url, sha256: pin!.sha256 }])),
  },
  // No account and no key to sign in with: an endpoint's own optional key belongs to the endpoint (story 14.3), not to the agent.
  signInMethods: [],
  noAccount: true,
  // Ask only (user decision, 2026-10-05): the config makes every tool ask, and the mode is fixed at start, so the server refuses Auto and Skip all.
  permissionModes: { ask: LOCAL_MODE_IDS.ask },
  modeFixedAtStart: true,
  // Why only Ask: a small local model makes more mistakes with tools, so nothing runs or is written without a card.
  modesNote: 'Small local models make more mistakes with tools, so every command and file change asks first.',
  // Its project config, plugins and MCP servers are switched off (`OPENCODE_DISABLE_PROJECT_CONFIG`), so a project can't make it run anything.
  needsProjectTrust: false,
  // Its own project folder joins the protected paths (an edit there is a card).
  configFolders: ['.opencode'],
  skillsFolder: LOCAL_SKILLS_FOLDER,
  // A small context holds little: a handoff brief is kept to about 3,000 tokens.
  handoffBudgetChars: 12_000,
  // OpenCode's `acp` takes no message into a running turn: a message sent right away stops the current step.
  sendNow: 'interrupt',
});
