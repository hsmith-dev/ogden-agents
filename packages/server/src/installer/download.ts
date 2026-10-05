/**
 * Safe downloads of GitHub release assets (story 3).
 *
 * Redirects are followed by hand: GitHub answers an asset request with a 302 to
 * a signed URL on another host, and the bearer token must never go there (it is
 * sent only to the API's own origin). Every hop must be https (or the API's own
 * origin, which is loopback http only in tests) on an allowed host, there are
 * at most five hops, and a download is capped in size. The bytes are hashed as
 * they arrive; the caller compares the hash, nothing here trusts them.
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export class DownloadError extends Error {
  readonly kind: 'not-found' | 'unauthorized' | 'too-big' | 'bad-redirect' | 'http' | 'network';
  constructor(kind: DownloadError['kind'], message: string) {
    super(message);
    this.name = 'DownloadError';
    this.kind = kind;
  }
}

export const DEFAULT_ALLOWED_HOST_SUFFIXES = ['github.com', 'githubusercontent.com'] as const;
const MAX_HOPS = 5;

export interface DownloadOptions {
  fetch: typeof fetch;
  url: string;
  /** Sent only to `apiOrigin`. */
  token: string | undefined;
  apiOrigin: string;
  maxBytes: number;
  /** Hosts besides the API's own (and `*.github.com`, `*.githubusercontent.com`); for tests. */
  extraAllowedHosts?: readonly string[];
}

function allowedHop(url: URL, apiOrigin: string, extra: readonly string[]): boolean {
  if (url.origin === apiOrigin) return true;
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return [...DEFAULT_ALLOWED_HOST_SUFFIXES, ...extra].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Follows redirects safely and returns the final successful response (its body not yet read). */
async function open_(options: DownloadOptions): Promise<Response> {
  let url = new URL(options.url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!allowedHop(url, options.apiOrigin, options.extraAllowedHosts ?? [])) {
      throw new DownloadError('bad-redirect', `refusing to download from ${url.origin}: it is not GitHub`);
    }
    const headers: Record<string, string> = { Accept: 'application/octet-stream', 'User-Agent': 'ogden-agents' };
    if (options.token !== undefined && url.origin === options.apiOrigin) headers.Authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
      response = await options.fetch(url, { headers, redirect: 'manual' });
    } catch (error) {
      throw new DownloadError('network', `could not download from ${url.host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (location === null) throw new DownloadError('bad-redirect', `${url.host} redirected without saying where`);
      url = new URL(location, url);
      continue;
    }
    if (response.status === 200) return response;
    await response.body?.cancel();
    if (response.status === 404) throw new DownloadError('not-found', `GitHub has no such file (404)`);
    if (response.status === 401 || response.status === 403) throw new DownloadError('unauthorized', `GitHub refused the download (${response.status})`);
    throw new DownloadError('http', `GitHub answered the download with ${response.status}`);
  }
  throw new DownloadError('bad-redirect', 'too many redirects');
}

/** Downloads to `file` and returns the SHA-256 (hex) and the size of what was written. */
export async function downloadToFile(options: DownloadOptions, file: string): Promise<{ sha256: string; bytes: number }> {
  const response = await open_(options);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > options.maxBytes) {
    await response.body?.cancel();
    throw new DownloadError('too-big', `the file is ${declared} bytes, more than the ${options.maxBytes} byte limit`);
  }
  if (response.body === null) throw new DownloadError('http', 'GitHub sent an empty answer');
  const hash = createHash('sha256');
  const handle = await open(file, 'wx', 0o600);
  let bytes = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > options.maxBytes) throw new DownloadError('too-big', `the file is larger than the ${options.maxBytes} byte limit`);
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest('hex'), bytes };
}

/** Downloads a small text file (the checksum list). */
export async function downloadText(options: DownloadOptions): Promise<string> {
  const response = await open_(options);
  if (response.body === null) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.byteLength;
    if (bytes > options.maxBytes) throw new DownloadError('too-big', 'the file is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
