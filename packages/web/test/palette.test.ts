import { describe, expect, it } from 'vitest';
import { contrast, isColor, parseCustomPalette, validColors } from '../src/appearance/palette';
import { parseAppearance, saveAppearance, loadAppearance } from '../src/appearance/appearance';
const custom = {
  light: { background: '#ffffff', foreground: '#141715', signal: '#2f4fd8' },
  dark: { background: '#0f1210', foreground: '#e6eae6', signal: '#8198ff' },
};
describe('custom palettes', () => {
  it('accepts accessible color pairs and normalizes only recognized fields', () => {
    expect(parseCustomPalette({ ...custom, stylesheet: 'bad', light: { ...custom.light, signal: '#2F4FD8', extra: 'bad' } })).toEqual(custom);
    expect(contrast('#ffffff', '#000000')).toBe(21);
  });
  it('rejects unsafe CSS and colors below the accessibility floor', () => {
    for (const value of ['red', '#fff', 'url(https://example.com)', '#123456;display:none', null]) expect(isColor(value)).toBe(false);
    expect(validColors({ ...custom.light, foreground: '#eeeeee' })).toBe(false);
    expect(validColors({ ...custom.light, signal: '#eeeeee' })).toBe(false);
    expect(parseCustomPalette({ light: custom.light })).toBeUndefined();
  });
  it('persists both modes and rejects damaged custom selections safely', () => {
    const appearance = { theme: 'system' as const, density: 'comfortable' as const, developerMode: false, terminalScreenReader: false, palette: 'custom' as const, customPalette: custom };
    const values = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => void values.set(key, value), getItem: (key: string) => values.get(key) ?? null };
    saveAppearance(appearance, storage);
    expect(loadAppearance(storage)).toEqual(appearance);
    expect(parseAppearance('{"palette":"custom","customPalette":{"light":{"background":"javascript:bad"}}}').palette).toBeUndefined();
    expect(parseAppearance('{"palette":"forest"}').palette).toBe('forest');
  });
});
