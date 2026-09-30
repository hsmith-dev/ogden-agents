import { chmodSync } from 'node:fs';

/**
 * Makes an existing file readable only by the user (POSIX; a no-op on
 * Windows). Kept apart from `auth.ts` so the launcher bundle, which needs it
 * for nothing but the token file's mode, doesn't pull in the server's imports.
 */
export function tightenMode(file: string): void {
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}
