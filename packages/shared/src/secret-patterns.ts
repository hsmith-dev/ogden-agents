/**
 * Agents' API keys wherever they appear in text (AD-16): the log's backstop
 * (`server/src/log.ts`, story 9.2) and the terminal turns imported into a
 * chat (story 3.3 review F4) redact them with these same patterns. The key
 * formats are the providers', not an agent's (AD-1).
 */

/** What a redacted key becomes. */
export const REDACTED_SECRET = '[redacted]';

/**
 * An Anthropic key, with any continuation on the following lines (a key
 * wrapped or split across lines, raw or as an escaped `\n`), a key cut short
 * at the end of a line (just `sk-ant`), and one cut earlier (`sk-an`, `sk-a`,
 * `sk-`) with what follows on the next lines or at a line's end.
 */
export const ANTHROPIC_KEY_PATTERNS: readonly RegExp[] = [
  /sk-ant[A-Za-z0-9_-]*(?:(?:\r?\n|\\r|\\n)+[A-Za-z0-9_-]+)*/g,
  /\bsk-(?:an?)?(?:(?:\r?\n|\\r|\\n)+[A-Za-z0-9_-]+)+/g,
  /\bsk-(?:an?)?$/gm,
];

/**
 * A Google API key (a Gemini API key, epic 6 entry 5): `AIza` and 35 more
 * characters; also one cut short at a line's end, or wrapped onto the next
 * lines (raw or as an escaped `\n`).
 */
export const GOOGLE_API_KEY_PATTERNS: readonly RegExp[] = [/\bAIza[0-9A-Za-z_-]*(?:(?:\r?\n|\\r|\\n)+[0-9A-Za-z_-]+)*/g];

/** Every key pattern above. */
export const API_KEY_PATTERNS: readonly RegExp[] = [...ANTHROPIC_KEY_PATTERNS, ...GOOGLE_API_KEY_PATTERNS];

/** `text` with every API key in it (Anthropic's and Google's) replaced by {@link REDACTED_SECRET}. */
export function redactApiKeys(text: string): string {
  return API_KEY_PATTERNS.reduce((out, pattern) => out.replace(pattern, REDACTED_SECRET), text);
}

/**
 * Ogden's own credentials and bearer tokens wherever they appear in text, each
 * with what replaces it (keeping the prefix): a bearer token, the tab's auth
 * subprotocol, a launch code, a token fragment. The log's backstop
 * (`server/src/log.ts`) and the handoff brief share them.
 */
export const CREDENTIAL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(Bearer\s+)[^\s"',]+/gi, `$1${REDACTED_SECRET}`],
  [/(ogden\.auth\.)[^\s"',]+/g, `$1${REDACTED_SECRET}`],
  [/([?&]code=)[^\s"'&#]+/g, `$1${REDACTED_SECRET}`],
  [/(#[ct]=)[^\s"'&]+/g, `$1${REDACTED_SECRET}`],
];

/**
 * Other secret-looking text a person may paste into a chat (handoff, user
 * decision 2026-10-04): what Ogden masks, beside the API keys above, before a
 * chat's conversation goes to another agent. Each pattern replaces the whole
 * match, except the last, which keeps `NAME=` and masks the value.
 */
export const TOKEN_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
];

/** A `NAME=value` or `NAME: value` whose name says it is a secret: the value is masked. */
const NAMED_SECRET = /\b([A-Za-z0-9_.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY)[A-Za-z0-9_.-]*["']?\s*[=:]\s*)(["']?)[^\s"',;]{6,}\2/gi;

/** `text` with every API key ({@link redactApiKeys}), credential, token and named secret value replaced by {@link REDACTED_SECRET}. */
export function redactSecrets(text: string): string {
  const keys = redactApiKeys(text);
  const credentials = CREDENTIAL_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), keys);
  const tokens = TOKEN_PATTERNS.reduce((out, pattern) => out.replace(pattern, REDACTED_SECRET), credentials);
  return tokens.replace(NAMED_SECRET, (_match, name: string) => `${name}${REDACTED_SECRET}`);
}
