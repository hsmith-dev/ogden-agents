/**
 * Where Antigravity's pinned copy lives in Ogden's data folder (epic 6 entry
 * 5; entry 7's install writes it there): `<dataDir>/agents/antigravity/<version>/`,
 * the archive's files unpacked as they are, plus Ogden's own install record
 * (`.ogden-install.json`), written only once every file matched its pinned
 * SHA-256 and the server's `initialize` reported the pinned version. A copy
 * without that record (unpacked by hand, half-written) does not count until
 * Install has checked it.
 *
 * Its own state (settings, sessions, transcripts) lives apart, in
 * `<dataDir>/agents/antigravity-home` (`GEMINI_HOME`), so a reinstall or an
 * uninstall keeps it. Spike 6.1: one helper, `webm_encoder`, is still written
 * to `~/.gemini/antigravity/bin/` whatever `GEMINI_HOME` says.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPlatform } from '@ogden-agents/core';
import { ANTIGRAVITY_AGENT_ID, ANTIGRAVITY_PINS, type AntigravityArchivePin, type AntigravityPins } from './descriptor.js';

/** The install record's file name, inside the version folder. */
export const INSTALL_RECORD = '.ogden-install.json';

/** This computer's platform, as the pins name it. */
export function currentPlatform(): AgentPlatform {
  return `${process.platform}-${process.arch}` as AgentPlatform;
}

/** The folder every pinned version is unpacked into. */
export function antigravityInstallDir(dataDir: string): string {
  return join(dataDir, 'agents', ANTIGRAVITY_AGENT_ID);
}

/** The folder one version is unpacked into. */
export function antigravityVersionDir(dataDir: string, pins: Readonly<AntigravityPins> = ANTIGRAVITY_PINS): string {
  return join(antigravityInstallDir(dataDir), pins.version);
}

/**
 * Ogden's own record that the user signed in to Antigravity with Google from
 * the app (entry 7): Antigravity has no status call, so this is how Ogden
 * knows. It holds no secret, only the method and when; Antigravity's own
 * credentials are never read or written (AD-16).
 */
export function signInRecordPath(dataDir: string): string {
  return join(dataDir, 'agents', `${ANTIGRAVITY_AGENT_ID}-signin.json`);
}

/** The pin for `platform`, or `undefined` when no archive is pinned for it. */
export function antigravityPin(platform: AgentPlatform = currentPlatform(), pins: Readonly<AntigravityPins> = ANTIGRAVITY_PINS): AntigravityArchivePin | undefined {
  return pins.archives[platform];
}

/** How to start a pinned server: by absolute path, never looked up on `PATH`. */
export interface AntigravityServer {
  command: string;
  args: readonly string[];
  /** The version its `initialize` reported when it was installed (never `--version`, which hangs on Windows). */
  version: string;
}

/** What Ogden wrote once an install was checked. */
export interface InstallRecord {
  version: string;
  platform: string;
  /** `agentInfo.version` from the server's `initialize`. */
  reportedVersion: string;
  /** Each pinned file's size as written. */
  files: Record<string, number>;
}

/** Writes the install record into `dir` (atomically: a temp file, then a rename). */
export function writeInstallRecord(dir: string, record: InstallRecord): void {
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `${INSTALL_RECORD}.tmp`);
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, join(dir, INSTALL_RECORD));
}

/** The install record in `dir`, or `undefined` when there is none or it is unreadable. */
export function readInstallRecord(dir: string): InstallRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(join(dir, INSTALL_RECORD), 'utf8')) as Partial<InstallRecord>;
    if (typeof value.version !== 'string' || typeof value.platform !== 'string' || typeof value.reportedVersion !== 'string') return undefined;
    if (typeof value.files !== 'object' || value.files === null) return undefined;
    return value as InstallRecord;
  } catch {
    return undefined;
  }
}

/**
 * The pinned server installed in `dataDir` for `platform`, or `undefined`
 * when there is none (not installed, another version, no install record, a
 * file missing or changed in size since, or no pin for this platform). Read
 * from the folder only: the server is never run here.
 */
export function pinnedServer(dataDir: string, platform: AgentPlatform = currentPlatform(), pins: Readonly<AntigravityPins> = ANTIGRAVITY_PINS): AntigravityServer | undefined {
  const pin = antigravityPin(platform, pins);
  if (pin === undefined) return undefined;
  const dir = antigravityVersionDir(dataDir, pins);
  const record = readInstallRecord(dir);
  if (record === undefined || record.version !== pins.version || record.platform !== platform) return undefined;
  const names = Object.keys(pin.files);
  if (names.length !== Object.keys(record.files).length) return undefined;
  for (const name of names) {
    try {
      const stat = statSync(join(dir, name));
      if (!stat.isFile() || stat.size !== record.files[name]) return undefined;
    } catch {
      return undefined;
    }
  }
  return { command: join(dir, pin.binary), args: [...pin.args], version: record.reportedVersion };
}
