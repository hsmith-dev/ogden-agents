/**
 * Grok's checked binary is checked again before each start (12.4 review): its SHA-256 against the pinned table
 * for the pinned version, else against the install's record; a changed or unrecorded binary is never started.
 * Fixture files only: nothing here runs a binary.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGrokAgent, GROK_BINARY_CHANGED, grokBinaryUnchanged, GROK_CHECK_RECORD_SUFFIX, installedGrok, pinnedGrokVersion } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const platform = `${process.platform}-${process.arch}`;
const hashes = (text: string) => ({ [platform]: sha(text) }) as never;

/** An install folder as `installGrok` leaves it: `<data>/agents/grok/grok-<version>/bin-checked/grok[.exe]`. */
function install(version: string, content: string, record?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-grok-check-'));
  dirs.push(dataDir);
  const folder = join(dataDir, 'agents', 'grok', `grok-${version}`, 'bin-checked');
  mkdirSync(folder, { recursive: true });
  const path = join(folder, process.platform === 'win32' ? 'grok.exe' : 'grok');
  writeFileSync(path, content);
  if (record !== undefined) writeFileSync(`${path}${GROK_CHECK_RECORD_SUFFIX}`, `${record}\n`);
  return { dataDir, path, grok: installedGrok(dataDir)! };
}

describe('the checked binary is re-checked before each start', () => {
  it('the pinned version is checked against the pinned table, and a changed file is refused, even at the same size', () => {
    const version = pinnedGrokVersion();
    const { path, grok } = install(version, 'binary-one');
    expect(grok.path).toBe(path);
    expect(grokBinaryUnchanged(grok, hashes('binary-one'), version)).toBe(true);
    // Still the same state: not hashed again, still fine.
    expect(grokBinaryUnchanged(grok, hashes('binary-one'), version)).toBe(true);
    writeFileSync(path, 'binary-two');
    expect(grokBinaryUnchanged(grok, hashes('binary-one'), version)).toBe(false);
    // Not in the table at all: not trusted.
    expect(grokBinaryUnchanged(grok, {} as never, version)).toBe(false);
  });

  it('an earlier version that a later pin left in place is checked against the record its install wrote', () => {
    const { grok, path } = install('0.0.1', 'old-binary', sha('old-binary'));
    expect(grokBinaryUnchanged(grok, {} as never, '9.9.9')).toBe(true);
    writeFileSync(path, 'tampered!!');
    expect(grokBinaryUnchanged(grok, {} as never, '9.9.9')).toBe(false);
    // No record, or a malformed one: not trusted.
    const none = install('0.0.2', 'x');
    expect(grokBinaryUnchanged(none.grok, {} as never, '9.9.9')).toBe(false);
    const bad = install('0.0.3', 'x', 'not-a-hash');
    expect(grokBinaryUnchanged(bad.grok, {} as never, '9.9.9')).toBe(false);
  });

  it('a start with a changed binary is refused in plain words and logs why, before anything is spawned', async () => {
    const { dataDir } = install(pinnedGrokVersion(), 'not-the-pinned-binary');
    const notes: string[] = [];
    const agent = createGrokAgent({ dataDir, onDiagnostic: (message) => notes.push(message) });
    const failure = await agent.startSession({ cwd: tmpdir(), env: { PATH: process.env.PATH ?? '', GROK_HOME: dataDir, XAI_API_KEY: 'x' }, permissionMode: 'ask' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'agent_unavailable', message: GROK_BINARY_CHANGED });
    expect(notes).toContain('the checked Grok binary no longer matches its check');
  });
});
