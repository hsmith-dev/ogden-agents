/**
 * Syntax and diff colors (epic 8 entry 2): every syntax token and the diff
 * gutter reads at 4.5:1 or more on every surface code sits on, in the
 * default light and dark themes (tokens.css) and in custom palettes, where
 * each is derived from its default mixed toward the foreground. The
 * Tailwind theme exposes them as `--color-syntax-*` and `--color-diff-*`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPalette, contrast, readableOn, SYNTAX_COLORS, type CustomPalette } from '../src/appearance/palette';

const TOKENS = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
const THEME = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');

/** The hex tokens of the first block opened by `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = TOKENS.indexOf('{', TOKENS.indexOf(selector));
  const block = TOKENS.slice(start, TOKENS.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1]!, match[2]!.toLowerCase()]));
}

const THEMES = { light: tokens(':root {'), dark: tokens(":root[data-theme='dark'] {") };
/** Where code and diff text sit: the page, cards and popovers, the muted surface, and the diff rows. */
const CODE_SURFACES = ['background', 'card', 'popover', 'muted', 'diff-add', 'diff-add-strong', 'diff-remove', 'diff-remove-strong'];

const PALETTES: CustomPalette[] = [
  { light: { background: '#ffffff', foreground: '#141715', signal: '#2f4fd8' }, dark: { background: '#0f1210', foreground: '#e6eae6', signal: '#8198ff' } },
  // A warm, low-contrast-for-syntax pair: the defaults alone would not read on it.
  { light: { background: '#f3e3c3', foreground: '#2a1d0e', signal: '#7a3b00' }, dark: { background: '#3a1f4d', foreground: '#f5ecff', signal: '#ffd166' } },
  { light: { background: '#d9f0ff', foreground: '#04213a', signal: '#00509e' }, dark: { background: '#20322a', foreground: '#e8fff2', signal: '#7ee0b0' } },
];

/** A root element whose style is a map, so the palette's writes can be read back. */
function fakeRoot() {
  const values = new Map<string, string>();
  const style = { setProperty: (name: string, value: string) => void values.set(name, value), removeProperty: (name: string) => void values.delete(name), getPropertyValue: (name: string) => values.get(name) ?? '' };
  return { root: { style } as unknown as HTMLElement, values };
}

const realComputed = globalThis.getComputedStyle;
afterEach(() => {
  globalThis.getComputedStyle = realComputed;
});

describe('syntax and diff tokens', () => {
  it('reads at 4.5:1 on every code surface in the default light and dark themes', () => {
    for (const [theme, values] of Object.entries(THEMES)) {
      for (const token of SYNTAX_COLORS) {
        for (const surface of CODE_SURFACES) {
          expect(values[token], `${theme} ${token}`).toBeDefined();
          expect(contrast(values[token]!, values[surface]!), `${theme} ${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('is in the Tailwind theme as --color-syntax-* and --color-diff-*', () => {
    for (const token of [...SYNTAX_COLORS, 'diff-add', 'diff-add-strong', 'diff-remove', 'diff-remove-strong']) expect(THEME).toContain(`--color-${token}: var(--${token});`);
  });

  it('derives each syntax token and the gutter of a custom palette until it reads at 4.5:1 on every custom surface, in both themes', () => {
    for (const palette of PALETTES) {
      for (const dark of [false, true]) {
        const defaults = THEMES[dark ? 'dark' : 'light'];
        globalThis.getComputedStyle = (() => ({ getPropertyValue: (name: string) => defaults[name.replace(/^--/, '')] ?? '' })) as unknown as typeof getComputedStyle;
        const { root, values } = fakeRoot();
        applyPalette(root, 'custom', palette, dark);
        const surfaces = new Set(CODE_SURFACES.map((surface) => values.get(`--${surface}`)!));
        for (const token of SYNTAX_COLORS) {
          const color = values.get(`--${token}`);
          expect(color, token).toMatch(/^#[0-9a-f]{6}$/);
          for (const surface of surfaces) expect(contrast(color!, surface), `${JSON.stringify(palette[dark ? 'dark' : 'light'])} ${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        // Reset removes them again.
        applyPalette(root, 'default');
        for (const token of SYNTAX_COLORS) expect(values.has(`--${token}`), token).toBe(false);
      }
    }
  });

  it('keeps a default that already reads, and falls back to the foreground for a value that is not a color', () => {
    expect(readableOn('#2841a7', '#141715', ['#ffffff'])).toBe('#2841a7');
    expect(readableOn('', '#141715', ['#ffffff'])).toBe('#141715');
    const mixed = readableOn('#9fb1f8', '#141715', ['#ffffff']);
    expect(mixed).not.toBe('#9fb1f8');
    expect(contrast(mixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
