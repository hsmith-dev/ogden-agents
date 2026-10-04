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
