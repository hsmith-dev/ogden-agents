/**
 * Whether a project's declared command can run without a shell (AD-38;
 * 8.9). Ogden splits it with `splitCommandLine` into a program and its
 * arguments and starts that program itself (`shell: false`), so a command
 * that only a shell could run is refused, in plain words, before it is
 * stored and again before it runs: an operator (`| & ; < > ( ) $` or a
 * backquote) or a glob (`* ? [`) outside quotes, `$` or a backquote inside
 * double quotes, a newline anywhere, a leading `~`, a `NAME=value` prefix,
 * an unclosed quote, a program with a path separator that isn't absolute,
 * a shell as the program, or a wrapper that would run another program
 * (`env`, `sudo`, `nohup`, `xargs`, `find -exec`, ...). Single quotes keep everything literal.
 *
 * {@link argvShellRefusal} is the runner's own check of the argv it is
 * handed (defense in depth): the argv never passed a shell, so only what a
 * shell would be needed for at the start is refused there.
 */
import { splitCommandLine, type ProjectCommandRefusal } from '@ogden-agents/shared';

/** Outside quotes, these need a shell. */
const OPERATORS = new Set(['|', '&', ';', '<', '>', '(', ')', '$', '`']);
/** Outside quotes, these are a shell's globs. */
const GLOBS = new Set(['*', '?', '[']);
/** Programs that are a shell (or start one): never run as a declared command. */
const SHELLS = new Set(['sh', 'bash', 'rbash', 'zsh', 'dash', 'ksh', 'mksh', 'oksh', 'loksh', 'pdksh', 'yash', 'posh', 'rc', 'es', 'fish', 'csh', 'tcsh', 'ash', 'busybox', 'cmd', 'powershell', 'pwsh', 'wsl', 'nu', 'xonsh', 'elvish']);
/** Programs that run another program they are handed (so a shell could hide behind them): never the program of a declared command. */
const WRAPPERS = new Set(['env', 'nohup', 'xargs', 'sudo', 'doas', 'su', 'runuser', 'pkexec', 'nice', 'ionice', 'renice', 'timeout', 'stdbuf', 'setsid', 'time', 'command', 'exec', 'eval', 'builtin', 'chroot', 'unbuffer', 'taskset', 'chrt', 'flock', 'watch', 'script', 'caffeinate', 'start', 'parallel']);
/** `find`'s options that run a program. */
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
/** `NAME=value`, as a shell reads a variable assignment before a command. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The shell-free argv of `line`, or why it needs a shell. */
export type ShellFreeCommand = { ok: true; argv: string[] } | { ok: false; refusal: ProjectCommandRefusal };

/** The program's base name, lower-cased, without a Windows extension. */
const baseName = (program: string): string => {
  const last = program.split(/[\\/]/).pop() ?? program;
  return last.toLowerCase().replace(/\.(exe|com|cmd|bat|ps1)$/, '');
};

/** Whether `program` is a path with a separator that isn't absolute (POSIX `/…`, or a Windows drive or UNC path). */
const relativeWithSeparator = (program: string): boolean => /[\\/]/.test(program) && !program.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(program) && !program.startsWith('\\\\');

/** The checks every argv passes: a program, not a shell, not a `NAME=value` prefix, not relative, and no newline or NUL anywhere. */
export function argvShellRefusal(argv: readonly string[]): ProjectCommandRefusal | undefined {
  const program = argv[0];
  if (program === undefined || program === '') return 'empty';
  if (argv.some((arg) => /[\r\n\0]/.test(arg))) return 'newline';
  if (ASSIGNMENT.test(program)) return 'assignment';
  if (relativeWithSeparator(program)) return 'relative';
  const name = baseName(program);
  if (SHELLS.has(name)) return 'shell';
  if (WRAPPERS.has(name) || (name === 'find' && argv.some((arg) => FIND_EXEC.has(arg)))) return 'wrapper';
  return undefined;
}

/** `line` as a shell-free argv, or the first reason it needs a shell. */
export function shellFreeCommand(line: string): ShellFreeCommand {
  if (/[\r\n\0]/.test(line)) return { ok: false, refusal: 'newline' };
  let quote: '"' | "'" | undefined;
  /** Whether the next character starts a token (so a `~` there is a home path). */
  let atTokenStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      atTokenStart = false;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) i++;
      else if (ch === '$' || ch === '`') return { ok: false, refusal: 'expansion' };
      atTokenStart = false;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      atTokenStart = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      atTokenStart = false;
      continue;
    }
    if (OPERATORS.has(ch)) return { ok: false, refusal: 'operator' };
    if (GLOBS.has(ch)) return { ok: false, refusal: 'glob' };
    if (ch === '~' && atTokenStart) return { ok: false, refusal: 'home' };
    atTokenStart = false;
  }
  if (quote !== undefined) return { ok: false, refusal: 'quote' };
  const argv = splitCommandLine(line);
  const refusal = argvShellRefusal(argv);
  return refusal === undefined ? { ok: true, argv } : { ok: false, refusal };
}
