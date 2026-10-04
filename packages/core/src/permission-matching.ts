/**
 * Permission scope and matching (user decisions, 2026-09-30; moved from
 * `permissions.ts` in story 10.8, which re-exports every export here): what
 * "Always allow" covers, whether a stored rule or the caution level answers
 * a request, and the protected paths no level or rule answers. Pure, apart
 * from resolving paths on the filesystem.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { alwaysAllowRefusal, type AlwaysAllowScope, type CautionLevel, type ToolKind, type Workspace } from '@ogden-agents/shared';
import type { ProtectedPaths } from './agent-port.js';
import { canonicalWorkspacePath, isCaseInsensitivePath } from './entities.js';

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
 * `path` as it would be reached: absolute (relative to `base` otherwise),
 * with the symlinks of its nearest existing parent resolved, case-folded
 * where that filesystem ignores case. `undefined` when it can't be told: a
 * `~` path, a masked one, control characters, or a read error.
 */
function reachedPath(base: string, path: string): string | undefined {
  if (path === '' || path.startsWith('~') || path.includes(MASKED) || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  let current = isAbsolute(path) ? resolve(path) : resolve(base, path);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      const reached = rest.length === 0 ? real : join(real, ...rest.reverse());
      return isCaseInsensitivePath(real) ? reached.toLowerCase() : reached;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined;
      const parent = dirname(current);
      if (parent === current) return undefined;
      rest.push(basename(current));
      current = parent;
    }
  }
}

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
 * What "Always allow" would cover for a request: for `execute`, its command
 * prefix; for another named kind, the kind; for `other`, an unknown kind,
 * an `execute` without a command, or a command led by an interpreter, a
 * wrapper or a variable assignment, nothing (`null`: Always allow is not offered).
 */
export function alwaysAllowScope(kind: ToolKind, command: string | undefined): AlwaysAllowScope | null {
  if (kind === 'execute') {
    if (command !== undefined && alwaysAllowRefusal(command) !== undefined) return null;
    const prefix = command === undefined ? undefined : commandPrefix(command);
    return prefix === undefined ? null : { kind: 'command_prefix', value: prefix, label: prefix };
  }
  if (kind === 'other') return null;
  return { kind: 'tool', value: kind, label: TOOL_SCOPE_LABELS[kind] };
}

/**
 * Whether a stored rule answers a request of `kind` with `command`. A
 * command prefix matches whole words only (`npm install` never matches
 * `npm installer`), and nothing matches a command with shell syntax, a
 * masked command, or one led by an interpreter or wrapper. A rule for a
 * file kind matches only when `pathsInside` (every path the call names is
 * inside the workspace; {@link pathsInsideWorkspace}).
 */
export function ruleMatches(
  rule: Pick<AlwaysAllowScope, 'kind' | 'value'>,
  kind: ToolKind,
  command: string | undefined,
  pathsInside = false,
): boolean {
  if (command !== undefined && (hasShellSyntax(command) || command.includes(MASKED) || alwaysAllowRefusal(command) !== undefined)) return false;
  if (rule.kind === 'tool') return kind !== 'execute' && kind !== 'other' && rule.value === kind && (!PATH_KINDS.has(kind) || pathsInside);
  if (rule.kind !== 'command_prefix' || kind !== 'execute' || command === undefined) return false;
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
 * more than the request says (a hook, a settings allow-list, an MCP server).
 * Folder or file names, at any depth, compared ignoring case everywhere
 * (stricter than the filesystem needs on a case-sensitive one).
 */
export const PROTECTED_PATHS: ProtectedPaths = {
  folders: ['.claude', '.git', '.vscode', '.idea'],
  // As agents write them; the lowercase spellings too, for a case-insensitive filesystem.
  files: ['.mcp.json', 'CLAUDE.md', 'claude.md', 'AGENTS.md', 'agents.md', '.envrc'],
};

/** {@link PROTECTED_PATHS} as one set of lowercase names: the one source of the 2.8 rule and of the Auto guards. */
const PROTECTED_NAMES: ReadonlySet<string> = new Set([...PROTECTED_PATHS.folders, ...PROTECTED_PATHS.files].map((name) => name.toLowerCase()));

/** Tool kinds that write: a protected path among their paths always asks. Reads and searches are not protected. */
export const WRITE_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['edit', 'delete', 'move']);

/** Whether one path segment is a protected name. */
export const isProtectedSegment = (segment: string): boolean => PROTECTED_NAMES.has(segment.toLowerCase());

/**
 * Whether any path the tool call names reaches a protected name inside the
 * workspace, symlinks resolved (a link to `.git/hooks` counts). Paths
 * outside the workspace or unresolvable are not checked here: they never
 * pass {@link pathsInsideWorkspace}, so they ask anyway.
 */
export function touchesProtectedPath(workspace: Pick<Workspace, 'path' | 'realPath'>, paths: readonly string[] | undefined): boolean {
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
    return reached.slice(prefix.length).split(/[\\/]/).some(isProtectedSegment);
  });
}

/** Whether a command names a protected path in any word (`cp x .git/hooks/pre-commit`): no rule answers it. */
export function commandNamesProtectedPath(command: string): boolean {
  return words(command).some((word) => word.replace(/["']/g, '').split(/[\\/]/).some(isProtectedSegment));
}
