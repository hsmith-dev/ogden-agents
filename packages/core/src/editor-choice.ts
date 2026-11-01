/**
 * The editor files open in (AD-39; 8.10): Settings, Projects, Editor's
 * choice, kept in `<dataDir>/editor.json` (`{ "editorId": "cursor" }`),
 * readable only by the user and replaced in one step (as `onboarding.ts`).
 * One record for the install, so every tab agrees. A record that can't be
 * read or parsed reads as no choice, and is reported by its code only.
 * Only an id is kept, never a path or a command: the launcher resolves the
 * program afresh at each open.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditorId } from '@ogden-agents/shared';

/** `<dataDir>/<this>`. */
export const EDITOR_CHOICE_FILE = 'editor.json';

export interface EditorChoice {
  /** The kept editor id, or `null` (none chosen, or the record unusable). */
  get(): EditorId | null;
  /** Keeps `editorId` (`null`: forgets the choice). Throws when it can't be written. */
  set(editorId: EditorId | null): void;
}

export interface EditorChoiceOptions {
  dataDir: string;
  /** A record that exists but can't be read or parsed: its code only. */
  onError?(code: string): void;
}

export function createEditorChoice({ dataDir, onError }: EditorChoiceOptions): EditorChoice {
  const file = join(dataDir, EDITOR_CHOICE_FILE);
  /** The code last reported, so the same one is not reported on every read. */
  let reported: string | undefined;
  const report = (code: string) => {
    if (reported === code) return;
    reported = code;
    onError?.(code);
  };
  return {
    get() {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
        if (code === 'ENOENT') reported = undefined;
        else report(code);
        return null;
      }
      try {
        const parsed = EditorId.nullable().safeParse((JSON.parse(text) as { editorId?: unknown } | null)?.editorId);
        if (parsed.success) {
          reported = undefined;
          return parsed.data;
        }
      } catch {
        // Not JSON: as if there were no choice.
      }
      report('corrupt');
      return null;
    },
    set(editorId) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      try {
        writeFileSync(temp, `${JSON.stringify({ editorId })}\n`, { mode: 0o600 });
        if (process.platform !== 'win32') chmodSync(temp, 0o600);
        renameSync(temp, file);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
      reported = undefined;
    },
  };
}
