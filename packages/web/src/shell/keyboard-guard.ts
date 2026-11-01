/**
 * Where a page-wide keyboard shortcut must not act: inside an open dialog,
 * alert dialog, sheet (a dialog) or menu, where it would change the page
 * behind it (3.6 review F4; story 4.6 review).
 */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Whether `target` is inside an open overlay ({@link OVERLAY_SELECTOR}). */
export function isInsideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;
}

/**
 * Whether a key press (or a page event) comes from inside an open overlay:
 * its target or the focused element is in one. `except` names an overlay
 * that does not count (the palette's own, for the key that closes it). The
 * one check behind every page-wide shortcut.
 */
export function focusInsideOverlay(event: Pick<Event, 'target'>, except?: string): boolean {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return [event.target, active].some((target) => isInsideOverlay(target) && !(except !== undefined && target instanceof Element && target.closest(except) !== null));
}
