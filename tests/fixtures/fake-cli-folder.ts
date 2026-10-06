/**
 * A folder of fake agent CLIs for the pane tests (epic 16, story 16.5): each
 * named program is a tiny launcher script for `fake-pane-shell.mjs`, which
 * answers `--version` and behaves as a CLI in a pane. A POSIX script with a
 * shebang and the execute bit, a `.cmd` shim on Windows (as npm installs
 * them). No real CLI is ever found or run.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE = join(import.meta.dirname, 'fake-pane-shell.mjs');

/** Makes a temp folder (inside the OS temp folder) holding `names` as fake programs; returns the folder. */
export function makeFakeCliFolder(names: readonly string[], prefix = 'ogden-agents-fakecli-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const name of names) addFakeCli(dir, name);
  return dir;
}

export function addFakeCli(dir: string, name: string, { failing = false } = {}): string {
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const file = join(dir, `${name}.cmd`);
    writeFileSync(file, failing ? '@exit /b 3\r\n' : `@"${process.execPath}" "${FAKE}" %*\r\n`);
    return file;
  }
  const file = join(dir, name);
  writeFileSync(file, failing ? '#!/bin/sh\nexit 3\n' : `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}
