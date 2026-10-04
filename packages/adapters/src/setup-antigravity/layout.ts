/**
 * Where Antigravity's pinned copy lives in Ogden's data folder (epic 6 entry
 * 5; entry 7's install writes it there): `<dataDir>/agents/antigravity/<version>/`,
 * the archive unpacked as it is. Its own state (settings, sessions,
 * transcripts) lives apart, in `<dataDir>/agents/antigravity-home`
 * (`GEMINI_HOME`), so a reinstall keeps it. Spike 6.1: one helper,
 * `webm_encoder`, is still written to `~/.gemini/antigravity/bin/` whatever
 * `GEMINI_HOME` says.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPlatform } from '@ogden-agents/core';
import { ANTIGRAVITY_AGENT_ID, ANTIGRAVITY_PINS, type AntigravityArchivePin, type AntigravityPins } from './descriptor.js';

/** This computer's platform, as the pins name it. */
export function currentPlatform(): AgentPlatform {
  return `${process.platform}-${process.arch}` as AgentPlatform;
}

/** The folder every pinned version is unpacked into. */
export function antigravityInstallDir(dataDir: string): string {
  return join(dataDir, 'agents', ANTIGRAVITY_AGENT_ID);
}

/** The pin for `platform`, or `undefined` when no archive is pinned for it. */
export function antigravityPin(platform: AgentPlatform = currentPlatform(), pins: Readonly<AntigravityPins> = ANTIGRAVITY_PINS): AntigravityArchivePin | undefined {
  return pins.archives[platform];
}

/** How to start a pinned server: by absolute path, never looked up on `PATH`. */
export interface AntigravityServer {
  command: string;
  args: readonly string[];
  version: string;
}

/**
 * The pinned server installed in `dataDir` for `platform`, or `undefined`
 * when there is none (not installed, another version, or no pin for this
 * platform). Read from the folder only: the server is never run to ask its
 * version (`--version` hangs on Windows, spike 6.1).
 */
export function pinnedServer(dataDir: string, platform: AgentPlatform = currentPlatform(), pins: Readonly<AntigravityPins> = ANTIGRAVITY_PINS): AntigravityServer | undefined {
  const pin = antigravityPin(platform, pins);
  if (pin === undefined) return undefined;
  const command = join(antigravityInstallDir(dataDir), pins.version, pin.binary);
  try {
    if (!existsSync(command) || !statSync(command).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return { command, args: [...pin.args], version: pins.version };
}
