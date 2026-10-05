// SPIKE 16.1 (TEMPORARY): per-pane status from output recency and prompt patterns (E16-R6). In memory only:
// nothing here stores terminal text; the screen mirror is the pane's own and is never written anywhere.
import { headless, now, stripAnsi } from './harness.mjs';

/**
 * Prompt patterns as data (one list per launcher in the real design). `depth` is how many of the screen's last
 * non-empty lines the pattern may sit in: a one-line question is only a question while it is the last line (the
 * cursor sits on it); a menu spans several lines.
 */
export const PATTERNS = [
  { name: 'yes-no', re: /\((y\/n|Y\/n|y\/N)\)|\[(y\/n|Y\/n|y\/N)\]/, depth: 1 },
  { name: 'press-enter', re: /press (enter|return) to continue/i, depth: 1 },
  { name: 'menu-yes', re: /[❯>]\s*1\.\s*yes/i, depth: 4 },
  { name: 'proceed', re: /do you want to (proceed|continue|allow|make this edit)/i, depth: 5 },
];

export class StatusTracker {
  constructor({ cols = 100, rows = 30, patterns = PATTERNS, quietMs = 400, workingMs = 1200, mode = 'screen' } = {}) {
    this.patterns = patterns;
    this.quietMs = quietMs;
    this.workingMs = workingMs;
    this.mode = mode; // 'screen' (headless mirror), 'tail' (stripped recent bytes) or 'recency' (no patterns)
    this.mirror = mode === 'screen' ? headless(cols, rows, 200) : undefined;
    this.tail = '';
    this.lastOutputAt = now();
    this.exited = false;
    this.cpuMs = 0;
  }

  feed(data) {
    const t0 = now();
    this.lastOutputAt = t0;
    if (this.mirror) this.mirror.term.write(data);
    else this.tail = (this.tail + stripAnsi(data)).slice(-2000);
    this.cpuMs += now() - t0;
  }

  /** The user typed or pasted: whatever the pane was waiting for may be answered. */
  input() {
    if (this.mode === 'tail') this.tail = '';
  }

  exit() {
    this.exited = true;
  }

  /** The last non-empty lines of what the pane shows now. */
  lastLines(count) {
    let lines;
    if (this.mode === 'screen') {
      const buf = this.mirror.term.buffer.active;
      lines = [];
      for (let i = buf.baseY + this.mirror.term.rows - 1; i >= 0 && lines.length < count; i -= 1) {
        const text = buf.getLine(i)?.translateToString(true) ?? '';
        if (text.trim() !== '') lines.unshift(text);
      }
    } else {
      lines = this.tail.split(/\r?\n|\r/).filter((l) => l.trim() !== '').slice(-count);
    }
    return lines;
  }

  state(at = now()) {
    if (this.exited) return 'exited';
    const quiet = at - this.lastOutputAt;
    if (this.mode !== 'recency' && quiet >= this.quietMs) {
      for (const pattern of this.patterns) {
        if (this.lastLines(pattern.depth).some((line) => pattern.re.test(line))) return 'attention';
      }
    }
    return quiet < this.workingMs ? 'working' : 'idle';
  }
}

/** Reads a ground-truth file written by the fake (`{t,state}` lines) into [{t,state}]. */
export function parseTruth(text) {
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((e) => ({ t: e.t, state: e.state === 'attention' ? 'attention' : e.state }));
}
