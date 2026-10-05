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
