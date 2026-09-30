import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { openCore, type Core } from '../src/index.js';

const dirs: string[] = [];
const opened: Core[] = [];

afterEach(() => {
  for (const core of opened.splice(0)) core.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A fresh temp directory, removed after the test. */
export function tempDir(prefix = 'ogdenmad-core-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Opens core on `dataDir` (a fresh temp data folder by default); closed after the test. */
export function openTestCore(dataDir: string = tempDir(), onListenerError?: (error: unknown) => void): Core {
  const core = openCore(dataDir, onListenerError === undefined ? {} : { onListenerError });
  opened.push(core);
  return core;
}
