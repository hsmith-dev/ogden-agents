import { useEffect, useRef } from 'react';

/** Whether `event` is the driver shortcut: `⌘.` on macOS, `Ctrl+.` elsewhere (either works everywhere). */
export function isDriverShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return event.key === '.' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

/**
 * `⌘.` / `Ctrl+.` toggles Chat and Terminal (EXPERIENCE.md Interaction
 * Primitives; story 3.6). Listened for on `window` in the capture phase, so it
 * runs before xterm's own key handler and the terminal never sees it: the
 * event stops there. A held key does not toggle again. Off (`enabled` false)
 * outside Developer mode.
 */
export function useDriverShortcut(enabled: boolean, onToggle: () => void, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): void {
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isDriverShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggle.current();
    };
    target.addEventListener('keydown', onKeyDown, { capture: true });
    return () => target.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled, target]);
}
