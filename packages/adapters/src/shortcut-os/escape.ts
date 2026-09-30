/**
 * Quoting a path for each file format the app shortcut writes (story 2.4):
 * the macOS launcher script (sh), its `Info.plist` (XML) and the Linux
 * `.desktop` file's `Exec` key. Each takes any path a user folder can have:
 * spaces, `'`, `"`, `$`, `%`, backslashes.
 */

/** One sh word: single-quoted, with each `'` closed, escaped and reopened. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Text for an XML element (`<string>` in a plist). */
export function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/**
 * One argument of a `.desktop` `Exec` value (Desktop Entry Specification,
 * "The Exec key"): double-quoted, with `"`, `` ` ``, `$` and `\` escaped by a
 * backslash; then the string-value escape doubles every backslash, and `%`
 * becomes `%%` so it is not read as a field code (a tab is written `\t`).
 * A line break cannot be written in a key's value, so a path with one is
 * refused.
 */
export function desktopExecArg(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('The path has a line break in it.');
  const quoted = `"${value.replace(/["`$\\]/g, (char) => `\\${char}`)}"`;
  return quoted.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('%', '%%');
}
