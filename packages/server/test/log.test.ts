import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger, createRotatingFileWriter, teeWriters } from '../src/log.js';
import { tempDataDir } from './helpers.js';

describe('rotating log file', () => {
  it('appends JSON lines to a file readable only by the user', () => {
    const dir = join(tempDataDir(), 'logs');
    const log = createLogger(createRotatingFileWriter({ dir }));
    log.info('hello', { n: 1 });
    log.warn('careful');
    const lines = readFileSync(join(dir, 'server.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toMatchObject([
      { level: 'info', msg: 'hello', n: 1 },
      { level: 'warn', msg: 'careful' },
    ]);
    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, 'server.log')).mode & 0o777).toBe(0o600);
    }
  });

  it('rotates at the size cap and keeps at most maxFiles old files', () => {
    const dir = tempDataDir();
    const write = createRotatingFileWriter({ dir, maxBytes: 100, maxFiles: 2 });
    const line = (n: number) => `${String(n).padStart(2, '0')}${'x'.repeat(37)}\n`; // 40 bytes
    for (let n = 1; n <= 10; n++) write(line(n));

    expect(readdirSync(dir).sort()).toEqual(['server.log', 'server.log.1', 'server.log.2']);
    for (const name of readdirSync(dir)) expect(statSync(join(dir, name)).size).toBeLessThanOrEqual(100);
    // Two lines per file; the newest are in server.log.
    expect(readFileSync(join(dir, 'server.log'), 'utf8')).toBe(line(9) + line(10));
    expect(readFileSync(join(dir, 'server.log.1'), 'utf8')).toBe(line(7) + line(8));
    expect(readFileSync(join(dir, 'server.log.2'), 'utf8')).toBe(line(5) + line(6));
  });

  it('continues an existing file after a restart', () => {
    const dir = tempDataDir();
    createRotatingFileWriter({ dir, maxBytes: 100 })('a'.repeat(59) + '\n');
    createRotatingFileWriter({ dir, maxBytes: 100 })('b'.repeat(59) + '\n');
    expect(readdirSync(dir).sort()).toEqual(['server.log', 'server.log.1']);
  });

  it('tee keeps writing to the other sinks when one throws', () => {
    const lines: string[] = [];
    const write = teeWriters(
      () => {
        throw new Error('disk full');
      },
      (l) => lines.push(l),
    );
    write('x\n');
    expect(lines).toEqual(['x\n']);
  });
});
