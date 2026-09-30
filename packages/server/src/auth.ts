/**
 * Authentication for the security gate (AD-15 as amended in story 2.1):
 * single-use launch codes, and the per-tab tokens they are exchanged for.
 * Built only on `node:crypto`; nothing here is written to disk.
 *
 * Secrets never reach logs or events (AD-16): callers log that a code was
 * "issued", "used" or "rejected", or that a token was "minted", never a value.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_AUTH_KEY_FILE } from '@ogden-agents/core';
import { TAB_TOKEN_PATTERN, WS_AUTH_PROTOCOL_PREFIX, WS_PROTOCOL } from '@ogden-agents/shared';

/** Randomness in each launch code (256 bits; AD-15 asks for at least 128). */
export const LAUNCH_CODE_BYTES = 32;
/** A launch code is redeemable for this long after it is issued. */
export const LAUNCH_CODE_TTL_MS = 60_000;
/** Randomness in each tab token (256 bits). */
export const TAB_TOKEN_BYTES = 32;
/** A tab token that has not been used for this long is forgotten. */
export const TAB_TOKEN_IDLE_TTL_MS = 12 * 60 * 60 * 1000;

/** Milliseconds since the epoch; injected so tests can move time. */
export type Clock = () => number;

/**
 * Deletes the session-cookie signing key that story 1.4 kept in the data
 * folder. Nothing reads it any more, and a secret nobody uses shouldn't stay
 * on disk. Browsers that still hold the old cookie are simply ignored.
 */
export function retireLegacyAuthKey(dataDir: string): void {
  rmSync(join(dataDir, LEGACY_AUTH_KEY_FILE), { force: true });
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');
const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Index of the entry whose digest equals `digest`, checking every entry in constant time; -1 if none. */
function findDigest(entries: ReadonlyArray<{ digest: Buffer }>, digest: Buffer): number {
  let found = -1;
  for (let i = 0; i < entries.length; i++) {
    if (timingSafeEqual(entries[i]!.digest, digest)) found = i;
  }
  return found;
}

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
      const found = findDigest(live, sha256(code));
      if (found === -1) return false;
      live.splice(found, 1);
      return true;
    },
  };
}

export interface TabTokens {
  /** Mints a new random token for one tab. Only the launch-code exchange calls this. */
  mint(): string;
  /** True for a live token, which counts as a use: its idle clock restarts. */
  verify(token: string | undefined): boolean;
  /**
   * Keeps a live token from expiring while something (an open WebSocket) uses
   * it; call the returned function when that ends. Returns undefined for a
   * token that isn't live.
   */
  hold(token: string | undefined): (() => void) | undefined;
  /** How many tokens are live. */
  size(): number;
}

/**
 * The in-memory tab token store (AD-15 as amended). A token lives until the
 * server stops (Quit, restart) or it goes {@link TAB_TOKEN_IDLE_TTL_MS}
 * without being used; a token held by an open WebSocket doesn't expire.
 * Tokens are kept only as SHA-256 digests and compared in constant time.
 */
export function createTabTokens(now: Clock = Date.now, idleTtlMs: number = TAB_TOKEN_IDLE_TTL_MS): TabTokens {
  const live: Array<{ digest: Buffer; lastUsed: number; holds: number }> = [];

  const prune = () => {
    const t = now();
    for (let i = live.length - 1; i >= 0; i--) {
      const entry = live[i]!;
      if (entry.holds === 0 && entry.lastUsed + idleTtlMs <= t) live.splice(i, 1);
    }
  };

  const find = (token: string | undefined) => {
    prune();
    if (token === undefined || !TAB_TOKEN_PATTERN.test(token)) return undefined;
    const found = findDigest(live, sha256(token));
    return found === -1 ? undefined : live[found];
  };

  return {
    mint() {
      prune();
      const token = base64url(randomBytes(TAB_TOKEN_BYTES));
      live.push({ digest: sha256(token), lastUsed: now(), holds: 0 });
      return token;
    },
    verify(token) {
      const entry = find(token);
      if (entry === undefined) return false;
      entry.lastUsed = now();
      return true;
    },
    hold(token) {
      const entry = find(token);
      if (entry === undefined) return undefined;
      entry.holds++;
      entry.lastUsed = now();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.holds--;
        entry.lastUsed = now();
      };
    },
    size() {
      prune();
      return live.length;
    },
  };
}

/** The token in an `Authorization: Bearer <token>` header, or undefined. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer +(\S+)$/i.exec(header?.trim() ?? '');
  return match?.[1];
}

/**
 * The tab token in a WebSocket upgrade's `Sec-WebSocket-Protocol` offer, or
 * undefined unless the offer names {@link WS_PROTOCOL} and exactly one
 * `ogden.auth.<token>`.
 */
export function webSocketToken(header: string | undefined): string | undefined {
  const offered = (header ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (!offered.includes(WS_PROTOCOL)) return undefined;
  const auth = offered.filter((part) => part.startsWith(WS_AUTH_PROTOCOL_PREFIX));
  if (auth.length !== 1) return undefined;
  const token = auth[0]!.slice(WS_AUTH_PROTOCOL_PREFIX.length);
  return token === '' ? undefined : token;
}

/**
 * The `ws` server's subprotocol choice: only ever {@link WS_PROTOCOL}, never
 * the offer that carries the token, so the token isn't echoed back.
 */
export function chooseWebSocketProtocol(offered: Set<string>): string | false {
  return offered.has(WS_PROTOCOL) ? WS_PROTOCOL : false;
}
