/**
 * The launcher token (AD-15, extended by story 1.7): a random secret the
 * server creates on every start in `<dataDir>/launcher.token`, readable only by
 * the user, and removes when it closes. The `npx ogden-agents` launcher reads
 * it and sends it in the {@link LAUNCHER_TOKEN_HEADER} header; the gate
 * accepts it only on the handshake prefix ({@link LAUNCHER_PREFIX}), never for
 * the app. It is readable only by the same OS user who runs the server, and
 * the handshake only issues launch links, which that user can already get by
 * running the launcher, so it grants nothing that user doesn't already have.
 *
 * The token is a secret: it is never logged (AD-16).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tightenMode } from './file-mode.js';

/** The token file in the data folder. */
export const LAUNCHER_TOKEN_FILE = 'launcher.token';
/** The request header that carries the token. */
export const LAUNCHER_TOKEN_HEADER = 'x-ogden-launcher-token';
/** The only paths the token unlocks: the launcher handshake. */
export const LAUNCHER_PREFIX = '/launcher/';
/** Randomness in the token (256 bits). */
export const LAUNCHER_TOKEN_BYTES = 32;

export interface LauncherToken {
  /** True only for exactly this token, compared in constant time. */
  verify(given: string | undefined): boolean;
  /** Removes the token file if it is still this server's. Safe to call twice. */
  remove(): void;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Creates a fresh token and writes it to `<dataDir>/launcher.token` (mode
 * 0600), replacing any old file in one step.
 */
export function createLauncherToken(dataDir: string): LauncherToken {
  const file = join(dataDir, LAUNCHER_TOKEN_FILE);
  const value = randomBytes(LAUNCHER_TOKEN_BYTES).toString('base64url');
  const digest = sha256(value);
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, value, { mode: 0o600, flag: 'wx' });
    tightenMode(temp);
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }

  return {
    verify(given) {
      if (given === undefined || given.length === 0) return false;
      // Hashing both sides gives equal lengths, so the comparison is constant time.
      return timingSafeEqual(sha256(given), digest);
    },
    remove() {
      let current: string;
      try {
        current = readFileSync(file, 'utf8');
      } catch {
        return;
      }
      // Another server may have replaced it since; only remove our own.
      if (current === value) rmSync(file, { force: true });
    },
  };
}

/** Reads the token a running server wrote, or `undefined` if there is none. */
export function readLauncherToken(dataDir: string): string | undefined {
  try {
    const value = readFileSync(join(dataDir, LAUNCHER_TOKEN_FILE), 'utf8').trim();
    return value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}
