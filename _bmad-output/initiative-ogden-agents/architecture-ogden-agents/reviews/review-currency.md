# Review — currency (configured floor)
Verdict: 1 high, 1 medium.
- HIGH: Stack pairs node:sqlite with drizzle-orm, but drizzle-orm 0.45.3 exports no node:sqlite driver (better-sqlite3, bun-sqlite, durable-sqlite, expo-sqlite, op-sqlite, sqlite-proxy only; checked via npm view exports). Fix: Drizzle's sqlite-proxy driver over node:sqlite, or better-sqlite3 (native, conflicts with the no-native-install goal).
- MEDIUM: node:sqlite runs flag-free on Node 24.21 (tested), but its stability level was not confirmed as Stable. Record as assumption with a swap path (Drizzle driver change to better-sqlite3).
- OK: all other versions from npm view 2026-09-29; ACP SDK 1.5.1; Node LTS 24/26; @napi-rs/keyring as keytar replacement.
