/**
 * Fake editors for the editor launcher's test hook (`EDITOR_PATH_ENV` in
 * packages/server/src/test-hooks.ts, story 8.10): a fake `code` and `cursor`
 * in a folder the caller made inside the temp folder, each recording its
 * argv (one argument per line) in `<folder>/<name>.argv`. On Windows they
 * are `.cmd` files, as the real launchers are there.
 *
 * Plain Node only (no test runner import), so the browser suite
 * (`tests/e2e/workbench-files.spec.ts`) and the installed-package suite
 * (`tests/e2e-installed/workbench-journey.spec.ts`, under its extra folder)
 * both use it.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The fake editors' names: VS Code's and Cursor's launchers. */
export const FAKE_EDITOR_NAMES = ['code', 'cursor'] as const;
export type FakeEditorName = (typeof FAKE_EDITOR_NAMES)[number];

/** Writes the fake editors into `folder` (an existing folder inside the temp folder) and returns it. */
export function writeFakeEditors(folder: string): string {
  for (const name of FAKE_EDITOR_NAMES) {
    if (process.platform === 'win32') {
      writeFileSync(join(folder, `${name}.cmd`), `@echo off\r\n(for %%a in (%*) do @echo %%~a) > "%~dp0${name}.argv"\r\n`);
    } else {
      writeFileSync(join(folder, name), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${join(folder, `${name}.argv`)}"\n`);
      chmodSync(join(folder, name), 0o755);
    }
  }
  return folder;
}

/** What the fake editor `name` in `folder` last recorded (LF line ends), or `undefined` if it never ran. */
export function recordedEditorArgs(folder: string, name: FakeEditorName): string | undefined {
  const file = join(folder, `${name}.argv`);
  return existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : undefined;
}
