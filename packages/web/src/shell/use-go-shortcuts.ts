import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { focusInsideOverlay } from './keyboard-guard';

/**
 * The project's go-to shortcuts (EXPERIENCE.md Keyboard; story 4.6): `g`,
 * then a tab's key within {@link GO_SHORTCUT_WINDOW_MS}, opens that tab
 * (`g c` Chats, `g p` Plan, `g b` Board, `g r` Runs). Only the tabs the
 * header shows have a shortcut, so a tab that isn't there (Plan with
 * Planning off) does nothing.
 */

/** How long after `g` the tab's key still counts. */
export const GO_SHORTCUT_WINDOW_MS = 1500;

/** A shortcut target: the tab's key and route (with `$wsId`). */
export interface GoShortcutTab {
  key: string;
  to: string;
}

/** Whether `target` takes typed text: an input, textarea, select or editable element (the composer, xterm's textarea). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
}

/** Whether a key press may take part in a shortcut: no modifier, not a repeat, not handled already, not typed into a field, not inside a dialog or menu. */
export function isShortcutKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'defaultPrevented' | 'isComposing' | 'target'>): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.repeat || event.defaultPrevented || event.isComposing) return false;
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return !isTypingTarget(event.target) && !isTypingTarget(active) && !focusInsideOverlay(event);
}

/** One `g` sequence: its second key and what it does. */
export interface GoKeyBinding {
  key: string;
  run: () => void;
}

/**
 * Listens on `window` (bubble phase, so the composer's and the terminal's own
 * handlers, and anything that prevented the default, go first) and runs the
 * binding of `bindings` for `g` then its key. Each caller keeps its own
 * pending `g`, so two listeners (a project's tabs, `g y`) never block each other.
 */
export function useGoKeys(bindings: readonly GoKeyBinding[]) {
  const latest = useRef(bindings);
  latest.current = bindings;

  useEffect(() => {
    let pendingUntil = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) {
        pendingUntil = 0;
        return;
      }
      const key = event.key.toLowerCase();
      const now = Date.now();
      if (pendingUntil > now) {
        const binding = latest.current.find((each) => each.key === key);
        if (binding === undefined) {
          pendingUntil = key === 'g' ? now + GO_SHORTCUT_WINDOW_MS : 0;
          return;
        }
        pendingUntil = 0;
        event.preventDefault();
        binding.run();
        return;
      }
      pendingUntil = key === 'g' ? now + GO_SHORTCUT_WINDOW_MS : 0;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Opens a tab of `tabs` for `g` then its key. */
export function useGoShortcuts(wsId: string, tabs: readonly GoShortcutTab[]) {
  const navigate = useNavigate();
  useGoKeys(tabs.map((tab) => ({ key: tab.key, run: () => void navigate({ to: tab.to as '/w/$wsId', params: { wsId } }) })));
}
