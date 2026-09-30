import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import envPaths from 'env-paths';
import { describe, expect, it } from 'vitest';
import { createDataDir, DATA_DIR_ENV, dataDirPath, ensureDataDir } from '../src/index.js';
import { tempDir } from './helpers.js';

describe('data folder', () => {
  it('uses the OS per-user data directory named ogdenmad by default', () => {
    const expected = envPaths('ogdenmad', { suffix: '' }).data;
    expect(dataDirPath({})).toBe(expected);
    expect(expected).toMatch(/ogdenmad$/i);
  });

  it('honours OGDENMAD_DATA_DIR, resolved to an absolute path', () => {
    const dir = join(tempDir(), 'data');
    expect(dataDirPath({ [DATA_DIR_ENV]: dir })).toBe(resolve(dir));
    expect(dataDirPath({ [DATA_DIR_ENV]: '  ' })).toBe(envPaths('ogdenmad', { suffix: '' }).data);
  });

  it('creates the folder, readable only by the user', () => {
    const dir = join(tempDir(), 'nested', 'data');
    expect(ensureDataDir({ [DATA_DIR_ENV]: dir })).toBe(dir);
    const stats = statSync(dir);
    expect(stats.isDirectory()).toBe(true);
    if (process.platform !== 'win32') expect(stats.mode & 0o777).toBe(0o700);
  });

  it('creates an explicit folder the same way', () => {
    const dir = join(tempDir(), 'explicit', 'data');
    expect(createDataDir(dir)).toBe(dir);
    if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
