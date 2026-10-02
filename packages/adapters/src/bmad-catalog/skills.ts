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
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { SKILL_NAME_PATTERN, type CatalogSkill } from '@ogden-agents/shared';

/** Where skills are installed in a repo, relative to its root, in the order they are read. */
export const SKILL_FOLDERS: readonly (readonly string[])[] = [
  ['.agents', 'skills'],
  ['.claude', 'skills'],
];

/** How much of a `SKILL.md` is read: its frontmatter is at the top. */
export const MAX_SKILL_FILE_BYTES = 64 * 1024;

/** Whether `inner` is `outer` or inside it (both real paths). */
function inside(inner: string, outer: string): boolean {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The first {@link MAX_SKILL_FILE_BYTES} of `file` as text, or `undefined` on any error. */
async function readHead(file: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Only a regular file: opening a FIFO (or a device) could block forever.
    if (!(await stat(file)).isFile()) return undefined;
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(MAX_SKILL_FILE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_SKILL_FILE_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
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
export async function scanSkills(repoPath: string): Promise<CatalogSkill[]> {
  if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return [];
  let repoReal: string;
  try {
    // As `detect`: the root must be a real folder; a root swapped for a link is never followed into.
    if (!(await lstat(repoPath)).isDirectory()) return [];
    repoReal = await realpath(repoPath);
  } catch {
    return [];
  }
  const found = new Map<string, CatalogSkill>();
  for (const folder of SKILL_FOLDERS) {
    let names: string[];
    try {
      names = (await readdir(join(repoReal, ...folder))).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SKILL_NAME_PATTERN.test(name) || found.has(name)) continue;
      let file: string;
      try {
        file = await realpath(join(repoReal, ...folder, name, 'SKILL.md'));
      } catch {
        continue;
      }
      // A link anywhere on the way that leads out of the repo is never read.
      if (!inside(file, repoReal)) continue;
      const text = await readHead(file);
      if (text === undefined) continue;
      const frontmatter = parseSkillFrontmatter(text);
      if (frontmatter?.name !== name) continue;
      found.set(name, { name, description: frontmatter.description ?? '' });
    }
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
