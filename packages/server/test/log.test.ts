import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger, createRotatingFileWriter, redact, REDACTED, teeWriters, TOO_DEEP } from '../src/log.js';
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

describe('redaction', () => {
  it('never writes credential headers, bearer or subprotocol tokens, launch codes or token fragments', () => {
    const token = 'A'.repeat(43);
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));
    log.warn('request', {
      headers: {
        Authorization: `Bearer ${token}`,
        'sec-websocket-protocol': `ogden.v1, ogden.auth.${token}`,
        cookie: `ogden_session_4317=${token}`,
        'x-ogden-launcher-token': token,
        host: '127.0.0.1:4317',
      },
      url: `http://127.0.0.1:4317/auth?code=${token}`,
      location: `/#t=${token}`,
      launchUrl: `http://127.0.0.1:4317/#c=${token}`,
      token,
      nested: [{ reason: `failed with Bearer ${token}` }],
      error: new Error(`offer ogden.auth.${token} refused`),
    });
    log.info(`message with Bearer ${token}`);
    const all = lines.join('');
    expect(all).not.toContain(token);
    const first = JSON.parse(lines[0]!) as { headers: Record<string, string>; url: string; location: string };
    expect(first.headers).toEqual({
      Authorization: REDACTED,
      'sec-websocket-protocol': REDACTED,
      cookie: REDACTED,
      'x-ogden-launcher-token': REDACTED,
      host: '127.0.0.1:4317',
    });
    expect(first.url).toBe(`http://127.0.0.1:4317/auth?code=${REDACTED}`);
    expect(first.location).toBe(`/#t=${REDACTED}`);
    expect((first as unknown as { launchUrl: string }).launchUrl).toBe(`http://127.0.0.1:4317/#c=${REDACTED}`);
    expect((first as unknown as { token: string }).token).toBe(REDACTED);
  });

  it('replaces values nested too deep to check with a placeholder', () => {
    const token = 'A'.repeat(43);
    let deep: Record<string, unknown> = { secret: `Bearer ${token}`, plain: token };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    const out = JSON.stringify(redact({ deep }));
    expect(out).not.toContain(token);
    expect(out).toContain(TOO_DEEP);
  });

  it('a boolean "token" diagnostic is kept; only a string token is redacted', () => {
    expect(redact({ token: true, launcherTokenFound: false })).toEqual({ token: true, launcherTokenFound: false });
    expect(redact({ token: 'abc' })).toEqual({ token: REDACTED });
  });

  it('leaves ordinary fields alone', () => {
    expect(redact({ port: 4317, msg: 'server listening', url: 'http://127.0.0.1:4317', code: 'EADDRINUSE' })).toEqual({
      port: 4317,
      msg: 'server listening',
      url: 'http://127.0.0.1:4317',
      code: 'EADDRINUSE',
    });
  });
});
