/** The test command's detection and the failing count (story 5.8). */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectTestCommand, failedTestCount } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-verify-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const manifest = (test: string) => JSON.stringify({ scripts: { test } });

describe('detectTestCommand (story 5.8)', () => {
  it("is the project's own setting first, then a Tests line in AGENTS.md, then package.json's test script by its lockfile", () => {
    expect(detectTestCommand(project({ 'AGENTS.md': '- Tests: `make check`\n', 'package.json': manifest('vitest') }), 'just test')).toBe('just test');
    expect(detectTestCommand(project({ 'AGENTS.md': '## Running\n\n- Tests: `make check`\n', 'package.json': manifest('vitest') }), null)).toBe('make check');
    expect(detectTestCommand(project({ 'AGENTS.md': '**Test command:** `pytest -q`\n' }), null)).toBe('pytest -q');
    expect(detectTestCommand(project({ 'package.json': manifest('vitest run') }), null)).toBe('npm test');
    expect(detectTestCommand(project({ 'package.json': manifest('vitest run'), 'pnpm-lock.yaml': '' }), null)).toBe('pnpm test');
    expect(detectTestCommand(project({ 'package.json': manifest('vitest run'), 'yarn.lock': '' }), null)).toBe('yarn test');
  });

  it('finds none when AGENTS.md only names several suites, the script is npm init\'s default or absent, or a file is a link or too big', () => {
    expect(detectTestCommand(project({ 'AGENTS.md': '- Backend Tests: `pytest` in backend/\n- Frontend Tests: `npm run test`\n' }), null)).toBeUndefined();
    expect(detectTestCommand(project({ 'package.json': manifest('echo "Error: no test specified" && exit 1') }), null)).toBeUndefined();
    expect(detectTestCommand(project({ 'package.json': JSON.stringify({ scripts: {} }) }), null)).toBeUndefined();
    expect(detectTestCommand(project({ 'package.json': '{not json' }), null)).toBeUndefined();
    expect(detectTestCommand(project({}), null)).toBeUndefined();
    expect(detectTestCommand(project({ 'AGENTS.md': `- Tests: \`${'x'.repeat(600)}\`\n` }), null)).toBeUndefined();
    const linked = project({});
    writeFileSync(join(linked, 'real.json'), manifest('vitest'));
    symlinkSync(join(linked, 'real.json'), join(linked, 'package.json'));
    expect(detectTestCommand(linked, null)).toBeUndefined();
    const folder = project({});
    mkdirSync(join(folder, 'package.json'));
    expect(detectTestCommand(folder, null)).toBeUndefined();
  });
});

describe('failedTestCount (story 5.8)', () => {
  it('reads a runner\'s failing count', () => {
    expect(failedTestCount('Tests: 3 failed, 2 passed, 5 total')).toBe(3);
    expect(failedTestCount('Tests  3 failed | 2 passed (5)')).toBe(3);
    expect(failedTestCount('=== 4 failed, 10 passed in 1.2s ===')).toBe(4);
    expect(failedTestCount('failures: 2')).toBe(2);
    expect(failedTestCount('Tests: 5 passed, 5 total')).toBeUndefined();
    expect(failedTestCount('0 failed')).toBeUndefined();
    expect(failedTestCount('')).toBeUndefined();
  });
});
