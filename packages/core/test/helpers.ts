import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { openCore, type BmadCatalogPort, type Core, type OpenCoreOptions } from '../src/index.js';

const dirs: string[] = [];
const opened: Core[] = [];

afterEach(() => {
  for (const core of opened.splice(0)) core.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Removes `dir` after the test, once every core opened here is closed. Returns it. */
export function removeAfterTest(dir: string): string {
  dirs.push(dir);
  return dir;
}

/** A fresh temp directory, removed after the test. */
export function tempDir(prefix = 'ogden-agents-core-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Opens core on `dataDir` (a fresh temp data folder by default), with `options` (such as available BMad pieces); closed after the test. */
export function openTestCore(dataDir: string = tempDir(), onListenerError?: (error: unknown) => void, options: OpenCoreOptions = {}): Core {
  const core = openCore(dataDir, { ...options, ...(onListenerError === undefined ? {} : { onListenerError }) });
  opened.push(core);
  return core;
}

/**
 * The parts of `BmadCatalogPort` a test that only detects (or only lists
 * skills) never reaches (story 4.2): each rejects, so a test that did reach
 * one fails loudly.
 */
export const unusedCatalogParts: Pick<BmadCatalogPort, 'catalog' | 'setupStatus' | 'setup' | 'readDocument'> = {
  catalog: () => Promise.reject(new Error('catalog is not used in this test')),
  setupStatus: () => Promise.reject(new Error('setupStatus is not used in this test')),
  setup: () => Promise.reject(new Error('setup is not used in this test')),
  readDocument: () => Promise.reject(new Error('readDocument is not used in this test')),
};
