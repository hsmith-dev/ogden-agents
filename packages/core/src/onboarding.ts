import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OnboardingState } from '@ogden-agents/shared';
import { ValidationError } from './errors.js';

/**
 * Whether the first-run Welcome is done (onboarding 9.5; CAP-16): the one
 * owner of the flag, kept in `<dataDir>/onboarding.json`, readable only by
 * the user and replaced in one step. Nothing is written into user repos.
 *
 * With no record (or one that can't be read), Welcome counts as done only
 * when the data folder already has projects: an existing user is never sent
 * through it (user decision, 2026-09-30); that answer is then kept.
 */

/** `<dataDir>/<this>`: `{ "welcomeCompleted": boolean }`. */
export const ONBOARDING_FILE = 'onboarding.json';

export interface OnboardingOptions {
  /** The Ogden Agents data folder. */
  dataDir: string;
  /** Whether any project exists (read only when there is no usable record). */
  hasProjects(): boolean;
  /** A record that exists but can't be read or parsed, or a record that couldn't be kept: its code only. */
  onError?(code: string): void;
}

export interface Onboarding {
  get(): OnboardingState;
  /** Validates and keeps `state`; throws `ValidationError` for a wrong shape (nothing is written). */
  set(state: unknown): OnboardingState;
}

export function createOnboarding(options: OnboardingOptions): Onboarding {
  const file = join(options.dataDir, ONBOARDING_FILE);

  const write = (state: OnboardingState) => {
    mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(temp, 0o600);
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  };

  /** Whether the record's corruption was reported: once per run while it stays corrupt (nothing rewrites it until Welcome ends). */
  let corruptReported = false;

  /** The kept record, or `undefined` when there is none or it can't be used. */
  const read = (): OnboardingState | undefined => {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      corruptReported = false;
      const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
      if (code !== 'ENOENT') options.onError?.(code);
      return undefined;
    }
    try {
      const parsed = OnboardingState.safeParse(JSON.parse(text));
      if (parsed.success) {
        corruptReported = false;
        return parsed.data;
      }
    } catch {
      // Not JSON: as if there were no record.
    }
    // Left as it is: the file is the user's to inspect.
    if (!corruptReported) options.onError?.('corrupt');
    corruptReported = true;
    return undefined;
  };

  return {
    get() {
      const kept = read();
      if (kept !== undefined) return kept;
      const state: OnboardingState = { welcomeCompleted: options.hasProjects() };
      if (state.welcomeCompleted) {
        // Kept, so removing every project later never sends an existing user through Welcome.
        try {
          write(state);
        } catch (error) {
          options.onError?.((error as NodeJS.ErrnoException).code ?? 'unwritable');
        }
      }
      return state;
    },
    set(input) {
      const parsed = OnboardingState.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError('The onboarding state is not valid.', parsed.error.issues);
      }
      // Welcome's first-project answer (10.2's contract) is kept once given: a later save without it, such as
      // Welcome's `{ welcomeCompleted: true }`, leaves it as it is, so Welcome never asks again.
      const keptChoice = read()?.firstProjectChoice;
      const state: OnboardingState = parsed.data.firstProjectChoice === undefined && keptChoice !== undefined ? { ...parsed.data, firstProjectChoice: keptChoice } : parsed.data;
      write(state);
      return state;
    },
  };
}
