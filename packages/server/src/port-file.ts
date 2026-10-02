/** The data folder's port file, which tells a launcher where the running server is (moved from `start.ts`, story 10.8). */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tightenMode } from './file-mode.js';
import type { PortFile } from './start-types.js';

/** Writes the port file readable only by the user, replacing any stale one in one step. */
export function writePortFile(file: string, identity: PortFile): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
  tightenMode(temp);
  renameSync(temp, file);
}

/** Removes the port file only if it is still this server's; another server may have replaced it. */
export function removePortFile(file: string, identity: PortFile): void {
  let current: Partial<PortFile>;
  try {
    current = JSON.parse(readFileSync(file, 'utf8')) as Partial<PortFile>;
  } catch {
    return;
  }
  if (current.pid === identity.pid && current.port === identity.port && current.startedAt === identity.startedAt) {
    rmSync(file, { force: true });
  }
}
