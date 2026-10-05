/**
 * Every test hook acts only through `testHooksAllowed` (story 10.8, epic 9
 * retro): shipped source (`packages/*\/src`, `bin/`) declares each
 * `OGDEN_AGENTS_TEST_*` name only in `packages/server/src/test-hooks.ts`, and
 * reads a hook's variable only inside a function that calls
 * `testHooksAllowed`. A static scan, so a new hook that bypasses the gate
 * fails here before it ships.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const HOOKS_FILE = 'packages/server/src/test-hooks.ts';
const PREFIX = 'OGDEN_AGENTS_TEST_';

/** `text` with every comment blanked out (offsets and newlines kept), strings and templates left as they are. */
function stripComments(text: string): string {
  const out = text.split('');
  let i = 0;
  let quote: string | undefined;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (quote !== undefined) {
      if (c === '\\') i += 2;
      else {
        if (c === quote) quote = undefined;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) if (out[i] !== '\n') out[i] = ' ';
    } else i++;
  }
  return out.join('');
}

/** The `[start, end)` spans of every braced function body in `code` (declarations, expressions, arrows, methods). */
function functionSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const opener = /\bfunction\b[^{;]*\{|=>\s*\{|^\s*(?:async\s+)?(?!(?:if|for|while|switch|catch|return|else)\b)\w+\s*\([^)]*\)\s*(?::[^{;=]+)?\{/gm;
  for (const match of code.matchAll(opener)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let j = open; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}' && --depth === 0) {
        spans.push([open, j + 1]);
        break;
      }
    }
  }
  return spans;
}

interface Violation {
  file: string;
  line: number;
  why: string;
}

/** `code` with every `import … from` and `export { … } from` statement blanked out (offsets kept). */
function withoutModuleStatements(code: string): string {
  return code.replace(/^\s*(?:import\b[^;]*?\bfrom\s*['"][^'"]+['"]|export\s*(?:type\s*)?\{[^}]*\}\s*from\s*['"][^'"]+['"])\s*;?/gm, (statement) => statement.replace(/[^\n]/g, ' '));
}

/** `hookNames` plus every name any of `texts` imports or re-exports one under (`X as Y`), to a fixed point. */
function hookAliases(texts: readonly string[], hookNames: readonly string[]): string[] {
  const names = new Set(hookNames);
  for (let grew = true; grew; ) {
    grew = false;
    for (const text of texts) {
      for (const alias of stripComments(text).matchAll(/\b(\w+)\s+as\s+(\w+)/g)) {
        if (names.has(alias[1]!) && !names.has(alias[2]!)) {
          names.add(alias[2]!);
          grew = true;
        }
      }
    }
  }
  return [...names];
}

/**
 * Checks one shipped file. `hookNames`: the constants that hold a hook's
 * variable name (as declared in `test-hooks.ts`), with their aliases
 * ({@link hookAliases}). In `test-hooks.ts` a read must sit in a function
 * that calls `testHooksAllowed`; anywhere else a hook name may only be
 * imported or re-exported (`export { … } from`), never referenced, and
 * `test-hooks.ts` may not be imported as a namespace.
 */
function auditSource(file: string, text: string, hookNames: readonly string[]): Violation[] {
  const code = stripComments(text);
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  const violations: Violation[] = [];
  const isHooksFile = file === HOOKS_FILE;
  for (const match of code.matchAll(new RegExp(`${PREFIX}\\w*`, 'g'))) {
    const lineStart = code.lastIndexOf('\n', match.index) + 1;
    const lineText = code.slice(lineStart, code.indexOf('\n', match.index) === -1 ? undefined : code.indexOf('\n', match.index));
    const declaration = /^export const \w+ = '[A-Z0-9_]+';\s*$/.test(lineText);
    if (!isHooksFile || !declaration) violations.push({ file, line: lineOf(match.index), why: `${match[0]} outside a test-hooks.ts declaration` });
  }
  // Names a file may use for a hook constant: its own, and any alias it imports one under.
  const names = new Set(hookNames);
  for (const alias of code.matchAll(/\b(\w+)\s+as\s+(\w+)/g)) if (names.has(alias[1]!)) names.add(alias[2]!);
  if (!isHooksFile) {
    for (const match of code.matchAll(/\bimport\s+\*\s+as\s+\w+\s+from\s*['"][^'"]*test-hooks(?:\.js)?['"]/g)) {
      violations.push({ file, line: lineOf(match.index), why: 'imports test-hooks as a namespace' });
    }
    if (names.size === 0) return violations;
    const body = withoutModuleStatements(code);
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])(${[...names].join('|')})(?![\\w$])`, 'g'))) {
      violations.push({ file, line: lineOf(match.index), why: `references ${match[1]} outside test-hooks.ts` });
    }
    return violations;
  }
  if (names.size === 0) return violations;
  const spans = functionSpans(code);
  const read = new RegExp(`\\[\\s*(${[...names].join('|')})\\s*\\]`, 'g');
  for (const match of code.matchAll(read)) {
    const at = match.index;
    const enclosing = spans.filter(([start, end]) => start <= at && at < end).sort((a, b) => a[1] - a[0] - (b[1] - b[0]))[0];
    if (enclosing === undefined || !code.slice(enclosing[0], enclosing[1]).includes('testHooksAllowed(')) {
      violations.push({ file, line: lineOf(at), why: `reads ${match[1]} in a function that doesn't call testHooksAllowed` });
    }
  }
  return violations;
}

/** The hook constants `test-hooks.ts` declares. */
function hookConstants(text: string): string[] {
  return [...stripComments(text).matchAll(new RegExp(`^export const (\\w+) = '${PREFIX}\\w*';`, 'gm'))].map((match) => match[1]!);
}

function shippedFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(path);
      } else if (/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    try {
      walk(join(ROOT, 'packages', pkg, 'src'));
    } catch {
      // A package without src.
    }
  }
  walk(join(ROOT, 'bin'));
  return files;
}

describe('test hooks act only through testHooksAllowed (story 10.8)', () => {
  it('shipped source declares every OGDEN_AGENTS_TEST_* name in test-hooks.ts and reads each only beside testHooksAllowed', () => {
    const hooks = hookConstants(readFileSync(join(ROOT, HOOKS_FILE), 'utf8'));
    // The seven hooks at the time of writing; a new one joins this list.
    expect(hooks.length).toBeGreaterThanOrEqual(7);
    const files = shippedFiles();
    expect(files.map((file) => relative(ROOT, file).split(sep).join('/'))).toContain(HOOKS_FILE);
    const texts = files.map((file) => readFileSync(file, 'utf8'));
    const names = hookAliases(texts, hooks);
    const violations = files.flatMap((file, index) => auditSource(relative(ROOT, file).split(sep).join('/'), texts[index]!, names));
    expect(violations).toEqual([]);
  });

  it('self-test: a hook literal outside test-hooks.ts, and a read without the gate, are both caught and named', () => {
    const bad = [
      "const SNEAKY_ENV = 'OGDEN_AGENTS_TEST_SNEAKY';",
      'export function sneaky(env: Record<string, string | undefined>) {',
      "  return env[SNEAKY_ENV] === '1';",
      '}',
      'export function readsDirectly() {',
      '  return process.env.OGDEN_AGENTS_TEST_OTHER;',
      '}',
    ].join('\n');
    expect(auditSource('packages/server/src/sneaky.ts', bad, ['SNEAKY_ENV'])).toEqual([
      { file: 'packages/server/src/sneaky.ts', line: 1, why: 'OGDEN_AGENTS_TEST_SNEAKY outside a test-hooks.ts declaration' },
      { file: 'packages/server/src/sneaky.ts', line: 6, why: 'OGDEN_AGENTS_TEST_OTHER outside a test-hooks.ts declaration' },
      { file: 'packages/server/src/sneaky.ts', line: 1, why: 'references SNEAKY_ENV outside test-hooks.ts' },
      { file: 'packages/server/src/sneaky.ts', line: 3, why: 'references SNEAKY_ENV outside test-hooks.ts' },
    ]);
  });

  it('self-test: in test-hooks.ts, a gated read and a commented mention pass; an ungated read, an imported alias and a stray literal fail', () => {
    const sample = [
      "export const GOOD_ENV = 'OGDEN_AGENTS_TEST_GOOD';",
      '// OGDEN_AGENTS_TEST_IN_A_COMMENT is fine.',
      'export function good(env: Env, dataDir: string) {',
      "  return env[GOOD_ENV] === '1' && testHooksAllowed(env, dataDir);",
      '}',
      'export const ungated = (env: Env) => {',
      '  return env[GOOD_ENV];',
      '};',
      "const stray = { name: 'OGDEN_AGENTS_TEST_STRAY' };",
    ].join('\n');
    expect(auditSource(HOOKS_FILE, sample, ['GOOD_ENV']).map((violation) => violation.line)).toEqual([9, 7]);
    const aliased = ["import { GOOD_ENV as G } from './test-hooks.js';", 'export function f(env: Env) {', '  return env[G];', '}'].join('\n');
    expect(auditSource('packages/server/src/other.ts', aliased, hookAliases([aliased], ['GOOD_ENV'])).map((violation) => violation.why)).toEqual([
      'references G outside test-hooks.ts',
    ]);
  });

  it('self-test: outside test-hooks.ts, re-exports pass; a namespace import, an alias re-exported in one file and used in another, and a plain copy fail', () => {
    const reexport = ["export { GOOD_ENV, testHooksAllowed } from './test-hooks.js';", "import { GOOD_ENV } from './test-hooks.js';"].join('\n');
    expect(auditSource('packages/server/src/start-env.ts', reexport, ['GOOD_ENV'])).toEqual([]);

    const namespace = ["import * as h from './test-hooks.js';", 'export function f(env: Env) {', '  return env[h.GOOD_ENV];', '}'].join('\n');
    expect(auditSource('packages/server/src/ns.ts', namespace, ['GOOD_ENV']).map((violation) => violation.why)).toEqual(['imports test-hooks as a namespace']);

    const relay = "export { GOOD_ENV as RELAYED } from './test-hooks.js';";
    const user = ["import { RELAYED } from './relay.js';", 'export function f(env: Env) {', '  return env[RELAYED];', '}'].join('\n');
    const names = hookAliases([relay, user], ['GOOD_ENV']);
    expect(names).toContain('RELAYED');
    expect(auditSource('packages/server/src/relay.ts', relay, names)).toEqual([]);
    expect(auditSource('packages/server/src/user.ts', user, names).map((violation) => violation.line)).toEqual([3]);

    const copy = ["import { GOOD_ENV } from './test-hooks.js';", 'const k = GOOD_ENV;', 'export function f(env: Env) {', '  return env[k];', '}'].join('\n');
    expect(auditSource('packages/server/src/copy.ts', copy, ['GOOD_ENV']).map((violation) => violation.why)).toEqual(['references GOOD_ENV outside test-hooks.ts']);
  });
});
