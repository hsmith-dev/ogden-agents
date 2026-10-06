/**
 * Where the Local model's pinned OpenCode lives in Ogden's data folder (epic
 * 14, story 14.2): `<dataDir>/agents/local/<version>/`, the archive's files
 * unpacked as they are, plus Ogden's own install record (`.ogden-install.json`),
 * written only once every file matched its pinned SHA-256. A copy without that
 * record (unpacked by hand, half-written) does not count.
 *
 * Its own state (its database, logs, config and the empty home) lives apart,
 * in `<dataDir>/agents/local-home`, so a reinstall or an uninstall keeps it.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentPlatform } from '@ogden-agents/core';
import { LOCAL_AGENT_ID } from '../acp-opencode/constants.js';
import { LOCAL_PINS, type LocalArchivePin, type LocalPins, type LocalRipgrepPin } from './descriptor.js';

/** The install record's file name, inside the version folder. */
export const LOCAL_INSTALL_RECORD = '.ogden-install.json';

/** Windows' ripgrep, as unpacked beside the harness's binary. */
export const RIPGREP_FILE = 'rg.exe';

/** This computer's platform, as the pins name it. */
export function currentPlatform(): AgentPlatform {
  return `${process.platform}-${process.arch}` as AgentPlatform;
}

/** The folder every pinned version is unpacked into. */
export function localInstallDir(dataDir: string): string {
  return join(dataDir, 'agents', LOCAL_AGENT_ID);
}

/** The folder one version is unpacked into. */
export function localVersionDir(dataDir: string, pins: Readonly<LocalPins> = LOCAL_PINS): string {
  return join(localInstallDir(dataDir), pins.version);
}

/** The pin for `platform`, or `undefined` when none is pinned for it. */
export function localPin(platform: AgentPlatform = currentPlatform(), pins: Readonly<LocalPins> = LOCAL_PINS): LocalArchivePin | undefined {
  return pins.archives[platform];
}

/** The ripgrep pin for `platform` (Windows only), or `undefined`. */
export function ripgrepPin(platform: AgentPlatform = currentPlatform(), pins: Readonly<LocalPins> = LOCAL_PINS): LocalRipgrepPin | undefined {
  return pins.ripgrep.archives[platform];
}

/** What Ogden wrote once an install was checked. */
export interface LocalInstallRecord {
  version: string;
  platform: string;
  /** Each pinned file's size as written. */
  files: Record<string, number>;
  /** The size of the ripgrep file placed beside it (Windows). */
  ripgrep?: number;
}

/** Writes the install record into `dir` (atomically: a temp file, then a rename). */
export function writeLocalInstallRecord(dir: string, record: LocalInstallRecord): void {
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `${LOCAL_INSTALL_RECORD}.tmp`);
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, join(dir, LOCAL_INSTALL_RECORD));
}

/** The install record in `dir`, or `undefined` when there is none or it is unreadable. */
export function readLocalInstallRecord(dir: string): LocalInstallRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(join(dir, LOCAL_INSTALL_RECORD), 'utf8')) as Partial<LocalInstallRecord>;
    if (typeof value.version !== 'string' || typeof value.platform !== 'string') return undefined;
    if (typeof value.files !== 'object' || value.files === null) return undefined;
    return value as LocalInstallRecord;
  } catch {
    return undefined;
  }
}

/** How to start the pinned harness: by absolute path, never looked up on `PATH`. */
export interface InstalledOpenCode {
  command: string;
  args: readonly string[];
  version: string;
  /** Windows: the pinned `rg.exe` beside it, which is placed in the harness's cache before a chat starts. */
  ripgrep?: string | undefined;
}

/**
 * The pinned OpenCode installed in `dataDir` for `platform`, or `undefined`
 * (not installed, another version, no record, a file missing or changed in
 * size since, or no pin for this platform). Read from the folder only: it is never run here.
 */
export function installedOpenCode(dataDir: string, platform: AgentPlatform = currentPlatform(), pins: Readonly<LocalPins> = LOCAL_PINS): InstalledOpenCode | undefined {
  const pin = localPin(platform, pins);
  if (pin === undefined) return undefined;
  const dir = localVersionDir(dataDir, pins);
  const record = readLocalInstallRecord(dir);
  if (record === undefined || record.version !== pins.version || record.platform !== platform) return undefined;
  const names = Object.keys(pin.files);
  if (names.length !== Object.keys(record.files).length) return undefined;
  const sizeIs = (name: string, size: number | undefined): boolean => {
    try {
      const stat = statSync(join(dir, name));
      return stat.isFile() && stat.size === size;
    } catch {
      return false;
    }
  };
  for (const name of names) if (!sizeIs(name, record.files[name])) return undefined;
  const rg = ripgrepPin(platform, pins);
  if (rg !== undefined && !sizeIs(RIPGREP_FILE, record.ripgrep)) return undefined;
  return { command: join(dir, pin.binary), args: [...pin.args], version: pins.version, ...(rg === undefined ? {} : { ripgrep: join(dir, RIPGREP_FILE) }) };
}
