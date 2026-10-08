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

/**
 * An OpenAI API key (Codex's, epic 12 entry 4): `sk-` and 16 or more more
 * characters (`sk-proj-...`, `sk-svcacct-...`), never an Anthropic key
 * (`sk-ant`, matched above); also one wrapped onto the next lines (raw or as an
 * escaped `\n`).
 */
export const OPENAI_KEY_PATTERNS: readonly RegExp[] = [/(?<![A-Za-z0-9])sk-(?!ant)[A-Za-z0-9_-]{16,}(?:(?:\r?\n|\\r|\\n)+[A-Za-z0-9_-]+)*/g];

/** An xAI API key (`xai-` and 20 or more characters), also wrapped onto the next lines. */
export const XAI_KEY_PATTERNS: readonly RegExp[] = [/(?<![A-Za-z0-9])xai-[A-Za-z0-9_-]{20,}(?:(?:\r?\n|\\r|\\n)+[A-Za-z0-9_-]+)*/g];

/** Every key pattern above. */
export const API_KEY_PATTERNS: readonly RegExp[] = [...ANTHROPIC_KEY_PATTERNS, ...GOOGLE_API_KEY_PATTERNS, ...OPENAI_KEY_PATTERNS, ...XAI_KEY_PATTERNS];

/** `text` with every API key in it (Anthropic's, Google's, OpenAI's and xAI's) replaced by {@link REDACTED_SECRET}. */
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
 * A PEM-style private key block (PKCS1/PKCS8, or OpenSSH's own
 * `OPENSSH PRIVATE KEY` format, which this pattern's `[A-Z ]*` wildcard also
 * matches): CAP-24's generated SSH keys are this shape. One with no `END`
 * line takes the whole key-looking lines after it. Bounded, so it stays
 * linear. Shared by the handoff brief, the log's backstop (`server/src/log.ts`,
 * epic 18 story 18.2) and anywhere else a key could otherwise leak.
 */
export const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]{0,10000}?-----END [A-Z ]*PRIVATE KEY-----|(?:\r?\n[A-Za-z0-9+/=]{1,100}(?=\r?\n|$)){0,200})/g;

/**
 * Other secret-looking text a person may paste into a chat (handoff, user
 * decision 2026-10-04): what Ogden masks, beside the API keys above, before a
 * chat's conversation goes to another agent. Each pattern replaces the whole
 * match, except the last, which keeps `NAME=` and masks the value.
 */
export const TOKEN_PATTERNS: readonly RegExp[] = [
  PRIVATE_KEY_BLOCK_PATTERN,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/g,
];

/** A password in a URL (`scheme://user:password@host`): the password is masked. */
const URL_PASSWORD = /(:\/\/[^\s/:@]{1,200}:)[^\s/@]{1,200}@/g;

/** A command-line password (`--password value`): the value is masked. */
const FLAG_PASSWORD = /(--(?:password|passwd|token|secret|api-key)[= ])[^\s"']{1,200}/gi;

/**
 * A `NAME=value` or `NAME: value` whose name says it is a secret: the value
 * (quoted with spaces, or a bare run) is masked. Every repeat is bounded and
 * the name excludes `.` and `-`, so it runs in linear time on any input.
 */
const NAMED_SECRET =
  /\b([A-Za-z0-9_]{0,40}(?:PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Za-z0-9_]{0,40}["']?[ \t]{0,10}[=:][ \t]{0,10})("[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"',;]{4,200})/gi;

/** `text` with every API key ({@link redactApiKeys}), credential, token and named secret value replaced by {@link REDACTED_SECRET}. */
export function redactSecrets(text: string): string {
  const keys = redactApiKeys(text);
  const credentials = CREDENTIAL_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), keys);
  const tokens = TOKEN_PATTERNS.reduce((out, pattern) => out.replace(pattern, REDACTED_SECRET), credentials);
  const urls = tokens.replace(URL_PASSWORD, `$1${REDACTED_SECRET}@`).replace(FLAG_PASSWORD, `$1${REDACTED_SECRET}`);
  return urls.replace(NAMED_SECRET, (_match, name: string) => `${name}${REDACTED_SECRET}`);
}
