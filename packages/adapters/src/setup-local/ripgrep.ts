/**
 * Windows only (epic 14, story 14.2): the harness downloads ripgrep from
 * GitHub on its first search unless `rg.exe` is already in its cache folder
 * (spike 14.1). Install put the pinned, hash-checked `rg.exe` beside the
 * harness; this copies it into `<XDG_CACHE_HOME>/opencode/bin/` before a
 * chat starts, so the harness never reaches out.
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { localHome } from '../acp-opencode/config.js';
import { RIPGREP_FILE, type InstalledOpenCode } from './layout.js';

/** Where the harness looks for its ripgrep. */
export function ripgrepCacheFile(dataDir: string): string {
  return join(localHome(dataDir).xdg.cache, 'opencode', 'bin', RIPGREP_FILE);
}

/** Copies the pinned `rg.exe` into the harness's cache when it is not there already (same size). A no-op without one. */
export function seedRipgrep(dataDir: string, installed: Pick<InstalledOpenCode, 'ripgrep'>): void {
  if (installed.ripgrep === undefined) return;
  const target = ripgrepCacheFile(dataDir);
  try {
    if (statSync(target).size === statSync(installed.ripgrep).size) return;
  } catch {
    // Not there yet.
  }
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
  copyFileSync(installed.ripgrep, target);
}
