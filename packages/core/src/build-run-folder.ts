/**
 * A build run's folder in Ogden Agents' data folder (story 5.4; AD-17,
 * bmad-integration.md Upstream extensions): `<data>/r/<run8>` (the run's
 * 8-character id, as its worktree `<data>/w/<run8>` and branch
 * `ogden/<run8>/…` have it; short for Windows), never in the
 * repo or the run's worktree, which the sandboxed agent can't read (its
 * sandbox denies the data folder). It holds:
 *
 * - `activity.ndjson`: the run's session stream as Ogden Agents stored it
 *   (`session.*`, `permission.*` and `run.*` events, already masked, masked
 *   again here), one JSON line each (`seq`, `at`, `type`, `payload`), the
 *   same events the session view renders (AD-5). Message deltas are left
 *   out: the completed message replaces them. Bounded by
 *   {@link MAX_ACTIVITY_BYTES}, then one `activity.truncated` line.
 * - `result.json`: the per-run JSON result, parsed as `BuildRunResult`
 *   before it is written, through a temporary file and a rename, so a reader
 *   never sees half of one. Written each time the build session stops (a
 *   checkpoint pause, the end of the run).
 *
 * The folder is `0o700` and the files `0o600`. Agent-neutral: core names no
 * agent or skill here (AD-1, AD-12).
 */
import { randomBytes } from 'node:crypto';
import { appendFile, lstat, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD_ACTIVITY_FILE, BUILD_RESULT_FILE, BuildRunResult, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';

/** The folder of every run's folder, inside Ogden Agents' data folder: `<data>/r/<run8>`. */
export const RUNS_DIR = 'r';

/** The most bytes of a run's activity file; past it, one `activity.truncated` line and nothing more. */
export const MAX_ACTIVITY_BYTES = 32 * 1024 * 1024;

/** The event types a run's activity holds: its session's stream, but no message deltas. */
const RECORDED = /^(session|permission|run)\./;
const SKIPPED: ReadonlySet<string> = new Set(['session.message_delta']);

/**
 * Words in the agent's own messages or tool calls that say a command failed
 * for want of network (builds have none; story 5.2 decision). Never read in
 * a user's message, a permission event or a run event.
 */
export const NO_NETWORK_PATTERN = /\b(ENOTFOUND|EAI_AGAIN|getaddrinfo|could not resolve host|network is unreachable|temporary failure in name resolution)\b/i;

/** The run's 8-character id from its branch (`ogden/<run8>/…`), or `undefined` for a run without one. */
export function runShortOf(run: { branch: string | null }): string | undefined {
  return run.branch === null ? undefined : /^ogden\/([a-z2-7]{8})\//.exec(run.branch)?.[1];
}

/** The folder of the run whose 8-character id is `runShort` in `dataDir`. Throws for anything else (never a path from elsewhere). */
export function runFolderOf(dataDir: string, runShort: string): string {
  if (!/^[a-z2-7]{8}$/.test(runShort)) throw new Error('not a run id');
  return join(dataDir, RUNS_DIR, runShort);
}

/** `value` with every string in it masked. */
function maskStrings(value: unknown, mask: (text: string) => string): unknown {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map((each) => maskStrings(each, mask));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, maskStrings(each, mask)]));
  return value;
}

/** The line that ends a run's activity at its bound. */
const TRUNCATED_LINE = `${JSON.stringify({ type: 'activity.truncated' })}\n`;

/** The last `count` bytes of `file`, as text. */
async function lastBytes(file: string, count: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(count, size));
    await handle.read(buffer, 0, buffer.length, size - buffer.length);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Whether `event` is the agent's own message or tool call naming a no-network failure. */
function saysNoNetwork(event: CoreEvent): boolean {
  if (event.type === 'session.message_completed') return event.payload.role === 'agent' && NO_NETWORK_PATTERN.test(event.payload.content);
  if (event.type === 'session.tool_call' || event.type === 'session.tool_call_updated') return NO_NETWORK_PATTERN.test(event.payload.title);
  return false;
}

/** Makes `folder` (`0o700`), refusing one that is a link. */
async function ensureFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const info = await lstat(folder);
  if (!info.isDirectory()) throw new Error('the run folder is not a folder');
}

/**
 * Writes `result` (parsed as `BuildRunResult` first: an invalid one throws
 * and writes nothing) to `folder`'s `result.json`, atomically.
 */
export async function writeRunResult(folder: string, result: BuildRunResult): Promise<BuildRunResult> {
  const checked = BuildRunResult.parse(result);
  await ensureFolder(folder);
  const temporary = join(folder, `.${BUILD_RESULT_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(folder, BUILD_RESULT_FILE));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return checked;
}

export interface RunActivityRecorder {
  /** Whether run `runId`'s recorded activity says a command failed for want of network. */
  networkFailure(runId: string): boolean;
  /** Resolves once every line handed to the recorder so far is written (tests, a run's end). */
  flushed(runId?: string): Promise<void>;
  /** Stops following the event log. */
  close(): void;
}

export interface RunActivityRecorderDeps {
  events: Pick<EventLog, 'subscribe' | 'lastSeq'>;
  entities: Pick<Entities, 'getSession' | 'getRunBySession'>;
  dataDir: string;
  /** Masks secrets in each line (AGENTS.md). */
  mask: (text: string) => string;
  onError?: (runId: string, error: unknown) => void;
  /** The activity file's bound (tests). Default {@link MAX_ACTIVITY_BYTES}. */
  maxBytes?: number;
}

interface RunLog {
  folder: string;
  /** Bytes written so far (read from the file the first time, so a restart keeps counting). */
  bytes: number | undefined;
  truncated: boolean;
  network: boolean;
  queue: Promise<void>;
}

/** Follows the event log from now on and appends each build run's session events to its activity file. */
export function createRunActivityRecorder(deps: RunActivityRecorderDeps): RunActivityRecorder {
  const { events, entities, dataDir, mask } = deps;
  /** Each session stream's run (its id and folder), or `null` for a stream that is not a build's (looked up once). */
  const streams = new Map<string, { runId: string; folder: string } | null>();
  const logs = new Map<string, RunLog>();

  const runOfStream = (streamId: string): { runId: string; folder: string } | undefined => {
    const known = streams.get(streamId);
    if (known !== undefined) return known ?? undefined;
    if (!streamId.startsWith('ses_')) {
      streams.set(streamId, null);
      return undefined;
    }
    const session = entities.getSession(streamId as SessionId);
    if (session === undefined || session.kind !== 'build') {
      streams.set(streamId, null);
      return undefined;
    }
    // A build session before its run exists (its `session.created`) is looked up again next time.
    const run = entities.getRunBySession(streamId as SessionId);
    if (run === undefined) return undefined;
    const short = runShortOf(run);
    const found = short === undefined ? null : { runId: run.id, folder: runFolderOf(dataDir, short) };
    streams.set(streamId, found);
    return found ?? undefined;
  };

  const max = deps.maxBytes ?? MAX_ACTIVITY_BYTES;
  const write = async (log: RunLog, line: string): Promise<void> => {
    if (log.truncated) return;
    await ensureFolder(log.folder);
    const file = join(log.folder, BUILD_ACTIVITY_FILE);
    if (log.bytes === undefined) {
      log.bytes = await stat(file).then((info) => info.size, () => 0);
      // Truncated before a restart (its last line is the marker, or it is at its bound): it stays so.
      if (log.bytes >= max || (log.bytes >= TRUNCATED_LINE.length && (await lastBytes(file, TRUNCATED_LINE.length)) === TRUNCATED_LINE)) {
        log.truncated = true;
        return;
      }
    }
    const size = Buffer.byteLength(line);
    if (log.bytes + size > max) {
      log.truncated = true;
      await appendFile(file, TRUNCATED_LINE, { mode: 0o600 });
      return;
    }
    log.bytes += size;
    await appendFile(file, line, { mode: 0o600 });
  };

  const record = (event: CoreEvent) => {
    if (!RECORDED.test(event.type) || SKIPPED.has(event.type)) return;
    const found = runOfStream(event.streamId);
    if (found === undefined) return;
    const { runId } = found;
    let log = logs.get(runId);
    if (log === undefined) {
      log = { folder: found.folder, bytes: undefined, truncated: false, network: false, queue: Promise.resolve() };
      logs.set(runId, log);
    }
    // Each string masked before it is encoded (review: a secret holding a quote or newline would be escaped past the mask).
    const line = `${JSON.stringify({ seq: event.seq, at: event.at, type: event.type, payload: maskStrings(event.payload, mask) })}\n`;
    if (saysNoNetwork(event)) log.network = true;
    const current = log;
    current.queue = current.queue.then(() => write(current, line)).catch((error: unknown) => {
      try {
        deps.onError?.(runId, error);
      } catch {
        // Logging must never break a run.
      }
    });
  };

  const unsubscribe = events.subscribe(events.lastSeq(), record);
  return {
    networkFailure: (runId) => logs.get(runId)?.network === true,
    async flushed(runId) {
      if (runId !== undefined) return logs.get(runId)?.queue;
      await Promise.all([...logs.values()].map((log) => log.queue));
    },
    close: unsubscribe,
  };
}
