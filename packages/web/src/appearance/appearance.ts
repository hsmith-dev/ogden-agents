import { APPEARANCE_STORAGE_KEY as APPEARANCE_KEY } from '@ogden-agents/shared';

/**
 * Appearance preferences: theme, density, Developer mode and the terminal's
 * screen-reader mode (story 3.6). The UI's only
 * browser persistence (all product state comes from the server). The inline
 * script in index.html applies the same key before first paint.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

export interface Appearance {
  theme: ThemePreference;
  density: Density;
  developerMode: boolean;
  /** xterm's screen-reader mode in the terminal panel (story 3.6; user decision: a switch, off by default). */
  terminalScreenReader: boolean;
}

export { APPEARANCE_STORAGE_KEY as APPEARANCE_KEY } from '@ogden-agents/shared';

export const DEFAULT_APPEARANCE: Appearance = { theme: 'system', density: 'comfortable', developerMode: false, terminalScreenReader: false };

/** Reads a saved value, keeping only fields that are valid; anything else falls back to the default. */
export function parseAppearance(raw: string | null): Appearance {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed !== null && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt value: use the defaults.
  }
  return {
    theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
    density: saved.density === 'compact' ? 'compact' : 'comfortable',
    developerMode: saved.developerMode === true,
    terminalScreenReader: saved.terminalScreenReader === true,
  };
}

export function loadAppearance(storage: Pick<Storage, 'getItem'> = window.localStorage): Appearance {
  try {
    return parseAppearance(storage.getItem(APPEARANCE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(appearance: Appearance, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage unavailable (private mode, quota): the choice lasts for this page only.
  }
}

/** Token swaps only: `data-theme` for a Light or Dark override, `data-density` for Compact. */
export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  if (appearance.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', appearance.theme);
  if (appearance.density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
  if (appearance.developerMode) root.setAttribute('data-developer', 'true');
  else root.removeAttribute('data-developer');
}
