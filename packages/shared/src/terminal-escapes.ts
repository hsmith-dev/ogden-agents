/**
 * Terminal escape sequences out of a program's output (moved here from
 * `adapters/setup-claude-code/sign-in-output.ts` for 8.9: the sign-in
 * reader and Problems' output share it). Pure.
 */

const ESC = '\u001b';
/** OSC (`ESC ]` … BEL or ST), including OSC 8 hyperlinks: the whole sequence, parameters and all. */
const OSC = new RegExp(`${ESC}\\][^\\u0007\\u001b]*(?:\\u0007|${ESC}\\\\)`, 'g');
/** CSI (`ESC [` … final byte), such as colors and cursor moves. */
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
/** Any other two-byte escape, then a lone ESC left by a split sequence. */
const OTHER_ESCAPE = new RegExp(`${ESC}[@-Z\\\\-_]|${ESC}`, 'g');
/** C0 controls other than tab, line feed and carriage return, and DEL. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** `text` without terminal escape sequences or control characters. */
export function stripTerminalEscapes(text: string): string {
  return text.replace(OSC, '').replace(CSI, '').replace(OTHER_ESCAPE, '').replace(CONTROL, '');
}
