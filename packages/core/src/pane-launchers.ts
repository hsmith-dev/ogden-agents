/**
 * The launchers a terminal pane can run (epic 16, story 16.5; E16-R1, R5, R9):
 * core's port, and the one pure helper it needs. The list, detection and the
 * lookup of each program are the adapters' (`pane-launchers`); core names no
 * program.
 *
 * Ogden never installs a program, never adds a flag that skips a permission
 * prompt, and passes no credential: a pane starts the program as the user
 * would, plus only the launcher's own plain arguments and what the user typed
 * in its visible argument field.
 */
import type { PaneDetection, PaneLauncher, PaneLauncherStatus } from '@ogden-agents/shared';
import type { TerminalCommand } from './terminal-port.js';

/** Why a launcher can't start a pane now. */
export type LauncherRefusal = { ok: false; code: 'unknown_launcher' | 'not_found' | 'failed' | 'bad_args'; reason: string };

export interface PaneLaunchers {
  /** Every launcher worth showing, with what detection found (looked up once, then kept). */
  list(): Promise<PaneLauncherStatus[]>;
  /** Looks again (the Detect button). */
  detect(): Promise<PaneLauncherStatus[]>;
  /** The launcher's data, even one that is hidden. */
  get(launcherId: string): PaneLauncher | undefined;
  /** What to run for `launcherId`: the program by its absolute path, its own arguments, then `args`. */
  command(launcherId: string, args: readonly string[]): Promise<({ ok: true } & TerminalCommand) | LauncherRefusal>;
}

/** What detection found, in one place for the adapters and tests. */
export type { PaneDetection };

/** The most arguments a launcher's field may hold. */
const MAX_LAUNCHER_ARGS = 32;

/**
 * Splits the text of a launcher's argument field into arguments, the way a
 * person reads it: spaces separate, single or double quotes keep spaces
 * together, and inside double quotes a backslash escapes only a quote or another backslash (a Windows path keeps its own). It
 * interprets nothing else: no variable, no glob, no `;` or `&&`: each token is
 * one argument given to the program directly, never to a shell. `undefined`
 * for an unclosed quote or too many arguments.
 */
export function splitLauncherArgs(text: string): string[] | undefined {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote === undefined) {
      if (ch === '"' || ch === "'") {
        quote = ch;
        started = true;
      } else if (/\s/.test(ch)) {
        if (started) {
          args.push(current);
          current = '';
          started = false;
        }
      } else {
        current += ch;
        started = true;
      }
    } else if (ch === quote) quote = undefined;
    else if (ch === '\\' && quote === '"' && (text[i + 1] === '"' || text[i + 1] === '\\')) current += text[++i]!;
    else current += ch;
  }
  if (quote !== undefined) return undefined;
  if (started) args.push(current);
  return args.length > MAX_LAUNCHER_ARGS ? undefined : args;
}
