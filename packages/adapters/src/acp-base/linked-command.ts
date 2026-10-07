/**
 * Resolving a user's own linked command line (a user's own CLI, already
 * installed and managed outside Ogden Agents, in place of its pinned,
 * verified copy) to an absolute, runnable path, never through a shell. Agent
 * neutral (`tests/architecture.test.ts`'s `findAcpBaseViolations`): this
 * module names no agent and is imported by an agent's own adapter, never the
 * other way round. Called directly by the server route before a command is
 * persisted (an immediate refusal) and again by an agent's `quirks.launch()`
 * at every chat start (defense in depth): a value is never cached as a
 * resolved path, so an edit or a removal outside Ogden Agents is always
 * re-checked.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { LinkedCommandSpec } from '@ogden-agents/shared';

/** What a resolved linked command gives a launch: an absolute program, its arguments, and (optionally) a folder and extra environment. */
export interface ResolvedLinkedCommand {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
}

/** The outcome of resolving a linked command: the ready-to-spawn result, or plain words naming the problem. */
export type LinkedCommandResolution = { ok: true; resolved: ResolvedLinkedCommand } | { ok: false; reason: string };

export interface ResolveLinkedCommandOptions {
  /** What `process.platform` would say. Default the real one. */
  platform?: NodeJS.Platform;
  /** Whether `file` is a runnable file. Default: a regular file with its executable bit set (not checked on Windows). */
  isExecutable?: (file: string) => boolean;
  /** Whether `dir` is a folder that exists. Default: a real stat check. */
  isDirectory?: (dir: string) => boolean;
}

/** A regular, executable file; `windows` skips the executable-bit check (Windows has none). */
function runnableFile(file: string, windows: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (!windows) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function realDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** `env`'s value for `key`, matching its name in any case on Windows (variable names there are case-insensitive). */
function lookupEnv(env: Readonly<Record<string, string | undefined>>, key: string, windows: boolean): string | undefined {
  if (!windows) return env[key];
  for (const [name, value] of Object.entries(env)) if (name.toUpperCase() === key && value !== undefined && value !== '') return value;
  return undefined;
}

/** The extensions a bare name may be found under on Windows (`PATHEXT`, else the usual four), tried after the bare name itself. */
function windowsExtensions(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const pathext = lookupEnv(env, 'PATHEXT', true);
  const list = (pathext ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext !== '');
  return ['', ...list];
}

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

/**
 * An already-absolute program resolved directly; a bare name (no path
 * separator) searched on `env`'s `PATH`, trying Windows extensions after the
 * bare name. `undefined` when nothing runnable is found. A relative path
 * with a separator never reaches here: the caller refuses it first, since
 * neither real caller has a base to resolve one against that means anything
 * to the user (the chat's own `cwd`, not the Ogden server's).
 */
function resolveProgram(
  program: string,
  env: Readonly<Record<string, string | undefined>>,
  ctx: { windows: boolean; paths: typeof posix | typeof win32; isExecutable: (file: string) => boolean },
): string | undefined {
  const { windows, paths, isExecutable } = ctx;
  if (paths.isAbsolute(program)) return isExecutable(program) ? program : undefined;
  const pathValue = lookupEnv(env, 'PATH', windows) ?? '';
  const dirs = pathValue.split(paths.delimiter).filter((dir) => dir !== '');
  const extensions = windows ? windowsExtensions(env) : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const file = paths.join(dir, `${program}${ext}`);
      if (isExecutable(file)) return file;
    }
  }
  return undefined;
}

/**
 * Resolves a linked command's raw spec to an absolute, runnable path and its
 * arguments, never through a shell: the command line is split (quote-aware),
 * its program resolved (as given, if absolute; a bare name on `env`'s
 * `PATH`), and its working directory, when given, checked to exist. Called
 * at save time (an immediate refusal) and at every chat start.
 *
 * A relative command or working directory (a path with a separator that
 * isn't absolute) is refused outright, in plain words, rather than resolved
 * against some base: neither real caller (the server's save-time check, an
 * agent's `launch()` at chat start) has anything meaningful to resolve one
 * against — not the Ogden server's own working directory, which the user
 * never chose and has no relation to (Quick review finding 2, 2026-10-07).
 */
export function resolveLinkedCommand(
  spec: LinkedCommandSpec,
  env: Readonly<Record<string, string | undefined>>,
  options: ResolveLinkedCommandOptions = {},
): LinkedCommandResolution {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';
  const paths = windows ? win32 : posix;
  const isExecutable = options.isExecutable ?? ((file: string) => runnableFile(file, windows));
  const isDirectory = options.isDirectory ?? realDirectory;

  const tokens = splitCommandLine(spec.command);
  const program = tokens[0];
  if (program === undefined || program === '') return { ok: false, reason: 'Type the command to run.' };
  const args = tokens.slice(1);

  const hasSeparator = program.includes('/') || (windows && program.includes('\\'));
  if (hasSeparator && !paths.isAbsolute(program)) {
    return { ok: false, reason: `Give an absolute path for "${program}", or just the program's name if it's on your PATH.` };
  }

  const command = resolveProgram(program, env, { windows, paths, isExecutable });
  if (command === undefined) return { ok: false, reason: `Ogden Agents couldn't find "${program}" to run. Check that it's installed and the command is right.` };

  let cwd: string | undefined;
  if (spec.cwd !== undefined) {
    if (!paths.isAbsolute(spec.cwd)) return { ok: false, reason: `Give an absolute path for the working directory "${spec.cwd}".` };
    if (!isDirectory(spec.cwd)) return { ok: false, reason: `Ogden Agents couldn't find the folder "${spec.cwd}".` };
    cwd = spec.cwd;
  }

  return {
    ok: true,
    resolved: { command, args, ...(cwd === undefined ? {} : { cwd }), ...(spec.env === undefined ? {} : { env: spec.env }) },
  };
}
