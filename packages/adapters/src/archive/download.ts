/**
 * Downloads Antigravity's pinned archive to a file in the data folder (epic 6
 * entry 7), so an interrupted download resumes instead of starting over.
 *
 * - `Accept-Encoding: identity`, so the bytes saved are the archive's bytes
 *   (spike 6.1: the pinned SHA-256 is of those, and a decoded gzip transfer
 *   reports another length) and a `Range` offset means the same thing.
 * - A partial file resumes with `Range` and `If-Range` (the `ETag` it was
 *   started with); a server that answers 200 instead starts it again.
 * - Never more than the pinned size is written; a download that goes quiet
 *   for the idle timeout counts as failed. Network failures and 5xx answers
 *   are retried a few times with back-off, each try resuming.
 * - Once the file is the pinned size, its SHA-256 is checked; a mismatch
 *   deletes it (a corrupt file is never resumed) and nothing is unpacked.
 *
 * Nothing here logs the URL's answer or any header; failures carry codes.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { errorCode } from '../error-code.js';

/** How long a download may go without a byte before it counts as failed. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
/** Tries per install (each resumes where the last stopped). */
export const DOWNLOAD_ATTEMPTS = 3;
/** The first back-off between tries; doubled each time. */
export const DOWNLOAD_BACKOFF_MS = 1_000;

export type DownloadFailure = 'network' | 'http' | 'mismatch' | 'aborted' | 'disk';

export class DownloadError extends Error {
  override readonly name = 'DownloadError';
  constructor(
    readonly kind: DownloadFailure,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`download ${kind}`);
  }
}

export interface DownloadOptions {
  url: string;
  /** The pinned size in bytes. */
  size: number;
  /** The pinned SHA-256, lower-case hex. */
  sha256: string;
  /** Where the bytes go; `<partFile>.json` keeps what a resume needs (the URL and its `ETag`). */
  partFile: string;
  fetch?: typeof fetch;
  idleTimeoutMs?: number;
  attempts?: number;
  backoffMs?: number;
  signal?: AbortSignal;
  /** Bytes so far, out of {@link size}. */
  onProgress?: (bytes: number, total: number) => void;
  /** Sleeps between tries (tests: none). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface PartMeta {
  url: string;
  etag?: string;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function readMeta(file: string): Promise<PartMeta | undefined> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<PartMeta>;
    return typeof value.url === 'string' ? { url: value.url, ...(typeof value.etag === 'string' ? { etag: value.etag } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

/** Removes a partial download and what resumes it. */
export async function discardPartial(partFile: string): Promise<void> {
  await rm(partFile, { force: true });
  await rm(`${partFile}.json`, { force: true });
}

/** The SHA-256 of `file`, streamed. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Whether a failure is worth another try: the network, a stall, or the server's own trouble. */
function retryable(error: unknown): boolean {
  if (!(error instanceof DownloadError)) return false;
  if (error.kind === 'network') return true;
  const status = error.details.status;
  return error.kind === 'http' && typeof status === 'number' && (status >= 500 || status === 429 || status === 416);
}

/**
 * Brings `partFile` to the pinned archive, resuming what is there, and checks
 * its SHA-256. Resolves once it matches; rejects with a {@link DownloadError}.
 */
export async function downloadVerified(options: DownloadOptions): Promise<void> {
  const attempts = options.attempts ?? DOWNLOAD_ATTEMPTS;
  const backoff = options.backoffMs ?? DOWNLOAD_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new DownloadError('aborted');
    try {
      await fetchRest(options);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw new DownloadError('aborted');
      if (!retryable(error) || attempt === attempts) throw error;
      await sleep(backoff * 2 ** (attempt - 1), options.signal);
    }
  }
  if (lastError !== undefined) throw lastError;
  const actual = await sha256File(options.partFile).catch((error: unknown) => {
    throw new DownloadError('disk', { code: errorCode(error, 'unknown') });
  });
  if (actual !== options.sha256.toLowerCase()) {
    await discardPartial(options.partFile).catch(() => {});
    throw new DownloadError('mismatch', { reason: 'sha256' });
  }
}

/** One try: fetches what `partFile` is missing. */
async function fetchRest(options: DownloadOptions): Promise<void> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const metaFile = `${options.partFile}.json`;
  let meta = await readMeta(metaFile);
  let have = await sizeOf(options.partFile);
  // Another URL (a new pin), no way to resume safely, or more than the pin: start again.
  // Without an `ETag` a part still resumes: the SHA-256 check catches a file that changed meanwhile.
  if (meta?.url !== options.url || have > options.size) {
    if (have > 0 || meta !== undefined) await discardPartial(options.partFile);
    have = 0;
    meta = undefined;
  }
  options.onProgress?.(have, options.size);
  if (have === options.size) return;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const idleMs = options.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), idleMs);
  };
  armIdle();
  try {
    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    if (have > 0) {
      headers.range = `bytes=${have}-`;
      if (meta?.etag !== undefined) headers['if-range'] = meta.etag;
    }
    let response: Response;
    try {
      response = await fetchImpl(options.url, { headers, redirect: 'follow', signal: controller.signal });
    } catch (error) {
      throw new DownloadError('network', { code: controller.signal.aborted ? 'stalled' : errorCode((error as { cause?: unknown }).cause ?? error, 'unknown') });
    }
    if (response.status === 416) {
      // The part no longer fits what the server has: start again next try.
      void response.body?.cancel().catch(() => {});
      await discardPartial(options.partFile);
      throw new DownloadError('http', { status: 416 });
    }
    if (!response.ok || response.body === null) {
      void response.body?.cancel().catch(() => {});
      throw new DownloadError('http', { status: response.status });
    }
    let offset = 0;
    if (response.status === 206) {
      const range = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(response.headers.get('content-range') ?? '');
      if (range === null || Number(range[1]) !== have || (range[2] !== '*' && Number(range[2]) !== options.size)) {
        void response.body.cancel().catch(() => {});
        await discardPartial(options.partFile);
        throw new DownloadError('http', { status: 416, reason: 'range' });
      }
      offset = have;
    }
    const encoding = response.headers.get('content-encoding');
    if (encoding !== null && encoding !== '' && encoding !== 'identity') {
      // A decoded transfer would not be the archive's bytes to resume from.
      void response.body.cancel().catch(() => {});
      throw new DownloadError('http', { status: response.status, reason: 'encoded' });
    }
    const etag = response.headers.get('etag') || undefined;
    await writeFile(metaFile, JSON.stringify({ url: options.url, ...(etag === undefined ? {} : { etag }) }), { mode: 0o600 });

    let file;
    try {
      file = await open(options.partFile, offset === 0 ? 'w' : 'a', 0o600);
    } catch (error) {
      void response.body.cancel().catch(() => {});
      throw new DownloadError('disk', { code: errorCode(error, 'unknown') });
    }
    let bytes = offset;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        armIdle();
        if (bytes + chunk.byteLength > options.size) {
          controller.abort();
          await file.close().catch(() => {});
          await discardPartial(options.partFile);
          throw new DownloadError('mismatch', { reason: 'larger than the pinned size' });
        }
        try {
          await file.write(chunk);
        } catch (error) {
          throw new DownloadError('disk', { code: errorCode(error, 'unknown') });
        }
        bytes += chunk.byteLength;
        options.onProgress?.(bytes, options.size);
      }
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      throw new DownloadError('network', { code: controller.signal.aborted ? 'stalled' : errorCode((error as { cause?: unknown }).cause ?? error, 'unknown'), bytes });
    } finally {
      await file.close().catch(() => {});
    }
    if (bytes !== options.size) throw new DownloadError('network', { code: 'ended_early', bytes });
  } finally {
    clearTimeout(idle);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
