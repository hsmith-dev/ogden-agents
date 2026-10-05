/**
 * The terminal's backlog trim (stories 3.5, 3.9; moved out of `terminal.ts`
 * by story 6.9 to keep it under 600 lines), re-exported from `terminal.ts`.
 */
import { TERMINAL_BACKLOG_CHARS } from './constants.js';

const ESC = '\x1b';
const BEL = '\x07';

/**
 * Where the escape sequence starting at `text[esc]` (an `ESC`) ends, one past
 * its last character, or `-1` when `text` ends before it does. A CSI
 * (`ESC [` … a final byte `@`–`~`); an OSC (`ESC ]`), or a DCS, SOS, PM or
 * APC string, up to BEL or ST (`ESC \\`); otherwise `ESC`, any intermediate
 * bytes (space–`/`), then one final character (`ESC 7`, `ESC ( B`).
 */
function escapeEnd(text: string, esc: number): number {
  const kind = text[esc + 1];
  if (kind === undefined) return -1;
  if (kind === '[') {
    for (let i = esc + 2; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return i + 1;
    }
    return -1;
  }
  if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
    for (let i = esc + 2; i < text.length; i++) {
      if (text[i] === BEL) return i + 1;
      if (text[i] === ESC) return text[i + 1] === '\\' ? i + 2 : text[i + 1] === undefined ? -1 : i;
    }
    return -1;
  }
  let i = esc + 1;
  while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) i++;
  return i < text.length ? i + 1 : -1;
}

/**
 * Keeps the newest `max` characters of output, starting at a line where it
 * can (story 3.5), and never inside an escape sequence (story 3.9; 3.5 review
 * F5): a cut that falls inside one moves past its end, then on to the next
 * line break. A sequence still unterminated at the end is cut at a line
 * break, as before.
 */
export function trimBacklog(text: string, max: number = TERMINAL_BACKLOG_CHARS): string {
  if (text.length <= max) return text;
  let start = text.length - max;
  const esc = text.lastIndexOf(ESC, start - 1);
  if (esc !== -1) {
    const end = escapeEnd(text, esc);
    if (end > start) start = end;
  }
  const line = text.indexOf('\n', start);
  return line === -1 ? text.slice(start) : text.slice(line + 1);
}
