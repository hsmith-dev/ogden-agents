import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { bootScript } from '../vite.config';
import { applyPalette } from '../src/appearance/palette';
const custom = { light: { background: '#ffffff', foreground: '#141715', signal: '#2f4fd8' }, dark: { background: '#0f1210', foreground: '#e6eae6', signal: '#8198ff' } };
function run(saved: unknown, systemDark = false, blocked = false) {
  const values = new Map<string, string>();
  const attributes = new Map<string, string>();
  const root = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    },
  };
  const context = {
    document: { documentElement: root },
    window: { location: { hash: '' }, matchMedia: () => ({ matches: systemDark }) },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => { if (blocked) throw new Error('blocked'); return typeof saved === 'string' ? saved : JSON.stringify(saved); } },
  };
  runInNewContext(bootScript(), context);
  return { values, attributes, context, root };
}
describe('palette before first paint', () => {
  it('applies saved custom tokens in light, dark and system mode without the app bundle', () => {
    for (const [theme, systemDark, mode] of [['light', false, 'light'], ['dark', false, 'dark'], ['system', true, 'dark'], ['system', false, 'light']] as const) {
      const result = run({ theme, palette: 'custom', customPalette: custom }, systemDark);
      expect(result.values.get('--background')).toBe(custom[mode].background);
      expect(result.values.get('--foreground')).toBe(custom[mode].foreground);
      expect(result.values.get('--signal')).toBe(custom[mode].signal);
    }
  });
  it('uses the shared palette implementation for preset swaps', () => {
    for (const palette of ['forest', 'ember'] as const) {
      const result = run({ theme: 'dark', palette, density: 'compact', developerMode: true });
      const expected = new Map<string, string>();
      applyPalette({ style: { removeProperty: (name: string) => expected.delete(name), setProperty: (name: string, value: string) => expected.set(name, value) } } as unknown as HTMLElement, palette);
      expect(result.values).toEqual(expected);
      expect(result.attributes.get('data-density')).toBe('compact');
      expect(result.attributes.get('data-developer')).toBe('true');
    }
  });
  it('retains default tokens for inaccessible, unsafe, damaged or unavailable saved preferences', () => {
    for (const saved of [null, 'not JSON', { palette: 'unknown' }, { palette: 'custom' }, { palette: 'custom', customPalette: { ...custom, light: { ...custom.light, foreground: '#ffffff' } } }, { palette: 'custom', customPalette: { ...custom, dark: { ...custom.dark, signal: 'url(https://example.com)' } } }]) expect(run(saved).values.size).toBe(0);
    expect(run({}, false, true).values.size).toBe(0);
  });
});
