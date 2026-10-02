/**
 * The catalog's skills (story 4.1): every skill installed in a repo, read
 * from its `SKILL.md` frontmatter under `<repo>/.agents/skills/*\/` and
 * `<repo>/.claude/skills/*\/` (AD-12: discovered, never hard-coded).
 *
 * Read-only and inside the repo: it lists those two folders and reads only
 * each `SKILL.md`'s first {@link MAX_SKILL_FILE_BYTES}, and only when the
 * file's real path stays inside the repo's real path, so a skill folder (or
 * a `skills` folder) linked to somewhere else is never read. A folder or
 * frontmatter name that isn't a skill name (`SKILL_NAME_PATTERN`) is left
 * out, and so is a skill whose frontmatter `name` differs from its folder's.
 * A missing folder, or any file-system error, leaves that skill or folder
 * out; nothing here throws for the repo's state. The repo root must be a
 * real folder (not a link, as `detect`), and a `SKILL.md` that isn't a
 * regular file (a FIFO, say) is never opened.
 */
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { InstalledSkill } from '@ogden-agents/core';
import { SKILL_NAME_PATTERN } from '@ogden-agents/shared';

/** Where skills are installed in a repo, relative to its root, in the order they are read. */
export const SKILL_FOLDERS: readonly (readonly string[])[] = [
  ['.agents', 'skills'],
  ['.claude', 'skills'],
];

/** How much of a `SKILL.md` is read: its frontmatter is at the top. */
export const MAX_SKILL_FILE_BYTES = 64 * 1024;

/** Whether `inner` is `outer` or inside it (both real paths). */
export function inside(inner: string, outer: string): boolean {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** At most this many entries of a skills folder are read, in name order (both the skill and the module record scans). */
export const MAX_SKILL_FOLDER_ENTRIES = 1000;

/** Never follow a link swapped in after the `realpath` (not on Windows, which has no such flag). */
const NO_FOLLOW = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
/** Opening a FIFO never waits for a writer (not on Windows, which has no such flag). */
const NON_BLOCK = (fsConstants as { O_NONBLOCK?: number }).O_NONBLOCK ?? 0;

/** The first {@link MAX_SKILL_FILE_BYTES} of `file` as text, or `undefined` on any error. */
export async function readHead(file: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Non-blocking, so a FIFO (or a device) swapped in can't block the open; never through a link swapped in.
    handle = await open(file, fsConstants.O_RDONLY | NON_BLOCK | NO_FOLLOW);
    // Only a regular file is read: checked on the opened file itself, not the path.
    if (!(await handle.stat()).isFile()) return undefined;
    const buffer = Buffer.alloc(MAX_SKILL_FILE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_SKILL_FILE_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * The first {@link MAX_SKILL_FILE_BYTES} of the regular file `parts` below
 * `repoReal` (the repo's real path), only when its real path stays inside
 * the repo (a link anywhere on the way that leads out is never read);
 * `undefined` otherwise or on any error.
 */
export async function readInsideRepo(repoReal: string, parts: readonly string[]): Promise<string | undefined> {
  let file: string;
  try {
    file = await realpath(join(repoReal, ...parts));
  } catch {
    return undefined;
  }
  return inside(file, repoReal) ? readHead(file) : undefined;
}

/**
 * The repo's real path when `repoPath` is an absolute path to a real folder
 * (as `detect`: a root swapped for a link is never followed into);
 * `undefined` otherwise or on any error.
 */
export async function realRepoRoot(repoPath: string): Promise<string | undefined> {
  if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return undefined;
  try {
    if (!(await lstat(repoPath)).isDirectory()) return undefined;
    return await realpath(repoPath);
  } catch {
    return undefined;
  }
}

/** A YAML scalar's value without its quotes. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return trimmed;
}

/**
 * The `name` and `description` of a `SKILL.md`'s frontmatter (the block
 * between a leading `---` line and the next one). Plain and quoted scalars,
 * and a folded or literal block (`>` or `|`) whose lines are joined with
 * spaces. `undefined` without frontmatter.
 */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string } | undefined {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return undefined;
  const body = lines.slice(1, end);
  const fields: Record<string, string> = {};
  for (let index = 0; index < body.length; index++) {
    const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(body[index]!);
    if (match === null) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (index + 1 < body.length && (/^\s+\S/.test(body[index + 1]!) || body[index + 1]!.trim() === '')) {
        index++;
        if (body[index]!.trim() !== '') block.push(body[index]!.trim());
      }
      value = block.join(' ');
    } else {
      value = unquote(value);
    }
    fields[key] = value;
  }
  return {
    ...(fields.name === undefined ? {} : { name: fields.name }),
    ...(fields.description === undefined ? {} : { description: fields.description }),
  };
}

/** The skills installed in the repo at `repoPath`, sorted by name, each once (the first folder's wins). */
export async function scanSkills(repoPath: string): Promise<InstalledSkill[]> {
  const repoReal = await realRepoRoot(repoPath);
  return repoReal === undefined ? [] : scanSkillsAt(repoReal);
}

/** {@link scanSkills} of the repo whose real path ({@link realRepoRoot}) is `repoReal`. */
export async function scanSkillsAt(repoReal: string): Promise<InstalledSkill[]> {
  const found = new Map<string, InstalledSkill>();
  for (const folder of SKILL_FOLDERS) {
    let names: string[];
    try {
      names = (await readdir(join(repoReal, ...folder))).sort().slice(0, MAX_SKILL_FOLDER_ENTRIES);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SKILL_NAME_PATTERN.test(name) || found.has(name)) continue;
      const text = await readInsideRepo(repoReal, [...folder, name, 'SKILL.md']);
      if (text === undefined) continue;
      const frontmatter = parseSkillFrontmatter(text);
      if (frontmatter?.name !== name) continue;
      found.set(name, { name, description: frontmatter.description ?? '' });
    }
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
