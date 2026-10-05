/**
 * A ticket's checkpoint flags (story 5.4; user decision 2026-10-04): BMad
 * Method's `tickets.py find` doesn't report `plan_checkpoint` or
 * `done_checkpoint`, so the `tickets-v7` adapter reads them, read-only, from
 * the ticket's entry in its epic's `tickets.toml`.
 *
 * The file must be a regular file (never a link) inside the repo, at most
 * {@link MAX_TICKETS_TOML_BYTES}; anything else, or an entry that isn't
 * there, reads as no checkpoints. Only `key = true|false` lines inside the
 * `[[entry]]` table whose `id` is the ticket's are read; the lines of a
 * multi-line string (`"""` or `'''`) are skipped, so neither a line in one
 * that starts with `[` nor one that reads like a key changes what is read.
 * (`bmad-catalog/toml.ts` keeps no booleans, so it can't answer this.)
 * Never throws.
 */
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

/** The most bytes of a `tickets.toml` read for checkpoint flags. */
export const MAX_TICKETS_TOML_BYTES = 1024 * 1024;

export interface TicketCheckpoints {
  plan_checkpoint: boolean;
  done_checkpoint: boolean;
}

const NONE: TicketCheckpoints = { plan_checkpoint: false, done_checkpoint: false };

/** Strips a trailing `# comment` from a value that holds no string. */
const bare = (value: string): string => value.replace(/#.*$/, '').trim();

/** The checkpoint flags of the `[[entry]]` whose `id` is `id` in `text` (a `tickets.toml`). */
export function checkpointsFromToml(text: string, id: number | string): TicketCheckpoints {
  const wanted = String(id);
  let inEntry = false;
  let entry: { id?: string; plan: boolean; done: boolean } | undefined;
  const entries: Array<{ id?: string; plan: boolean; done: boolean }> = [];
  /** The closing delimiter of the multi-line string a line is in, if any. */
  let inString: '"""' | "'''" | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inString !== undefined) {
      if (line.split(inString).length % 2 === 0) inString = undefined;
      continue;
    }
    // A line that opens a multi-line string without closing it: the lines after it are the string's.
    for (const delimiter of ['"""', "'''"] as const) {
      if (line.split(delimiter).length % 2 === 0) {
        inString = delimiter;
        break;
      }
    }
    // A table header (`[name]`, `[[name]]`); any other line starting with `[` is a value (a nested array's line).
    if (/^\[\[?\s*[A-Za-z0-9_."' -]+\s*\]\]?\s*(#.*)?$/.test(line)) {
      inEntry = /^\[\[\s*entry\s*\]\]\s*(#.*)?$/.test(line);
      entry = inEntry ? { plan: false, done: false } : undefined;
      if (entry !== undefined) entries.push(entry);
      continue;
    }
    if (!inEntry || entry === undefined) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, rest] = match as unknown as [string, string, string];
    const value = bare(rest);
    if (key === 'id' && entry.id === undefined) {
      const quoted = /^"([^"\\]*)"$|^'([^']*)'$/.exec(value);
      entry.id = quoted === null ? value : (quoted[1] ?? quoted[2]);
    } else if (key === 'plan_checkpoint') entry.plan = value === 'true';
    else if (key === 'done_checkpoint') entry.done = value === 'true';
  }
  const found = entries.find((each) => each.id === wanted);
  return found === undefined ? NONE : { plan_checkpoint: found.plan, done_checkpoint: found.done };
}

/** Whether `inner` is `outer` or inside it. */
const inside = (outer: string, inner: string): boolean => {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * The checkpoint flags of ticket `id` whose epic file is `epicFile` (as
 * `tickets.py find` reports it) in the repo at `repoPath`. No checkpoints
 * for a ticket without an epic file or id, or a file that can't be read
 * safely.
 */
export async function readTicketCheckpoints(repoPath: string, epicFile: unknown, id: unknown): Promise<TicketCheckpoints> {
  if (typeof epicFile !== 'string' || !isAbsolute(epicFile)) return NONE;
  if (typeof id !== 'number' && typeof id !== 'string') return NONE;
  try {
    const file = join(dirname(epicFile), 'tickets.toml');
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_TICKETS_TOML_BYTES) return NONE;
    const [repo, real] = await Promise.all([realpath(repoPath), realpath(file)]);
    if (!inside(repo, real) || real === repo) return NONE;
    // Never through a link swapped in since, never blocking on a FIFO: the opened file itself must be a regular one (review).
    const handle = await open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > MAX_TICKETS_TOML_BYTES) return NONE;
      const buffer = Buffer.alloc(opened.size);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return checkpointsFromToml(buffer.subarray(0, bytesRead).toString('utf8'), id);
    } finally {
      await handle.close();
    }
  } catch {
    return NONE;
  }
}
