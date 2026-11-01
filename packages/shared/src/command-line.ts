/**
 * Splitting a command line into a program and its arguments without a shell
 * (moved here from `acp-base/linked-command.ts` for 8.9: an agent's linked
 * command and a project's declared Problems command, AD-38, split the same
 * way). Pure: no file system, no process.
 */

/**
 * Splits a command line into a program and its arguments, quote-aware (`'`
 * and `"`; `\"` and `\\` inside double quotes), never through a shell. A
 * backslash outside quotes is literal, so an unquoted Windows path keeps its
 * separators; a path with a space needs quoting, as in a shell.
 */
export function splitCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      if (quote === '"' && ch === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
        current += line[++i];
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}
