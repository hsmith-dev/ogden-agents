/**
 * Claude Code's own record of a session (story 3.3, E3-R4): the JSONL file
 * the CLI and the Agent SDK write to
 * `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<folder slug>/<session id>.jsonl`,
 * read back so core can import the turns typed in the terminal.
 *
 * - Only that one file is read: its folder comes from the session's working
 *   folder, its name from the session id, which must look like one (never a
 *   path). A symlink, or a folder that resolves outside `projects`, is refused.
 * - A file over {@link MAX_TRANSCRIPT_BYTES} is not read. Lines that are not
 *   JSON and records of unknown shape are skipped, never fatal.
 * - Only the main chain counts (from the newest non-sidechain record back by
 *   `parentUuid`, as the Agent SDK reads it, so a `/rewind` is honoured), and
 *   of it only what a person reads: the user's own text and the text of the
 *   agent's reply, never thinking, tool calls, tool results, meta records or
 *   the CLI's `<command-…>`/`<local-command-…>`/`<system-reminder>` wrappers.
 * - Every text is masked with the session environment's secrets, and any
 *   Anthropic key in it redacted as the log's backstop does (AD-16).
 *   Nothing read is logged; an error carries a code, never a path or content.
 */
import { constants, type Stats } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { AgentError, type AgentTranscriptTurn } from '@ogden-agents/core';
import { redactAnthropicKeys } from '@ogden-agents/shared';
import { maskSecrets, secretValues } from '../acp-base/mask.js';
import { SESSION_ID } from './terminal-command.js';

/** The largest session record read; a larger one is not imported (story 3.3). */
export const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

/** Claude Code's longest project folder name before it shortens the name and adds a hash. */
const MAX_SLUG_LENGTH = 200;

/** Why a session record couldn't be read: logged as codes, never with a path. */
export type ClaudeTranscriptErrorCode = 'transcript_too_large' | 'transcript_unsafe_path' | 'transcript_unreadable' | 'transcript_bad_session_id';

const transcriptError = (code: ClaudeTranscriptErrorCode, message: string) =>
  new AgentError('agent_failed', message, { details: { code } });

/** Claude Code's configuration folder for `env`: `CLAUDE_CONFIG_DIR`, else `.claude` in the home folder. */
export function claudeConfigDir(env: Readonly<Record<string, string>>): string {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
  return join(home, '.claude');
}

/** The name Claude Code gives a working folder's project folder: every non-alphanumeric character a `-`. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

const isMissing = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/** Whether `inner` is `outer` itself or lies inside it (both resolved). */
const isInside = (outer: string, inner: string) => {
  const rel = relative(outer, inner);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * The session's record file, or `undefined` when there is none. A long
 * folder's slug is shortened by Claude Code with a hash this can't
 * recompute, so its folder is the one whose name starts with the cut slug.
 */
async function findRecord(projects: string, cwd: string, agentSessionId: string): Promise<string | undefined> {
  const slug = projectSlug(cwd);
  const candidates = [join(projects, slug)];
  if (slug.length > MAX_SLUG_LENGTH) {
    const prefix = `${slug.slice(0, MAX_SLUG_LENGTH)}-`;
    try {
      for (const name of await readdir(projects)) if (name.startsWith(prefix)) candidates.push(join(projects, name));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  for (const folder of candidates) {
    const file = join(folder, `${agentSessionId}.jsonl`);
    let stats: Stats;
    try {
      stats = await lstat(file);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) throw transcriptError('transcript_unsafe_path', "Claude Code's session record isn't a plain file.");
    // The project folder itself may not lead out of `projects` (a symlinked folder).
    const [realProjects, realFolder] = await Promise.all([realpath(projects), realpath(dirname(file))]);
    if (!isInside(realProjects, realFolder)) throw transcriptError('transcript_unsafe_path', "Claude Code's session record is outside its projects folder.");
    return file;
  }
  return undefined;
}

/**
 * The session's conversation as Claude Code recorded it, oldest first:
 * `[]` when it has no record yet. Rejects with an {@link AgentError} (its
 * `details.code` a {@link ClaudeTranscriptErrorCode}) when the record is
 * too large, unsafe or unreadable.
 */
export async function readClaudeTranscript(input: {
  agentSessionId: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
}): Promise<AgentTranscriptTurn[]> {
  if (!SESSION_ID.test(input.agentSessionId)) throw transcriptError('transcript_bad_session_id', "This chat's Claude Code session id isn't valid.");
  const projects = join(claudeConfigDir(input.env), 'projects');
  let text: string;
  try {
    const file = await findRecord(projects, input.cwd, input.agentSessionId);
    if (file === undefined) return [];
    // No following a symlink swapped in since the check, and no blocking on a FIFO, where the platform can say so.
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stats = await handle.stat();
      // What was opened, not what was checked: a plain file only (review F3).
      if (!stats.isFile()) throw transcriptError('transcript_unsafe_path', "Claude Code's session record isn't a plain file.");
      const { size } = stats;
      if (size > MAX_TRANSCRIPT_BYTES) throw transcriptError('transcript_too_large', "Claude Code's session record is too large to import.");
      const buffer = Buffer.alloc(size);
      let read = 0;
      while (read < size) {
        const { bytesRead } = await handle.read(buffer, read, size - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      text = buffer.subarray(0, read).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof AgentError) throw error;
    if (isMissing(error)) return [];
    // A file-system error names the path: only its code goes on.
    throw transcriptError('transcript_unreadable', "Claude Code's session record couldn't be read.");
  }
  return parseClaudeTranscript(text, secretValues(input.env));
}

/** The fields of a record this reads; anything else in it is ignored. */
interface TranscriptRecord {
  type: string;
  uuid: string;
  parent: string | undefined;
  isSidechain: boolean;
  hidden: boolean;
  content: unknown;
}

const asRecord = (value: unknown): TranscriptRecord | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string' || typeof raw.uuid !== 'string' || raw.uuid === '') return undefined;
  const parentUuid = typeof raw.parentUuid === 'string' && raw.parentUuid !== '' ? raw.parentUuid : undefined;
  // A compaction boundary starts a new chain whose logical parent is the old one's end.
  const logical = typeof raw.logicalParentUuid === 'string' && raw.logicalParentUuid !== '' ? raw.logicalParentUuid : undefined;
  const message = raw.message;
  return {
    type: raw.type,
    uuid: raw.uuid,
    parent: parentUuid ?? logical,
    isSidechain: raw.isSidechain === true,
    hidden: raw.isMeta === true || raw.isCompactSummary === true || raw.isVisibleInTranscriptOnly === true || raw.isApiErrorMessage === true,
    content: typeof message === 'object' && message !== null ? (message as { content?: unknown }).content : undefined,
  };
};

/** The text pieces of a message's content: the string itself, or its `text` blocks. */
const textPieces = (content: unknown): string[] => {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const pieces: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') pieces.push(text);
    }
  }
  return pieces;
};

/** Text the CLI adds around or instead of what the user typed: slash commands, their output, reminders, bash mode. */
const WRAPPER = /^<(command-|local-command-|bash-|system-reminder>)/;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;

/** What the user typed in a user record, or `undefined` for one that carries none (a tool result, a command). */
const userText = (content: unknown): string | undefined => {
  const kept: string[] = [];
  for (const piece of textPieces(content)) {
    const text = piece.replace(REMINDER, '').trim();
    if (text === '' || WRAPPER.test(text) || INTERRUPTED.test(text)) continue;
    kept.push(text);
  }
  return kept.length === 0 ? undefined : kept.join('\n\n');
};

/**
 * The turns of a session record's text (one JSON record per line), oldest
 * first, each text masked with `secrets`. Exported for the tests.
 */
export function parseClaudeTranscript(text: string, secrets: readonly string[]): AgentTranscriptTurn[] {
  const byUuid = new Map<string, TranscriptRecord>();
  let leaf: TranscriptRecord | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (record === undefined) continue;
    byUuid.set(record.uuid, record);
    if (!record.isSidechain && (record.type === 'user' || record.type === 'assistant')) leaf = record;
  }
  const chain: TranscriptRecord[] = [];
  const seen = new Set<string>();
  for (let at = leaf; at !== undefined && !seen.has(at.uuid); at = at.parent === undefined ? undefined : byUuid.get(at.parent)) {
    seen.add(at.uuid);
    chain.push(at);
  }
  chain.reverse();

  const mask = (value: string) => redactAnthropicKeys(maskSecrets(value, secrets));
  const turns: AgentTranscriptTurn[] = [];
  let exchange: string | undefined;
  let reply: string[] = [];
  const flush = () => {
    if (exchange !== undefined && reply.length > 0) turns.push({ id: exchange, role: 'agent', text: mask(reply.join('\n\n')) });
    reply = [];
  };
  for (const record of chain) {
    if (record.isSidechain || record.hidden) continue;
    if (record.type === 'user') {
      const typed = userText(record.content);
      if (typed === undefined) continue;
      flush();
      exchange = record.uuid;
      turns.push({ id: exchange, role: 'user', text: mask(typed) });
    } else if (record.type === 'assistant' && exchange !== undefined) {
      for (const piece of textPieces(record.content)) if (piece.trim() !== '') reply.push(piece.trim());
    }
  }
  flush();
  return turns;
}
