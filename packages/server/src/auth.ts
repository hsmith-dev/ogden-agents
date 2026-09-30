/**
 * Authentication for the security gate (AD-15): the signing key, single-use
 * launch codes and signed session cookies. Built only on `node:crypto`.
 *
 * Secrets never reach logs or events (AD-16): callers log that a code was
 * "issued", "used" or "rejected", never its value.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_KEY_FILE } from '@ogden-agents/core';

/** Length of the HMAC-SHA256 key in `auth.key`. */
export const AUTH_KEY_BYTES = 32;
/** Randomness in each launch code (256 bits; AD-15 asks for at least 128). */
export const LAUNCH_CODE_BYTES = 32;
/** A launch code is redeemable for this long after it is issued. */
export const LAUNCH_CODE_TTL_MS = 60_000;
/** How long a session cookie stays valid. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Randomness in each session ID. */
export const SESSION_ID_BYTES = 16;
/**
 * The session cookie's name for the server on `port`. Browsers send loopback
 * cookies to every port on the host, so the name carries the port: two installs
 * on different ports never overwrite each other's session. Known limit: any other
 * web server the user opens on 127.0.0.1 still receives this cookie; API and
 * WebSocket auth moves to a per-tab token before epic 2 (AD-15 amendment).
 */
export const sessionCookieName = (port: number): string => `ogden_session_${port}`;

/** Milliseconds since the epoch; injected so tests can move time. */
export type Clock = () => number;

/**
 * Reads `<dataDir>/auth.key`, or creates it with fresh random bytes (mode 0600)
 * if it is missing or not {@link AUTH_KEY_BYTES} long. Keeping the key on disk
 * lets session cookies survive a server restart.
 *
 * The key is written to a temp file first and then linked (or, replacing a
 * corrupt key, renamed) into place, so `auth.key` never exists half-written:
 * two servers starting together always end up with the same key.
 */
export function loadOrCreateAuthKey(dataDir: string): Buffer {
  const file = join(dataDir, AUTH_KEY_FILE);
  const existing = readIfExists(file);
  if (existing?.length === AUTH_KEY_BYTES) {
    tightenMode(file);
    return existing;
  }

  const key = randomBytes(AUTH_KEY_BYTES);
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, key, { mode: 0o600, flag: 'wx' });
  tightenMode(temp);
  try {
    if (existing !== undefined) {
      // A truncated or corrupt key: replace it in one step (this logs every browser out).
      renameSync(temp, file);
      return key;
    }
    try {
      // Fails with EEXIST if another process created the key in the meantime.
      linkSync(temp, file);
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    // Theirs was linked complete, so use it as it is; never overwrite it.
    const theirs = readFileSync(file);
    if (theirs.length !== AUTH_KEY_BYTES) {
      throw new Error(`${file} was just created by another process but is not ${AUTH_KEY_BYTES} bytes`);
    }
    return theirs;
  } finally {
    rmSync(temp, { force: true });
  }
}

function readIfExists(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Makes an existing file readable only by the user (POSIX; a no-op on Windows). */
export function tightenMode(file: string): void {
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');
const sha256 = (value: string) => createHash('sha256').update(value).digest();

export interface LaunchCodes {
  /** Issues a new single-use code, valid for {@link LAUNCH_CODE_TTL_MS}. */
  issue(): string;
  /** Spends `code`: true once for a code issued less than the TTL ago, false otherwise. */
  redeem(code: string): boolean;
}

/**
 * The in-memory launch code store. Codes are kept only as SHA-256 digests and
 * compared in constant time against every live one, so neither the store nor
 * the comparison reveals a code.
 */
export function createLaunchCodes(now: Clock = Date.now, ttlMs: number = LAUNCH_CODE_TTL_MS): LaunchCodes {
  const live: Array<{ digest: Buffer; expiresAt: number }> = [];

  const prune = () => {
    const t = now();
    for (let i = live.length - 1; i >= 0; i--) if (live[i]!.expiresAt <= t) live.splice(i, 1);
  };

  return {
    issue() {
      prune();
      const code = base64url(randomBytes(LAUNCH_CODE_BYTES));
      live.push({ digest: sha256(code), expiresAt: now() + ttlMs });
      return code;
    },
    redeem(code) {
      prune();
      const digest = sha256(code);
      let found = -1;
      for (let i = 0; i < live.length; i++) {
        if (timingSafeEqual(live[i]!.digest, digest)) found = i;
      }
      if (found === -1) return false;
      live.splice(found, 1);
      return true;
    },
  };
}

export interface Sessions {
  /** A new signed cookie value: `<id>.<expiry seconds>.<HMAC-SHA256>`. */
  create(): { value: string; maxAgeSeconds: number };
  /** True only for an untampered, unexpired value signed with this key. */
  verify(value: string | undefined): boolean;
}

/**
 * Stateless sessions: the cookie carries a random ID and an expiry, signed
 * with the key. Nothing is stored, so sessions can't be revoked one by one;
 * replacing `auth.key` revokes them all.
 */
export function createSessions(key: Buffer, now: Clock = Date.now, ttlMs: number = SESSION_TTL_MS): Sessions {
  const sign = (payload: string) => createHmac('sha256', key).update(payload).digest();

  return {
    create() {
      const id = base64url(randomBytes(SESSION_ID_BYTES));
      const expires = Math.floor((now() + ttlMs) / 1000);
      const payload = `${id}.${expires}`;
      return { value: `${payload}.${base64url(sign(payload))}`, maxAgeSeconds: Math.floor(ttlMs / 1000) };
    },
    verify(value) {
      if (value === undefined) return false;
      const match = /^([A-Za-z0-9_-]+)\.(\d{1,15})\.([A-Za-z0-9_-]+)$/.exec(value);
      if (match === null) return false;
      const [, id, expires, signature] = match as unknown as [string, string, string, string];
      const expected = sign(`${id}.${expires}`);
      const given = Buffer.from(signature, 'base64url');
      // Re-encoding rejects non-canonical base64url that would decode to the same bytes.
      if (given.length !== expected.length || base64url(given) !== signature) return false;
      if (!timingSafeEqual(given, expected)) return false;
      return Number(expires) * 1000 > now();
    },
  };
}
