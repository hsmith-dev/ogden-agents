import * as fs from 'node:fs';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_KEY_FILE } from '@ogden-agents/core';
import { describe, expect, it, vi } from 'vitest';
import { loadOrCreateAuthKey } from '../src/auth.js';
import { tempDataDir } from './helpers.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe('auth.key', () => {
  it('creates a 32-byte key readable only by the user, and reuses it', () => {
    const dir = tempDataDir();
    const key = loadOrCreateAuthKey(dir);
    expect(key).toHaveLength(32);
    if (process.platform !== 'win32') expect(statSync(join(dir, AUTH_KEY_FILE)).mode & 0o777).toBe(0o600);
    expect(loadOrCreateAuthKey(dir).equals(key)).toBe(true);
    expect(readdirSync(dir)).toEqual([AUTH_KEY_FILE]);
  });

  it('race: when another process creates the key after our read, uses theirs and never overwrites it', () => {
    const dir = tempDataDir();
    const file = join(dir, AUTH_KEY_FILE);
    const theirs = Buffer.alloc(32, 9);
    // Our first read finds nothing; the other process creates its key right after.
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      writeFileSync(file, theirs, { mode: 0o600 });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(loadOrCreateAuthKey(dir).equals(theirs)).toBe(true);
    expect(readFileSync(file).equals(theirs)).toBe(true);
    // No temp file is left behind.
    expect(readdirSync(dir)).toEqual([AUTH_KEY_FILE]);
  });

  it('replaces a corrupt key found at start-up', () => {
    const dir = tempDataDir();
    const file = join(dir, AUTH_KEY_FILE);
    writeFileSync(file, 'short');
    const key = loadOrCreateAuthKey(dir);
    expect(key).toHaveLength(32);
    expect(readFileSync(file).equals(key)).toBe(true);
    expect(readdirSync(dir)).toEqual([AUTH_KEY_FILE]);
  });
});
