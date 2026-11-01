import { useSyncExternalStore } from 'react';

/**
 * The diff viewer's layout (story 8.3; EXPERIENCE.md Diff viewer): Inline or
 * Side by side, chosen in its toolbar and remembered in this browser's
 * `localStorage`, never sent to the server. Side by side needs `lg` or
 * wider; below that the viewer shows Inline with a line saying why.
 * Storage may throw or hold anything: every access is guarded, and a choice
 * made then still holds for this page.
 */
export type DiffLayout = 'inline' | 'split';

/** The storage key. */
export const DIFF_LAYOUT_KEY = 'ogden-agents.diff-layout.v1';
/**
 * The width Side by side needs, in CSS pixels: Tailwind's `lg` breakpoint.
 * A media query can't read a CSS variable and the theme emits no
 * `--breakpoint-lg`, so the number is repeated here, once.
 */
const LG_MIN_WIDTH = 1024;
export const SIDE_BY_SIDE_QUERY = `(min-width: ${LG_MIN_WIDTH}px)`;

/** The words of each layout in the toolbar switch. */
export const DIFF_LAYOUT_WORDS: Readonly<Record<DiffLayout, string>> = { inline: 'Inline', split: 'Side by side' };

const isLayout = (value: unknown): value is DiffLayout => value === 'inline' || value === 'split';

let pageChoice: DiffLayout | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The layout chosen in this browser; Inline when none was. */
export function diffLayout(): DiffLayout {
  if (pageChoice !== undefined) return pageChoice;
  try {
    const stored = storage()?.getItem(DIFF_LAYOUT_KEY) ?? null;
    return isLayout(stored) ? stored : 'inline';
  } catch {
    return 'inline';
  }
}

/** Keeps the choice (in this page even when storage can't) and tells every viewer. */
export function setDiffLayout(layout: DiffLayout): void {
  pageChoice = layout;
  try {
    storage()?.setItem(DIFF_LAYOUT_KEY, layout);
  } catch {
    // Quota or blocked storage: the choice lives in this page only.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab chose: storage now says what holds.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DIFF_LAYOUT_KEY && event.key !== null) return;
    pageChoice = undefined;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The stored layout choice; follows other viewers and tabs. */
export function useDiffLayout(): DiffLayout {
  return useSyncExternalStore(subscribe, diffLayout, () => 'inline');
}

function mediaQuery(): MediaQueryList | undefined {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(SIDE_BY_SIDE_QUERY) : undefined;
  } catch {
    return undefined;
  }
}

function subscribeWide(onChange: () => void): () => void {
  const query = mediaQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

const wideNow = () => mediaQuery()?.matches ?? true;

/** Whether the window is wide enough for Side by side (`lg`); follows resizes. */
export function useWideEnough(): boolean {
  return useSyncExternalStore(subscribeWide, wideNow, () => true);
}

/** Tests only: forgets what this page chose. */
export function resetDiffLayoutForTests(): void {
  pageChoice = undefined;
}
