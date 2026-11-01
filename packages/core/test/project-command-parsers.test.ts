/**
 * Problems' parsers (AD-38; 8.9): each fixture (real-looking output of the
 * TypeScript compiler, ESLint, Vitest, Jest, pytest, Go and Rust) to its
 * `file:line` items; paths outside the project dropped and absolute ones
 * inside it made relative; dedupe and the item cap; and hostile output
 * (one 1 MiB line, nested-looking patterns) parsed in well under a second.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_COMMAND_MAX_ITEMS } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { maskedOutput, parseProblems, projectRelativePath } from '../src/index.js';

const ROOT = '/home/me/proj';
const fixture = (name: string): string => maskedOutput(readFileSync(join(import.meta.dirname, 'fixtures', 'problems', name), 'utf8').replaceAll('{root}', ROOT), false);
const where = (name: string) => parseProblems(fixture(name), ROOT).items.map((item) => `${item.format} ${item.path}:${item.line}${item.column === undefined ? '' : `:${item.column}`} ${item.message}`);

describe('problem parsers', () => {
  it('reads the TypeScript compiler, both forms', () => {
    expect(where('tsc-paren.txt')).toEqual([
      "typescript src/a.ts:12:5 TS2322: Type 'string' is not assignable to type 'number'.",
      "typescript src/lib/b.ts:3:10 TS2304: Cannot find name 'missing'.",
    ]);
    expect(where('tsc-pretty.txt')).toEqual(["typescript src/a.ts:12:5 TS2322: Type 'string' is not assignable to type 'number'."]);
  });

  it('reads ESLint stylish (errors only, absolute paths made relative, outside dropped) and unix', () => {
    expect(where('eslint-stylish.txt')).toEqual(['eslint src/a.ts:12:5 Unexpected any. Specify a different type', "eslint src/b.ts:3:10 'x' is assigned a value but never used"]);
    expect(where('eslint-unix.txt')).toEqual(['eslint src/a.ts:12:5 Unexpected any. Specify a different type.']);
  });

  it('reads Vitest and Jest, with the failure and its output lines', () => {
    const vitest = parseProblems(fixture('vitest.txt'), ROOT).items;
    expect(vitest.map((item) => `${item.path}:${item.line}:${item.column} ${item.message}`)).toEqual(["src/wrap.test.ts:88:20 AssertionError: expected 'a b' to be 'a  b' // Object.is equality"]);
    expect(vitest[0]!.detail).toContain('+ a b');
    const jest = parseProblems(fixture('jest.txt'), ROOT).items;
    expect(jest.map((item) => `${item.format} ${item.path}:${item.line}:${item.column} ${item.message}`)).toEqual(['jest src/wrap.test.ts:88:17 expect(received).toBe(expected) // Object.is equality']);
    expect(jest[0]!.detail).toContain('Received: "a b"');
  });

  it('reads pytest: the located failure with its E lines, and a FAILED line without one', () => {
    expect(where('pytest.txt')).toEqual(["pytest tests/test_wrap.py:12 AssertionError: assert 'a b' == 'a  b'", 'pytest tests/test_other.py:1 ValueError: bad']);
  });

  it('reads Go tests and the compiler, and Rust errors and panics', () => {
    expect(where('go-test.txt')).toEqual(['go wrap_test.go:12 got "a b", want "a  b"']);
    expect(where('go-build.txt')).toEqual(['go wrap.go:12:5 undefined: missing', 'go wrap.go:20:2 declared and not used: x']);
    expect(where('cargo-build.txt')).toEqual(['rust src/main.rs:4:18 mismatched types']);
    expect(where('cargo-test.txt')).toEqual(['rust src/lib.rs:10:9 assertion `left == right` failed']);
  });

  it('says when no known format read the output', () => {
    expect(parseProblems('Something broke\nexit 1\n', ROOT)).toEqual({ items: [], parsed: false });
    // Recognized, but every path outside: parsed, no items.
    expect(parseProblems('/etc/passwd(1,1): error TS1: x\n', ROOT)).toEqual({ items: [], parsed: true });
  });

  it('keeps paths inside the project only', () => {
    expect(projectRelativePath('/etc/passwd', ROOT)).toBeUndefined();
    expect(projectRelativePath('../x.ts', ROOT)).toBeUndefined();
    expect(projectRelativePath('src/../../x.ts', ROOT)).toBeUndefined();
    expect(projectRelativePath('/home/me/proj-other/a.ts', ROOT)).toBeUndefined();
    expect(projectRelativePath(`${ROOT}/src/a.ts`, ROOT)).toBe('src/a.ts');
    expect(projectRelativePath('./src/a.ts', ROOT)).toBe('src/a.ts');
    expect(projectRelativePath('src\\a.ts', ROOT)).toBe('src/a.ts');
    expect(projectRelativePath('.git/config', ROOT)).toBeUndefined();
    expect(projectRelativePath('C:/proj/src/a.ts', 'C:\\Proj')).toBe('src/a.ts');
    expect(projectRelativePath(`file://${ROOT}/a.ts`, ROOT)).toBe('a.ts');
    expect(projectRelativePath('C:/proj2/a.ts', 'C:/proj')).toBeUndefined();
    expect(projectRelativePath('D:/elsewhere/a.ts', 'C:/proj')).toBeUndefined();
    expect(projectRelativePath('\\\\?\\C:\\proj\\a.ts', 'C:\\proj')).toBeUndefined();
    expect(projectRelativePath('//host/share/a.ts', ROOT)).toBeUndefined();
    expect(projectRelativePath('\\\\host\\share\\a.ts', 'C:\\proj')).toBeUndefined();
    expect(projectRelativePath('/P/x.ts', '/p')).toBeUndefined();
    expect(projectRelativePath('src/a\0.ts', ROOT)).toBeUndefined();
    expect(projectRelativePath('src//a.ts', ROOT)).toBe('src/a.ts');
    expect(projectRelativePath(`${ROOT}//src//a.ts`, ROOT)).toBe('src/a.ts');
  });

  it('reads Windows paths with a drive, made relative to a Windows root', () => {
    const root = 'C:\\proj';
    const lines = [
      "C:\\proj\\src\\a.ts:12:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
      'C:\\proj\\src\\b.ts:3:1: Unexpected any. [Error/no-explicit-any]',
      'C:\\proj\\pkg\\wrap.go:7:2: undefined: x',
      'D:\\other\\c.ts:1:1 - error TS1: outside',
    ].join('\n');
    expect(parseProblems(lines, root).items.map((item) => `${item.format} ${item.path}:${item.line}`)).toEqual(['typescript src/a.ts:12', 'eslint src/b.ts:3', 'go pkg/wrap.go:7']);
  });

  it('gives every format its output lines as detail', () => {
    for (const name of ['tsc-paren.txt', 'eslint-unix.txt', 'go-build.txt', 'go-test.txt', 'cargo-build.txt', 'cargo-test.txt', 'pytest.txt']) {
      const items = parseProblems(fixture(name), ROOT).items;
      expect(items.length, name).toBeGreaterThan(0);
      for (const item of items) expect(item.detail, name).toBeTruthy();
    }
    expect(parseProblems(fixture('tsc-paren.txt'), ROOT).items[0]!.detail).toBe("src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(parseProblems(fixture('cargo-build.txt'), ROOT).items[0]!.detail).toBe('error[E0308]: mismatched types\n --> src/main.rs:4:18');
    expect(parseProblems(fixture('cargo-test.txt'), ROOT).items[0]!.detail).toContain('panicked at src/lib.rs:10:9:');
  });

  it('deduplicates and caps the items', () => {
    const same = 'src/a.ts(1,1): error TS1: x\n'.repeat(3);
    expect(parseProblems(same, ROOT).items).toHaveLength(1);
    const many = Array.from({ length: 700 }, (_, i) => `src/a.ts(${i + 1},1): error TS1: x`).join('\n');
    expect(parseProblems(many, ROOT).items).toHaveLength(PROJECT_COMMAND_MAX_ITEMS);
  });

  it('parses hostile output in under a second', () => {
    const hostile = [
      `${'a'.repeat(1024 * 1024)}(`,
      `${'('.repeat(200_000)}`,
      `${'a:'.repeat(200_000)}1:1`,
      `  at ${'(a'.repeat(100_000)}:1:1`,
      `${'_'.repeat(100_000)} x`,
      ` FAIL ${'x'.repeat(100_000)}`,
      `  ❯ ${'a:'.repeat(100_000)}`,
      `panicked at ${'a:1'.repeat(100_000)}`,
      `${'panicked at a'.repeat(80_000)}`,
      `${'panicked at a'.repeat(300)}\n`.repeat(270),
      `${'1'.repeat(4000)}:${'2'.repeat(100_000)}:3: x [Error/${'y'.repeat(100_000)}`,
    ].join('\n');
    const started = performance.now();
    parseProblems(hostile.repeat(3), ROOT);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
