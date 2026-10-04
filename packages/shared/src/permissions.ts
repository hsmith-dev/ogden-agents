/**
 * Where "Always allow" is never offered for a shell command (story 2.6,
 * user decision 2026-09-30, review F2): a first word that is an interpreter
 * or a wrapper can run anything, and so can a command that sets variables
 * first. Core refuses the scope with it; the card writes the reason.
 */

/** Interpreters and wrappers that run whatever follows them. */
export const WRAPPER_COMMANDS: ReadonlySet<string> = new Set([
  'sudo',
  'doas',
  'env',
  'xargs',
  'nohup',
  'time',
  'nice',
  'exec',
  'eval',
  'command',
  'builtin',
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'pwsh',
  'powershell',
  'cmd',
  'python',
  'node',
  'deno',
  'bun',
  'npx',
  'bunx',
  'pnpx',
  'ruby',
  'perl',
  'php',
  'lua',
  'osascript',
]);

/** A command's first word, as a program name: its last path segment, lowercased, without a Windows program extension. */
const programName = (word: string): string =>
  (word.split(/[\\/]/).at(-1) ?? word).toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, '');

/**
 * Why Always allow isn't offered for `command`, in plain words for the
 * card, or `undefined` when nothing rules it out.
 */
export function alwaysAllowRefusal(command: string): string | undefined {
  const first = command.trim().split(/[ \t]+/)[0];
  if (first === undefined || first === '') return undefined;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
    return "Always allow isn't offered for a command that sets variables first, because they can change what it runs.";
  }
  const name = programName(first);
  if (WRAPPER_COMMANDS.has(name) || /^python\d+(?:\.\d+)*$/.test(name)) {
    return `Always allow isn't offered for ${name}, because it can run anything.`;
  }
  return undefined;
}

/**
 * Why Always allow isn't offered on a card of a chat in Skip all (permission
 * modes): such a chat never writes rules, and no rule or caution level
 * answers its requests. Core refuses the scope with it; the card writes it.
 */
export const SKIP_ALL_REFUSAL = "Always allow isn't offered while this chat is in Skip all, so it never writes a rule.";
