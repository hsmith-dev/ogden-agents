/**
 * A build run's folder in Ogden Agents' data folder (story 5.4; AD-17,
 * bmad-integration.md Upstream extensions): `<data>/r/<runId>`, never in the
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
import { appendFile, lstat, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD_ACTIVITY_FILE, BUILD_RESULT_FILE, BuildRunResult, RunId, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';

/** The folder of every run's folder, inside Ogden Agents' data folder: `<data>/r/<runId>`. */
export const RUNS_DIR = 'r';

/** The most bytes of a run's activity file; past it, one `activity.truncated` line and nothing more. */
export const MAX_ACTIVITY_BYTES = 32 * 1024 * 1024;

/** The event types a run's activity holds: its session's stream, but no message deltas. */
const RECORDED = /^(session|permission|run)\./;
const SKIPPED: ReadonlySet<string> = new Set(['session.message_delta']);

/** Words in a run's activity that say a command failed for want of network (builds have none; story 5.2 decision). */
export const NO_NETWORK_PATTERN = /\b(ENOTFOUND|EAI_AGAIN|getaddrinfo|could not resolve host|network is unreachable|temporary failure in name resolution)\b/i;

/** Run `runId`'s folder in `dataDir`. Throws for anything that isn't a run id (never a path from elsewhere). */
export function runFolderOf(dataDir: string, runId: string): string {
  return join(dataDir, RUNS_DIR, RunId.parse(runId));
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
  /** Each session stream's run, or `null` for a stream that is not a build's (looked up once). */
  const streams = new Map<string, string | null>();
  const logs = new Map<string, RunLog>();

  const runOfStream = (streamId: string): string | undefined => {
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
    if (run !== undefined) streams.set(streamId, run.id);
    return run?.id;
  };

  const write = async (log: RunLog, line: string): Promise<void> => {
    if (log.truncated) return;
    await ensureFolder(log.folder);
    const file = join(log.folder, BUILD_ACTIVITY_FILE);
    if (log.bytes === undefined) log.bytes = await stat(file).then((info) => info.size, () => 0);
    const size = Buffer.byteLength(line);
    if (log.bytes + size > (deps.maxBytes ?? MAX_ACTIVITY_BYTES)) {
      log.truncated = true;
      await appendFile(file, `${JSON.stringify({ type: 'activity.truncated' })}\n`, { mode: 0o600 });
      return;
    }
    log.bytes += size;
    await appendFile(file, line, { mode: 0o600 });
  };

  const record = (event: CoreEvent) => {
    if (!RECORDED.test(event.type) || SKIPPED.has(event.type)) return;
    const runId = runOfStream(event.streamId);
    if (runId === undefined) return;
    let log = logs.get(runId);
    if (log === undefined) {
      log = { folder: runFolderOf(dataDir, runId), bytes: undefined, truncated: false, network: false, queue: Promise.resolve() };
      logs.set(runId, log);
    }
    const line = `${mask(JSON.stringify({ seq: event.seq, at: event.at, type: event.type, payload: event.payload }))}\n`;
    if (NO_NETWORK_PATTERN.test(line)) log.network = true;
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
