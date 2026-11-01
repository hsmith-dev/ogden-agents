import { useSyncExternalStore } from 'react';

/**
 * Whether the command palette is open, and on what (epic 26 story 3): one
 * per tab, so `g n` and the desktop app's New Chat outside a project open it
 * on "New chat in..." without holding a reference to it.
 */

/** `all`: every group. `new-chat-in`: the projects, each opening its new-chat draft. */
export type PaletteMode = 'all' | 'new-chat-in';

export interface PaletteState {
  open: boolean;
  mode: PaletteMode;
}

let state: PaletteState = { open: false, mode: 'all' };
// What had focus when the palette opened: Esc puts it back there.
let returnTarget: Element | null = null;
const listeners = new Set<() => void>();

function set(next: PaletteState): void {
  if (next.open === state.open && next.mode === state.mode) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Opens the palette on `mode` (or moves an open one to it). */
export function openCommandPalette(mode: PaletteMode = 'all'): void {
  if (!state.open) returnTarget = typeof document === 'undefined' ? null : document.activeElement;
  set({ open: true, mode });
}

/** Closes it; the next open starts on `all` unless told otherwise. */
export function closeCommandPalette(): void {
  set({ open: false, mode: 'all' });
}

/** Moves an open palette to `mode`. */
export function setCommandPaletteMode(mode: PaletteMode): void {
  if (state.open) set({ open: true, mode });
}

/** What had focus when the palette last opened, while it is still on the page. */
export function paletteReturnTarget(): HTMLElement | undefined {
  return returnTarget instanceof HTMLElement && returnTarget.isConnected && returnTarget !== document.body ? returnTarget : undefined;
}

export function paletteState(): PaletteState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(subscribe, paletteState, paletteState);
}
