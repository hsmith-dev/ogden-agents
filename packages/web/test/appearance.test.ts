import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, loadAppearance, parseAppearance, saveAppearance } from '../src/appearance/appearance';

describe('appearance preferences', () => {
  it('defaults to System theme, Comfortable density, Developer mode off', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE).toEqual({ theme: 'system', density: 'comfortable', developerMode: false, terminalScreenReader: false });
  });

  it('keeps valid fields and drops invalid or corrupt ones', () => {
    expect(parseAppearance('{"theme":"dark","density":"compact","developerMode":true,"terminalScreenReader":true}')).toEqual({
      theme: 'dark',
      density: 'compact',
      developerMode: true,
      terminalScreenReader: true,
    });
    expect(parseAppearance('{"theme":"purple","density":1,"developerMode":"yes","terminalScreenReader":1}')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('not json')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('null')).toEqual(DEFAULT_APPEARANCE);
  });

  it('round-trips through storage, and survives storage that throws', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    saveAppearance({ theme: 'light', density: 'compact', developerMode: false, terminalScreenReader: false }, storage);
    expect(map.has(APPEARANCE_KEY)).toBe(true);
    expect(loadAppearance(storage)).toEqual({ theme: 'light', density: 'compact', developerMode: false, terminalScreenReader: false });

    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadAppearance(broken)).toEqual(DEFAULT_APPEARANCE);
    expect(() => saveAppearance(DEFAULT_APPEARANCE, broken)).not.toThrow();
  });
});
