/**
 * Permission scope and matching (user decisions, 2026-09-30; moved from
 * `permissions.ts` in story 10.8, which re-exports every export here): what
 * "Always allow" covers, whether a stored rule or the caution level answers
 * a request, and the protected paths no level or rule answers. Pure, apart
 * from resolving paths on the filesystem.
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, parse, resolve, sep } from 'node:path';
import { alwaysAllowRefusal, programName, type AlwaysAllowScope, type CautionLevel, type ToolKind, type Workspace } from '@ogden-agents/shared';
import type { ProtectedPaths } from './agent-port.js';
import { prefixRefusedFor, scriptNameIndex } from './command-prefix-allowlists.js';
import { canonicalWorkspacePath, isCaseInsensitivePath } from './entities.js';
import { isDrivePath, isRemotePathShape, resolveLocalSegments } from './path-shape.js';

/**
 * Shell control syntax: `;`, `&`, `|`, a backtick, `$(`, `${`, `>`, `<`, a
 * line break, any other control character, or whitespace other than a space
 * or a tab (NBSP, U+2028, `\v`, `\f`, zero-width spaces, ...), which could
 * hide a word boundary the rule does not see. A command holding any of it
 * never matches a rule, so a rule for `npm install` can't let
 * `npm install x && rm -rf ~` through.
 */
const SHELL_SYNTAX =
  /[;&|`<>\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]|\$\(|\$\{/;

export const hasShellSyntax = (command: string): boolean => SHELL_SYNTAX.test(command);

/**
 * What the adapters write in place of a secret. A masked command is not the
 * command that runs, so it never matches a rule.
 */
const MASKED = '[redacted]';

/** Words split on spaces and tabs only; any other whitespace is refused by {@link SHELL_SYNTAX}. */
const words = (command: string): string[] => command.trim().split(/[ \t]+/).filter((word) => word !== '');

/** A flag (`-x`, `--x`) or a path (`./a`, `~/a`, `a/b`, `a\b`): never a subcommand. */
const isFlagOrPath = (word: string) => word.startsWith('-') || word.startsWith('.') || word.startsWith('~') || /[\\/]/.test(word);

/**
 * The command prefix an "Always allow" of `command` covers: its first two
 * words when the second is not a flag or a path, else its first word
 * (`npm install stripe` -> `npm install`, `ls -la` -> `ls`).
 */
export function commandPrefix(command: string): string | undefined {
  const [first, second] = words(command);
  if (first === undefined) return undefined;
  return second === undefined || isFlagOrPath(second) ? first : `${first} ${second}`;
}

/** Plain words for a tool-kind scope, as the card writes it under Always allow ("Editing files in clay-and-kiln"). */
const TOOL_SCOPE_LABELS: Record<Exclude<ToolKind, 'execute' | 'other'>, string> = {
  read: 'Reading files',
  edit: 'Editing files',
  delete: 'Deleting files',
  move: 'Moving files',
  search: 'Searching files',
  think: 'Thinking',
  fetch: 'Fetching from the web',
  switch_mode: 'Switching modes',
};

/**
 * Tool kinds that act on paths: their always-allow rules match only when
 * every path the tool call names lies inside the workspace (user decision
 * 2026-09-30, review F1). Other named kinds (`fetch`, …) stay per kind.
 */
export const PATH_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['read', 'edit', 'delete', 'move', 'search']);

/**
 * `path` as it would be reached: absolute (relative to `base`, a real path,
 * otherwise), resolved one segment at a time, so each symlink is followed
 * before the `..` after it (`hk/../hooks` with `hk` a link to `.git/hooks` is
 * `.git/hooks`, as the kernel reads it; independent review 2026-10-31), and
 * case-folded where that filesystem ignores case. Segments past the first
 * that doesn't exist are joined as written. `undefined` when it can't be
 * told: a `~` path, a masked one, control characters, or a read error.
 */
function reachedPath(base: string, path: string): string | undefined {
  if (path === '' || path.startsWith('~') || path.includes(MASKED) || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  // Another computer, a device or a URL is told by its spelling, before any file-system call (on Windows a stat of one is a network lookup).
  if (isRemotePathShape(path)) return undefined;
  const absolute = isAbsolute(path);
  const start = absolute ? parse(resolve(path)).root : base;
  let reached: ReturnType<typeof resolveLocalSegments>;
  try {
    reached = resolveLocalSegments(start, (absolute ? path.slice(parse(path).root.length) : path).split(/[\\/]+/));
  } catch {
    return undefined;
  }
  // The last existing folder decides the case rule; `reached.real` is canonical up to it.
  return isCaseInsensitivePath(reached.existing) ? reached.real.toLowerCase() : reached.real;
}

/**
 * Whether one path part names another machine or a URL (independent review
 * 2026-10-31; Windows CI 2026-11-01), by its spelling alone: `host:path`,
 * `user@host:path` (scp, rsync, git remotes), `scheme://...`, or a
 * {@link isRemotePathShape} path (`\\host\share`, `//host/share`, `\\?\`,
 * `\\.\`). Such a part is never inside the project. On Windows a single
 * letter and a separator (`C:/x`) is a drive, a local path checked as any.
 */
export const isRemotePart = (part: string, platform: NodeJS.Platform = process.platform): boolean =>
  isRemotePathShape(part) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(part) || (/^[^/\\:]+:/.test(part) && !(platform === 'win32' && isDrivePath(part)));

/**
 * Whether the tool call names at least one path and every one of them lies
 * inside the workspace's canonical real path (AD-2). No path, or any path
 * outside or unresolvable, is `false`.
 */
export function pathsInsideWorkspace(workspace: Pick<Workspace, 'path' | 'realPath'>, paths: readonly string[] | undefined): boolean {
  if (paths === undefined || paths.length === 0) return false;
  let root: string;
  let base: string;
  try {
    base = realpathSync.native(workspace.realPath ?? workspace.path);
    root = canonicalWorkspacePath(base);
  } catch {
    return false;
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  return paths.every((path) => {
    const reached = reachedPath(base, path);
    return reached !== undefined && (reached === root || reached.startsWith(prefix));
  });
}

/**
 * Why no Always allow rule, exact or by prefix, can cover `command`, from its
 * text alone (AD-40, epic 26 story 8, security review), in plain words for
 * the card; `undefined` when the text is rulable. A command is rulable only
 * when it is printable ASCII (plus tabs), holds none of
 * `; & | \ < > $ ( ) { } [ ] * ? %` or a backtick, no word starting with `=`
 * (zsh's `=cmd` expansion), no masked secret, and is not led by an
 * interpreter, a wrapper, a two-word wrapper or a variable assignment
 * ({@link alwaysAllowRefusal}). Paths are checked apart, on the filesystem
 * ({@link commandPathsReach}).
 */
export function commandRuleRefusal(command: string): string | undefined {
  if (command.includes(MASKED)) return COMMAND_REFUSALS.masked;
  if (/[;&|\n\r]/.test(command)) return COMMAND_REFUSALS.chained;
  if (/[<>]/.test(command)) return COMMAND_REFUSALS.redirected;
  if (/[`$(){}[\]*?%]/.test(command) || words(command).some((word) => word.replace(/["']/g, '').startsWith('='))) return COMMAND_REFUSALS.expanded;
  if (command.includes('\\') || !/^[\x20-\x7e\t]*$/.test(command)) return COMMAND_REFUSALS.unchecked;
  if (words(command).length === 0) return COMMAND_REFUSALS.unchecked;
  // A quoted first word (`"bash" -c x`, `b'a'sh`) is not the program name a rule or the wrapper check sees.
  if (/["']/.test(words(command)[0]!)) return COMMAND_REFUSALS.unchecked;
  return alwaysAllowRefusal(command);
}

/** The reasons a command can't be ruled (AD-40), as the card writes them. No em or en dashes. */
export const COMMAND_REFUSALS = {
  masked: "Always allow isn't offered for this command, because it holds a hidden secret.",
  chained: "Always allow isn't offered for this command, because it runs more than one thing.",
  redirected: "Always allow isn't offered for this command, because it redirects input or output.",
  expanded: "Always allow isn't offered for this command, because the shell would expand part of it first.",
  unchecked: "Always allow isn't offered for this command, because it has characters Ogden Agents can't check.",
  outside: "Always allow isn't offered for this command, because it names a path outside this project.",
  protected: "Always allow isn't offered for this command, because it names a file that controls how the agent or git runs.",
} as const;

/**
 * The strings in one command word that could be a path (AD-40): the word
 * with its quotes removed, each part after an `=`, `:`, `,` or `@`
 * (`--out=../x`, `-d@../x`, `-Wl,-rpath,/x`), and in a flag word each part
 * from a `/`, `.` or `~` (`-I../x`, `-I/etc`). Empty parts are no path.
 */
function commandPathParts(word: string): string[] {
  const bare = word.replace(/["']/g, '');
  const parts = [bare];
  const flag = bare.startsWith('-');
  for (let index = 0; index < bare.length; index += 1) {
    const char = bare[index]!;
    if ('=:,@'.includes(char)) parts.push(bare.slice(index + 1));
    if (flag && '/.~'.includes(char)) parts.push(bare.slice(index));
  }
  return parts.filter((part) => part !== '');
}

/**
 * Where a command's words reach (AD-40): `inside` when every path-like part
 * of every word ({@link commandPathParts}) resolves inside the workspace,
 * symlinks followed, and none touches a protected segment; `protected` when
 * any touches one (a link to `.git` counts); else `outside` (a `~` path, a
 * parent, an absolute path elsewhere, a link out, or an unreadable root).
 */
export function commandPathsReach(
  workspace: Pick<Workspace, 'path' | 'realPath'>,
  command: string,
  extraFolders: readonly string[] = [],
): 'inside' | 'outside' | 'protected' {
  let root: string;
  let base: string;
  try {
    base = realpathSync.native(workspace.realPath ?? workspace.path);
    root = canonicalWorkspacePath(base);
  } catch {
    return 'outside';
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  let outside = false;
  let touchesProtected = commandNamesProtectedPath(command, extraFolders);
  const given = words(command);
  const script = scriptNameIndex(
    given.map((word) => word.replace(/["']/g, '')),
    programName(given[0]?.replace(/["']/g, '') ?? ''),
  );
  for (const [index, word] of given.entries()) {
    for (const part of commandPathParts(word)) {
      if (index !== script && isRemotePart(part)) {
        outside = true;
        continue;
      }
      const reached = reachedPath(base, part);
      if (reached === undefined || (reached !== root && !reached.startsWith(prefix))) {
        outside = true;
        continue;
      }
      if (reached !== root && reached.slice(prefix.length).split(/[\\/]/).some((segment) => isProtectedSegment(segment, extraFolders))) touchesProtected = true;
    }
  }
  return touchesProtected ? 'protected' : outside ? 'outside' : 'inside';
}

/**
 * Why a prefix rule must not cover `command` even though an exact rule may
 * (AD-40 security review, and the independent review of 2026-10-31): a
 * program no prefix covers (`ssh`, `docker`, `rsync`, `sed`), one whose
 * words leave its allowlist (git, tar, npm, pnpm, yarn, go: see
 * `command-prefix-allowlists.ts`), or an option that runs another command
 * (`find -exec`). `undefined` when a prefix may cover it.
 */
export function prefixRuleRefusal(command: string): string | undefined {
  const raw = words(command);
  const given = raw.map((word) => word.replace(/["']/g, ''));
  const name = programName(given[0] ?? '');
  const refusal = `Commands starting with ${name} aren't offered, because its options can run another command.`;
  return prefixRefusedFor(name, given.slice(1), raw.slice(1)) ? refusal : undefined;
}

/**
 * What "Always allow" would cover for a request, its first (default) scope:
 * for `execute`, the exact command (`command_exact`, AD-40); for another
 * named kind, the kind; for `other`, an unknown kind, an `execute` without a
 * command, or a command whose text can't be ruled ({@link commandRuleRefusal}),
 * nothing (`null`: Always allow is not offered). Core also refuses a command
 * whose paths can't be ruled ({@link commandPathsReach}).
 */
export function alwaysAllowScope(kind: ToolKind, command: string | undefined): AlwaysAllowScope | null {
  if (kind === 'execute') {
    if (command === undefined || commandRuleRefusal(command) !== undefined) return null;
    const exact = command.trim();
    return { kind: 'command_exact', value: exact, label: exact };
  }
  if (kind === 'other') return null;
  return { kind: 'tool', value: kind, label: TOOL_SCOPE_LABELS[kind] };
}

/**
 * The second scope a command offers (AD-40): every command starting with
 * Ogden's prefix of it ({@link commandPrefix}), never client text. `null`
 * when the command can't be ruled or a prefix must not cover it
 * ({@link prefixRuleRefusal}).
 */
export function alwaysAllowPrefixScope(command: string): AlwaysAllowScope | null {
  if (commandRuleRefusal(command) !== undefined || prefixRuleRefusal(command) !== undefined) return null;
  // A quote in the first two words (`npm "test"`, `ls "-la"`) would put it in the prefix: no prefix at all,
  // never the wider one-word one.
  if (words(command).slice(0, 2).some((word) => /["']/.test(word))) return null;
  const prefix = commandPrefix(command);
  return prefix === undefined ? null : { kind: 'command_prefix', value: prefix, label: prefix };
}

/**
 * Whether a stored rule answers a request of `kind` with `command`.
 * `pathsInside` is, for a file kind, whether every path the call names is
 * inside the workspace ({@link pathsInsideWorkspace}), and for `execute`,
 * whether the command's paths are rulable (`inside` from {@link commandPathsReach}); it
 * defaults to `false`, so a caller that forgets it never allows.
 *
 * A command rule matches only a rulable command ({@link commandRuleRefusal})
 * and only token-equal words: an exact rule the same command (spaces at the
 * ends aside), a prefix rule a command whose first words are the prefix's
 * (`npm test` never `npm testx`, `npm-test` or `npm "test"`) and that no
 * prefix may cover ({@link prefixRuleRefusal}). Nothing matches a masked
 * command, or one with shell syntax.
 */
export function ruleMatches(
  rule: Pick<AlwaysAllowScope, 'kind' | 'value'>,
  kind: ToolKind,
  command: string | undefined,
  pathsInside = false,
): boolean {
  if (command !== undefined && (hasShellSyntax(command) || commandRuleRefusal(command) !== undefined)) return false;
  if (rule.kind === 'tool') return kind !== 'execute' && kind !== 'other' && rule.value === kind && (!PATH_KINDS.has(kind) || pathsInside);
  if (kind !== 'execute' || command === undefined || pathsInside !== true) return false;
  if (rule.kind === 'command_exact') return rule.value.trim() !== '' && command.trim() === rule.value.trim();
  if (rule.kind !== 'command_prefix' || prefixRuleRefusal(command) !== undefined) return false;
  const prefix = words(rule.value);
  const given = words(command);
  return prefix.length > 0 && prefix.length <= given.length && prefix.every((word, index) => given[index] === word);
}

/**
 * The caution ladder (user decision 2026-09-30, strictest first), a pure
 * table: whether `level` answers a request of `kind` without a card.
 * `pathsInside` is whether the request's paths all lie inside the workspace;
 * for `read`, `search` and `edit` it must also name at least one
 * ({@link pathsInsideWorkspace}), for `think` it must name none or only
 * inside ones.
 *
 * - `ask_every_time`: nothing.
 * - `ask_for_commands`: `read` and `search` inside the project, and `think`.
 * - `ask_risky_only`: those, and `edit` inside the project.
 *
 * `execute`, `delete`, `move`, `fetch`, `switch_mode`, `other`, an unknown
 * kind or level, and any path outside the project always ask (a 2.6 rule may
 * still answer them).
 */
export function cautionAllows(level: CautionLevel, kind: ToolKind, pathsInside: boolean): boolean {
  // The legacy no-prompts alias is accepted only by settings, where it
  // becomes the confirmed Skip all default. It never authorizes a request.
  if (level === 'dangerously_skip_permissions') return false;
  if (pathsInside !== true) return false;
  switch (level) {
    case 'ask_for_commands':
      return kind === 'read' || kind === 'search' || kind === 'think';
    case 'ask_risky_only':
      return kind === 'read' || kind === 'search' || kind === 'think' || kind === 'edit';
    default:
      return false;
  }
}

/**
 * Protected paths (user decision 2026-09-30, 2.8 F1): files and folders that
 * control how the agent or git runs, so writing one could give the agent
 * more than the request says (a hook, a settings allow-list, an MCP server),
 * and since story 4.13 (user decision 2026-10-04) `_bmad/`, whose scripts the
 * Board runs.
 * Folder or file names, at any depth, compared ignoring case everywhere
 * (stricter than the filesystem needs on a case-sensitive one).
 */
export const PROTECTED_PATHS: ProtectedPaths = {
  // `_bmad`: BMad Method's own scripts and settings, which the Board runs (story 4.13, user decision 2026-10-04).
  // `.gemini` and `.agents`: Antigravity's config and skill folders (epic 6 entry 5).
  folders: ['.claude', '.git', '.vscode', '.idea', '_bmad', '.gemini', '.agents'],
  // As agents write them; the lowercase spellings too, for a case-insensitive filesystem.
  files: ['.mcp.json', 'CLAUDE.md', 'claude.md', 'AGENTS.md', 'agents.md', '.envrc'],
};

/** {@link PROTECTED_PATHS} as one set of lowercase names: the one source of the 2.8 rule and of the Auto guards. */
const PROTECTED_NAMES: ReadonlySet<string> = new Set([...PROTECTED_PATHS.folders, ...PROTECTED_PATHS.files].map((name) => name.toLowerCase()));

/** Tool kinds that write: a protected path among their paths always asks. Reads and searches are not protected. */
export const WRITE_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['edit', 'delete', 'move']);

/**
 * {@link PROTECTED_PATHS} plus the agents' own config folders (their
 * descriptors' `configFolders`, epic 12, 12.3): what core passes to an agent
 * that guards paths in Auto, and what every protected-path check uses.
 */
export function protectedPathsWith(extraFolders: readonly string[] = []): ProtectedPaths {
  if (extraFolders.length === 0) return PROTECTED_PATHS;
  const known = new Set(PROTECTED_PATHS.folders.map((name) => name.toLowerCase()));
  const added = extraFolders.filter((name, index) => !known.has(name.toLowerCase()) && extraFolders.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index);
  return { folders: [...PROTECTED_PATHS.folders, ...added], files: PROTECTED_PATHS.files };
}

/** Whether one path segment is a protected name (or one of `extraFolders`, the agents' own config folders). */
export const isProtectedSegment = (segment: string, extraFolders: readonly string[] = []): boolean => {
  const name = segment.toLowerCase();
  return PROTECTED_NAMES.has(name) || extraFolders.some((folder) => folder.toLowerCase() === name);
};

/**
 * Whether any path the tool call names reaches a protected name inside the
 * workspace, symlinks resolved (a link to `.git/hooks` counts). Paths
 * outside the workspace or unresolvable are not checked here: they never
 * pass {@link pathsInsideWorkspace}, so they ask anyway.
 */
export function touchesProtectedPath(workspace: Pick<Workspace, 'path' | 'realPath'>, paths: readonly string[] | undefined, extraFolders: readonly string[] = []): boolean {
  if (paths === undefined || paths.length === 0) return false;
  let root: string;
  let base: string;
  try {
    base = realpathSync.native(workspace.realPath ?? workspace.path);
    root = canonicalWorkspacePath(base);
  } catch {
    return false;
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  return paths.some((path) => {
    const reached = reachedPath(base, path);
    if (reached === undefined || !reached.startsWith(prefix)) return false;
    return reached.slice(prefix.length).split(/[\\/]/).some((segment) => isProtectedSegment(segment, extraFolders));
  });
}

/** Whether a command names a protected path in any word (`cp x .git/hooks/pre-commit`): no rule answers it. */
export function commandNamesProtectedPath(command: string, extraFolders: readonly string[] = []): boolean {
  return words(command).some((word) => word.replace(/["']/g, '').split(/[\\/]/).some((segment) => isProtectedSegment(segment, extraFolders)));
}
