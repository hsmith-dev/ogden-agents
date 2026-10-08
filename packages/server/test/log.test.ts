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

  it('an Anthropic API key is redacted by field name and wherever it appears in a value (story 9.2 backstop)', () => {
    const key = 'sk-ant-api03-backstop_0123456789-abcdefghij';
    expect(redact({ apiKey: key, api_key: key, 'X-Api-Key': key, ANTHROPIC_API_KEY: key })).toEqual({
      apiKey: REDACTED,
      api_key: REDACTED,
      'X-Api-Key': REDACTED,
      ANTHROPIC_API_KEY: REDACTED,
    });
    const out = JSON.stringify(redact({ reason: `failed with ${key} inside`, nested: [{ text: `env ${key}` }] }));
    expect(out).not.toContain(key);
    expect(out).not.toContain('backstop_0123456789');
    expect(out).toContain('failed with [redacted] inside');
  });

  it('an API key split across lines, raw or escaped, or cut at the end of a line, is redacted with its continuation (review F6)', () => {
    const head = 'sk-ant-api03-SPLITHEAD_0123456789';
    const tail = 'SPLITTAIL_abcdefghij-WXYZ';
    for (const text of [`key: ${head}\n${tail}\nnext`, `key: ${head}\r\n${tail}`, `key: ${head}\\n${tail}`, `"${head}\n\n${tail}"`]) {
      const out = redact(text) as string;
      expect(out, JSON.stringify(text)).not.toContain('SPLITHEAD');
      expect(out, JSON.stringify(text)).not.toContain('SPLITTAIL');
      expect(out).toContain(REDACTED);
    }
    // A key cut before its prefix ends: the start is redacted, and so is what follows on the next line.
    for (const [cut, rest] of [['sk-an', 't-api03-CUTREST_0123456789'], ['sk-a', 'nt-api03-CUTREST_0123456789'], ['sk-', 'ant-api03-CUTREST_0123456789']] as const) {
      const out = redact(`prefix ${cut}\n${rest}`) as string;
      expect(out).not.toContain('CUTREST');
      expect(redact(`line ends with ${cut}`)).toBe(`line ends with ${REDACTED}`);
    }
    expect(redact('just sk-ant')).toBe(`just ${REDACTED}`);
    // Ordinary text is kept. (A word that merely contains "sk-ant", such as "task-ant", is redacted: a backstop errs that way.)
    expect(redact('a risk-free sketch of sk8 and ask-me')).toBe('a risk-free sketch of sk8 and ask-me');
  });

  it('an OpenAI or xAI API key is redacted by field name and wherever it appears, wrapped too (epic 12 entry 4)', () => {
    const openai = `sk-proj-${'O'.repeat(30)}BACKSTOP`;
    const xai = `xai-${'X'.repeat(30)}XAITAIL`;
    expect(redact({ CODEX_API_KEY: openai, OPENAI_API_KEY: openai, XAI_API_KEY: xai })).toEqual({ CODEX_API_KEY: REDACTED, OPENAI_API_KEY: REDACTED, XAI_API_KEY: REDACTED });
    const out = JSON.stringify(redact({ reason: `failed with ${openai} and ${xai} inside`, wrapped: `key: sk-proj-HEAD_0123456789\nTAIL_4567` }));
    expect(out).not.toContain('BACKSTOP');
    expect(out).not.toContain('XAITAIL');
    expect(out).not.toContain('HEAD_0123');
    expect(out).not.toContain('TAIL_4567');
    expect(out).toContain('failed with [redacted] and [redacted] inside');
    // Ordinary words are left alone, and a key glued to a name is still found.
    expect(JSON.stringify(redact({ note: 'a task-based desk-research plan' }))).toContain('task-based desk-research');
    expect(JSON.stringify(redact({ note: `OPENAI_KEY_${openai}` }))).not.toContain('BACKSTOP');
  });

  it("a Google (Gemini) API key is redacted by field name and wherever it appears, wrapped too (epic 6 entry 5)", () => {
    const key = `AIza${'G'.repeat(27)}BACKSTOP`;
    expect(redact({ GEMINI_API_KEY: key, google_api_key: key })).toEqual({ GEMINI_API_KEY: REDACTED, google_api_key: REDACTED });
    const out = JSON.stringify(redact({ reason: `failed with ${key} inside`, wrapped: `key: AIzaHEAD_0123\nTAIL_4567` }));
    expect(out).not.toContain('BACKSTOP');
    expect(out).not.toContain('HEAD_0123');
    expect(out).not.toContain('TAIL_4567');
    expect(out).toContain('failed with [redacted] inside');
  });

  it('a remote machine’s SSH private key is redacted by field name and wherever the PEM block appears in a value (CAP-24, AD-26, epic 18 story 18.2)', () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQy\n-----END OPENSSH PRIVATE KEY-----\n';
    expect(redact({ private_key: pem, privatekey: pem, passphrase: 'correct-horse-battery-staple' })).toEqual({
      private_key: REDACTED,
      privatekey: REDACTED,
      passphrase: REDACTED,
    });
    const out = JSON.stringify(redact({ reason: `could not store the key: ${pem}`, nested: [{ text: `key was ${pem}` }] }));
    expect(out).not.toContain('b3Blb');
    expect(out).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(out).toContain('could not store the key: [redacted]');
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
