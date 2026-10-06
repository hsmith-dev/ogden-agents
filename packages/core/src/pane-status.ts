/**
 * A pane's status, a guess (epic 16, story 16.6; E16-R6; spike 16.1 finding
 * 13): `working` while it prints, `needs_attention` when it has been quiet and
 * the last lines of its screen match one of its launcher's prompt patterns
 * (the CLI's own words for waiting on the user), `idle` after a longer quiet,
 * `exited` once the program ended.
 *
 * - Silence alone never says needs attention: only a pattern does, so a program
 *   thinking silently reads idle after 1.2 seconds, not "needs you".
 * - A pane with no patterns (the plain shell, or a CLI whose wording is not
 *   known) is only ever working or idle.
 * - Typing answers the prompt: the pane is working again until it prints.
 * - Nothing here keeps what the screen shows: lines are read, matched and
 *   dropped, never stored, logged or sent (AD-6, AD-16).
 *
 * Patterns are data (`PanePromptPattern`); a pattern that does not compile is
 * skipped, never thrown.
 */
import type { PanePromptPattern, PaneStatus } from '@ogden-agents/shared';

/** How long a pane must be quiet before its screen is read for a prompt. */
export const QUIET_MS = 400;
/** How long a pane must be quiet before it reads idle. */
export const IDLE_MS = 1_200;
/** The longest screen line matched (a longer one is cut: a pattern is never run on a flood). */
const MAX_LINE_CHARS = 300;

export interface StatusTrackerOptions {
  patterns: readonly PanePromptPattern[];
  /** The last `count` non empty lines of the screen now. */
  screenLines: (count: number) => Promise<string[]>;
  /** Told each change, with the new status and the one before. */
  onChange: (status: PaneStatus, previous: PaneStatus) => void;
  quietMs?: number;
  idleMs?: number;
}

export interface StatusTracker {
  readonly status: PaneStatus;
  /** The program printed something. */
  output(): void;
  /** The user typed or pasted. */
  input(): void;
  /** The program ended. */
  exited(): void;
  /** Stops the timers (the pane closed or restarted). */
  dispose(): void;
}

interface Compiled {
  re: RegExp;
  depth: number;
}

export function compilePatterns(patterns: readonly PanePromptPattern[]): Compiled[] {
  const compiled: Compiled[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push({ re: new RegExp(pattern.pattern, 'i'), depth: pattern.depth });
    } catch {
      // A pattern that does not compile is skipped.
    }
  }
  return compiled;
}

/** Whether any pattern matches within its own depth of the last lines. `lines` is oldest first. */
export function matchesPrompt(compiled: readonly Compiled[], lines: readonly string[]): boolean {
  return compiled.some(({ re, depth }) => lines.slice(-depth).some((line) => re.test(line.slice(0, MAX_LINE_CHARS))));
}

export function createStatusTracker({ patterns, screenLines, onChange, quietMs = QUIET_MS, idleMs = IDLE_MS }: StatusTrackerOptions): StatusTracker {
  const compiled = compilePatterns(patterns);
  const deepest = Math.max(1, ...compiled.map((one) => one.depth));
  let status: PaneStatus = 'working';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastActivity = Date.now();
  let ended = false;
  /** Bumped by each new activity: a screen read that was started before it is not acted on. */
  let generation = 0;

  const set = (next: PaneStatus) => {
    if (next === status) return;
    const previous = status;
    status = next;
    onChange(next, previous);
  };
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (afterMs: number, fn: () => void) => {
    clear();
    timer = setTimeout(fn, Math.max(0, afterMs));
    timer.unref?.();
  };

  const evaluate = () => {
    if (ended) return;
    const mine = generation;
    const toIdle = () => schedule(idleMs - (Date.now() - lastActivity), () => !ended && mine === generation && set('idle'));
    if (compiled.length === 0) {
      toIdle();
      return;
    }
    screenLines(deepest).then(
      (lines) => {
        if (ended || mine !== generation) return;
        if (matchesPrompt(compiled, lines)) set('needs_attention');
        else toIdle();
      },
      () => {
        // A screen that can't be read is not a prompt.
        if (!ended && mine === generation) toIdle();
      },
    );
  };

  const active = () => {
    generation += 1;
    lastActivity = Date.now();
    schedule(quietMs, evaluate);
  };

  return {
    get status() {
      return status;
    },
    output() {
      if (ended) return;
      set('working');
      active();
    },
    input() {
      if (ended) return;
      // Whatever it waited for may be answered: working until it prints (or is quiet again).
      if (status === 'needs_attention') set('working');
      active();
    },
    exited() {
      if (ended) return;
      ended = true;
      generation += 1;
      clear();
      set('exited');
    },
    dispose() {
      ended = true;
      generation += 1;
      clear();
    },
  };
}
