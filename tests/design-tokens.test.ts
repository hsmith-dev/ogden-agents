/**
 * AD-18 enforcement: `packages/web/src/ui/tokens.css` holds every DESIGN.md
 * token with DESIGN.md's value, so the two can't drift; and no raw color or
 * pixel value appears anywhere else in `packages/web/src`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const DESIGN_MD = join(ROOT, '_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md');
const WEB_SRC = join(ROOT, 'packages/web/src');
const TOKENS_CSS = join(WEB_SRC, 'ui/tokens.css');

interface Design {
  colors: Record<string, string>;
  typography: Record<string, { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; letterSpacing?: string }>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
  components: Record<string, Record<string, string>>;
}

function loadDesign(): Design {
  const source = readFileSync(DESIGN_MD, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (match === null) throw new Error('DESIGN.md has no YAML frontmatter');
  return parseYaml(match[1]!) as Design;
}

/** Declarations per block, keyed by the block's selector path (`@media … > :root:not(…)`). */
export type CssBlocks = Map<string, Map<string, string>>;

/** A small brace parser for plain token CSS: nested at-rules, no strings containing braces. */
export function parseBlocks(css: string): CssBlocks {
  const blocks: CssBlocks = new Map();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  let buffer = '';
  for (const char of stripped) {
    if (char === '{') {
      stack.push(buffer.trim().replace(/\s+/g, ' ').replace(/"/g, "'"));
      buffer = '';
    } else if (char === '}') {
      const key = stack.join(' > ');
      const declarations = blocks.get(key) ?? new Map<string, string>();
      for (const part of buffer.split(';')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const name = part.slice(0, colon).trim();
        if (name.startsWith('--')) declarations.set(name, part.slice(colon + 1).trim().replace(/\s+/g, ' '));
      }
      if (declarations.size > 0) blocks.set(key, declarations);
      stack.pop();
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return blocks;
}

const LIGHT = ':root';
const DARK_SYSTEM = "@media (prefers-color-scheme: dark) > :root:not([data-theme='light'])";
const DARK_OVERRIDE = ":root[data-theme='dark']";
const COMPACT = ":root[data-density='compact']";

/** Compares numbers and colors by value: `600` = `'600'`, `#F6F7F5` = `#f6f7f5`, `0.10` = `0.1`. */
const norm = (value: string | number) => {
  const text = String(value).trim().toLowerCase();
  return /^-?\d*\.?\d+(?:[a-z%]*)$/.test(text) ? text.replace(/^(-?)(\d*\.?\d+)/, (_m, sign: string, n: string) => `${sign}${Number(n)}`) : text;
};

/** Returns one message per DESIGN.md token missing from, or different in, tokens.css. */
export function findDrift(design: Design, blocks: CssBlocks): string[] {
  const problems: string[] = [];
  const expectVar = (block: string, name: string, value: string | number) => {
    const actual = blocks.get(block)?.get(name);
    if (actual === undefined) problems.push(`${block}: ${name} is missing (DESIGN.md: ${value})`);
    else if (norm(actual) !== norm(value)) problems.push(`${block}: ${name} is ${actual}, DESIGN.md says ${value}`);
  };

  const light = Object.entries(design.colors).filter(([name]) => !name.endsWith('-dark'));
  const dark = Object.entries(design.colors).filter(([name]) => name.endsWith('-dark'));
  for (const [name, value] of light) {
    expectVar(LIGHT, `--${name}`, value);
    if (!(`${name}-dark` in design.colors)) problems.push(`DESIGN.md: ${name} has no -dark value`);
  }
  for (const [name, value] of dark) {
    const base = name.slice(0, -'-dark'.length);
    expectVar(DARK_SYSTEM, `--${base}`, value);
    expectVar(DARK_OVERRIDE, `--${base}`, value);
  }

  for (const [role, spec] of Object.entries(design.typography)) {
    expectVar(LIGHT, `--type-${role}-size`, spec.fontSize);
    expectVar(LIGHT, `--type-${role}-weight`, spec.fontWeight);
    expectVar(LIGHT, `--type-${role}-line-height`, spec.lineHeight);
    if (spec.letterSpacing !== undefined) expectVar(LIGHT, `--type-${role}-tracking`, spec.letterSpacing);
    const familyVar = blocks.get(LIGHT)?.get(`--type-${role}-family`);
    const family = familyVar === undefined ? undefined : /^var\((--[\w-]+)\)$/.exec(familyVar)?.[1];
    const stack = family === undefined ? familyVar : blocks.get(LIGHT)?.get(family);
    const first = stack?.split(',')[0]?.trim().replace(/^'|'$/g, '').replace(/ Variable$/, '');
    if (first !== spec.fontFamily) problems.push(`${LIGHT}: --type-${role}-family starts with ${first}, DESIGN.md says ${spec.fontFamily}`);
  }

  for (const [name, value] of Object.entries(design.rounded)) expectVar(LIGHT, `--rounded-${name}`, value);
  for (const [name, value] of Object.entries(design.spacing)) expectVar(LIGHT, `--space-${name}`, value);

  // Density is a token swap: each `<x>-compact` token replaces the live `--<x>`.
  for (const name of Object.keys(design.spacing).filter((n) => n.endsWith('-compact'))) {
    const base = name.slice(0, -'-compact'.length);
    expectVar(LIGHT, `--${base}`, `var(--space-${base})`);
    expectVar(COMPACT, `--${base}`, `var(--space-${name})`);
  }
  for (const role of Object.keys(design.typography).filter((n) => n.endsWith('-compact'))) {
    const base = role.slice(0, -'-compact'.length);
    for (const part of ['family', 'size', 'weight', 'line-height']) {
      expectVar(LIGHT, `--${base}-${part}`, `var(--type-${base}-${part})`);
      expectVar(COMPACT, `--${base}-${part}`, `var(--type-${role}-${part})`);
    }
  }

  // Component sizes with raw values in DESIGN.md Components.
  const button = design.components['button-primary']!;
  expectVar(LIGHT, '--button-height', button.height!);
  expectVar(LIGHT, '--button-height-compact', button.heightCompact!);
  expectVar(COMPACT, '--control-height', 'var(--button-height-compact)');
  expectVar(LIGHT, '--glyph-size', design.components['status-glyph']!.size!);

  // Every color literal in tokens.css is a DESIGN.md color.
  const palette = new Set(Object.values(design.colors).map((c) => c.toLowerCase()));
  for (const [block, declarations] of blocks) {
    for (const [name, value] of declarations) {
      for (const hex of value.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
        if (!palette.has(hex.toLowerCase())) problems.push(`${block}: ${name} uses ${hex}, which is not a DESIGN.md color`);
      }
    }
  }
  return problems;
}

/**
 * Raw values that must come from tokens instead (AD-18): hex colors, color
 * functions, absolute or font-relative lengths (px, rem, em, vw, vh),
 * Tailwind's `*-px` utilities, and numeric JSX props or prop defaults such
 * as `sideOffset={4}` (tabIndex excepted).
 */
const RAW_VALUE = new RegExp(
  [
    String.raw`#[0-9a-fA-F]{3,8}\b`,
    String.raw`\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(`,
    String.raw`\b\d*\.?\d+(?:px|rem|em|vw|vh|dvh|svh|lvh)\b`,
    String.raw`-px\b`,
    String.raw`\b(?!tabIndex=)[A-Za-z]\w*=\{\s*-?\d*\.?\d+\s*\}`,
    String.raw`\b(?:sideOffset|alignOffset|delayDuration|skipDelayDuration|collisionPadding|arrowPadding)\s*=\s*-?\d`,
  ].join('|'),
  'g',
);

/** Returns one message per raw color or pixel literal in a web source file other than tokens.css. */
export function findRawValues(files: ReadonlyArray<{ path: string; source: string }>): string[] {
  const problems: string[] = [];
  for (const { path, source } of files) {
    if (path.replaceAll('\\', '/').endsWith('src/ui/tokens.css')) continue;
    source.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(RAW_VALUE)) problems.push(`${path}:${index + 1}: raw value "${match[0]}"; use a token`);
    });
  }
  return problems;
}

/** Visual utilities (color, radius, type, shadow, border) that belong in `ui/` components, not feature code. */
const VISUAL_CLASS = /^(?:bg-|border|rounded|shadow|font-|ring|outline-|opacity-|text-(?!left$|right$|center$|start$|end$|balance$|wrap$|nowrap$|pretty$))/;

/** The class names in `className="…"` and in string literals inside `className={…}`. */
function classNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) {
    const literals = match[1] !== undefined ? [match[1]] : [...match[2]!.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    for (const literal of literals) names.push(...literal.split(/\s+/).filter(Boolean));
  }
  return names;
}

/** Returns one message per visual utility class used in feature code (`src/shell`, `src/routes`). */
export function findFeatureStyling(files: ReadonlyArray<{ path: string; source: string }>): string[] {
  const problems: string[] = [];
  for (const { path, source } of files) {
    for (const name of classNames(source)) {
      const utility = name.split(':').at(-1)!.replace(/^!/, '');
      if (VISUAL_CLASS.test(utility)) problems.push(`${path}: "${name}" is visual styling; put it in a ui/ component`);
    }
  }
  return problems;
}

const GATE_TS = join(ROOT, 'packages/server/src/gate.ts');

/**
 * Checks the server-rendered launch page's inline CSS: each custom property
 * it copies equals DESIGN.md (colors, light and dark) or tokens.css (all
 * else), every rule reads only those properties, and no raw value appears
 * outside them.
 */
export function findLaunchPageDrift(css: string, design: Design, tokens: CssBlocks): string[] {
  const problems: string[] = [];
  const blocks = parseBlocks(css);
  const light = blocks.get(LIGHT) ?? new Map<string, string>();
  const colorNames = new Set(Object.keys(design.colors).filter((n) => !n.endsWith('-dark')));
  const copiedColors: string[] = [];
  for (const [name, value] of light) {
    const key = name.slice(2);
    const expected = colorNames.has(key) ? design.colors[key] : tokens.get(LIGHT)?.get(name);
    if (colorNames.has(key)) copiedColors.push(key);
    if (expected === undefined) problems.push(`launch page: ${name} is not a DESIGN.md token`);
    else if (norm(value) !== norm(expected)) problems.push(`launch page: ${name} is ${value}, the token is ${expected}`);
  }
  for (const block of [DARK_SYSTEM, DARK_OVERRIDE]) {
    const dark = blocks.get(block) ?? new Map<string, string>();
    for (const key of copiedColors) {
      const value = dark.get(`--${key}`);
      const expected = design.colors[`${key}-dark`]!;
      if (value === undefined) problems.push(`launch page ${block}: --${key} is missing`);
      else if (norm(value) !== norm(expected)) problems.push(`launch page ${block}: --${key} is ${value}, DESIGN.md says ${expected}`);
    }
    for (const name of dark.keys()) {
      if (!copiedColors.includes(name.slice(2))) problems.push(`launch page ${block}: ${name} has no light value`);
    }
  }
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;{}]/).filter((d) => !d.trim().startsWith('--'));
  for (const declaration of rules) {
    for (const match of declaration.matchAll(RAW_VALUE)) problems.push(`launch page: raw value "${match[0]}" in "${declaration.trim()}"`);
    for (const ref of declaration.matchAll(/var\((--[\w-]+)\)/g)) {
      if (!light.has(ref[1]!)) problems.push(`launch page: ${ref[1]} is used but not declared`);
    }
  }
  return problems;
}

function launchPageCss(): string {
  const source = readFileSync(GATE_TS, 'utf8');
  const match = /<style>([\s\S]*?)<\/style>/.exec(source);
  if (match === null) throw new Error('gate.ts: the launch page has no <style>');
  return match[1]!;
}

function loadWebSources() {
  return readdirSync(WEB_SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(tsx?|css)$/.test(entry))
    .map((entry) => ({ path: relative(ROOT, join(WEB_SRC, entry)), source: readFileSync(join(WEB_SRC, entry), 'utf8') }));
}

describe('design tokens (AD-18)', () => {
  it('tokens.css matches every token in DESIGN.md, in light, dark and compact', () => {
    const blocks = parseBlocks(readFileSync(TOKENS_CSS, 'utf8'));
    expect(findDrift(loadDesign(), blocks)).toEqual([]);
  });

  it('flags a changed, missing or foreign value', () => {
    const design: Design = {
      colors: { background: '#F6F7F5', 'background-dark': '#0F1210', ring: '#2F4FD8', 'ring-dark': '#8198FF' },
      typography: {},
      rounded: { md: '6px' },
      spacing: { 'row-height': '40px', 'row-height-compact': '30px' },
      components: { 'button-primary': { height: '36px', heightCompact: '30px' }, 'status-glyph': { size: '10px' } },
    };
    const css = `
      :root { --background: #f6f7f5; --ring: #123456; --rounded-md: 8px; --space-row-height: 40px; --space-row-height-compact: 30px;
              --row-height: var(--space-row-height); --button-height: 36px; --button-height-compact: 30px; --glyph-size: 10px; }
      @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --background: #0f1210; --ring: #8198ff; } }
      :root[data-theme="dark"] { --background: #0f1210; }
      :root[data-density="compact"] { --row-height: var(--space-row-height); --control-height: var(--button-height-compact); }
    `;
    expect(findDrift(design, parseBlocks(css))).toEqual([
      ':root: --ring is #123456, DESIGN.md says #2F4FD8',
      ":root[data-theme='dark']: --ring is missing (DESIGN.md: #8198FF)",
      ':root: --rounded-md is 8px, DESIGN.md says 6px',
      ":root[data-density='compact']: --row-height is var(--space-row-height), DESIGN.md says var(--space-row-height-compact)",
      ':root: --ring uses #123456, which is not a DESIGN.md color',
    ]);
  });

  it('no raw colors or pixel sizes in packages/web/src outside ui/tokens.css', () => {
    const files = loadWebSources();
    expect(files.length).toBeGreaterThan(10);
    expect(findRawValues(files)).toEqual([]);
  });

  it('feature code (src/shell, src/routes) composes ui/ components and uses no visual utilities', () => {
    const files = loadWebSources().filter((f) => /[\\/]src[\\/](?:shell|routes)[\\/]/.test(f.path));
    expect(files.length).toBeGreaterThan(3);
    expect(findFeatureStyling(files)).toEqual([]);
  });

  it('flags visual utilities in feature code, and allows layout ones', () => {
    const files = [
      {
        path: 'packages/web/src/shell/a.tsx',
        source: [
          '<span className="grid size-(--control-height) rounded-md bg-primary text-label" />',
          "<div className={cn('flex gap-2 px-(--panel-padding) md:max-lg:sr-only', ok && 'hover:bg-accent text-left')} />",
          '<p className="truncate font-semibold border-b shadow-float text-center" />',
        ].join('\n'),
      },
    ];
    expect(findFeatureStyling(files)).toEqual([
      'packages/web/src/shell/a.tsx: "rounded-md" is visual styling; put it in a ui/ component',
      'packages/web/src/shell/a.tsx: "bg-primary" is visual styling; put it in a ui/ component',
      'packages/web/src/shell/a.tsx: "text-label" is visual styling; put it in a ui/ component',
      'packages/web/src/shell/a.tsx: "hover:bg-accent" is visual styling; put it in a ui/ component',
      'packages/web/src/shell/a.tsx: "font-semibold" is visual styling; put it in a ui/ component',
      'packages/web/src/shell/a.tsx: "border-b" is visual styling; put it in a ui/ component',
      'packages/web/src/shell/a.tsx: "shadow-float" is visual styling; put it in a ui/ component',
    ]);
  });

  it("the launch page's copied tokens match DESIGN.md and tokens.css, and it uses no raw values", () => {
    const tokens = parseBlocks(readFileSync(TOKENS_CSS, 'utf8'));
    expect(findLaunchPageDrift(launchPageCss(), loadDesign(), tokens)).toEqual([]);
  });

  it('flags a launch page value that drifted, a missing dark value, or a raw value in a rule', () => {
    const design = loadDesign();
    const tokens = parseBlocks(readFileSync(TOKENS_CSS, 'utf8'));
    const css = `
      :root { --background: #F6F7F5; --ring: #000000; --space-4: 18px; --made-up: 1; }
      @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --background: #0F1210; } }
      :root[data-theme='dark'] { --background: #0F1210; --ring: #8198FF; }
      body { padding: var(--space-4); margin: 12px; color: var(--nope); }
    `;
    expect(findLaunchPageDrift(css, design, tokens)).toEqual([
      'launch page: --ring is #000000, the token is #2F4FD8',
      'launch page: --space-4 is 18px, the token is 16px',
      'launch page: --made-up is not a DESIGN.md token',
      "launch page @media (prefers-color-scheme: dark) > :root:not([data-theme='light']): --ring is missing",
      'launch page: raw value "12px" in "margin: 12px"',
      'launch page: --nope is used but not declared',
    ]);
  });

  it('flags hex colors, color functions and pixel literals, and ignores tokens.css', () => {
    const files = [
      { path: 'packages/web/src/shell/a.tsx', source: "<div className=\"h-[36px] bg-[#fff]\" style={{ color: 'rgb(0, 0, 0)' }} />\nconst ok = 'px-3 h-(--row-height)';" },
      { path: 'packages/web/src/ui/b.css', source: '.x { width: 1.5px; color: hsl(0 0% 0%); }' },
      { path: 'packages/web/src/ui/tokens.css', source: ':root { --x: #fff; --y: 4px; }' },
      {
        path: 'packages/web/src/ui/c.tsx',
        source: "<Content sideOffset={4} tabIndex={0} className=\"h-px w-[85vw] max-w-[2rem] p-0.5\" />\nfunction X({ delayDuration = 300 }) {}",
      },
    ];
    expect(findRawValues(files)).toEqual([
      'packages/web/src/shell/a.tsx:1: raw value "36px"; use a token',
      'packages/web/src/shell/a.tsx:1: raw value "#fff"; use a token',
      'packages/web/src/shell/a.tsx:1: raw value "rgb("; use a token',
      'packages/web/src/ui/b.css:1: raw value "1.5px"; use a token',
      'packages/web/src/ui/b.css:1: raw value "hsl("; use a token',
      'packages/web/src/ui/c.tsx:1: raw value "sideOffset={4}"; use a token',
      'packages/web/src/ui/c.tsx:1: raw value "-px"; use a token',
      'packages/web/src/ui/c.tsx:1: raw value "85vw"; use a token',
      'packages/web/src/ui/c.tsx:1: raw value "2rem"; use a token',
      'packages/web/src/ui/c.tsx:2: raw value "delayDuration = 3"; use a token',
    ]);
  });
});
