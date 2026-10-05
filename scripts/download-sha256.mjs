/**
 * The pin checks' shared download (moved from `check-uv-pins.mjs`, epic 6
 * entry 5): a URL's SHA-256 and size, hashed as it streams in (the bytes as
 * received, after any transfer encoding), with a 5-minute limit per attempt,
 * five attempts and back-off. Used by `check-uv-pins.mjs` and
 * `agent-pins.mjs --agent antigravity`. Needs the network; no test runs it.
 */
import { createHash } from 'node:crypto';

const ATTEMPTS = 5;
/** How often a long download says how far it got, in bytes. */
const PROGRESS_EVERY = 50 * 1024 * 1024;

/**
 * Downloads `url` and returns its lowercase hex SHA-256 and its size.
 * @param {string} url
 * @param {string | undefined} label  when given, progress lines name it
 * @returns {Promise<{ sha256: string, size: number }>}
 */
async function sha256Of(url, label) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
  const hash = createHash('sha256');
  let size = 0;
  let reported = 0;
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) {
    hash.update(chunk);
    size += chunk.byteLength;
    if (label !== undefined && size - reported >= PROGRESS_EVERY) {
      reported = size;
      console.log(`${label}: ${Math.round(size / 1024 / 1024)} MB`);
    }
  }
  return { sha256: hash.digest('hex'), size };
}

/**
 * {@link sha256Of} with five attempts and back-off (5 s, 10 s, 20 s, 40 s).
 * @param {string} url
 * @param {string} [label]
 * @returns {Promise<{ sha256: string, size: number }>}
 */
export async function sha256WithRetry(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await sha256Of(url, label);
    } catch (error) {
      lastError = error;
      if (label !== undefined) console.log(`${label}: attempt ${attempt} failed (${String(error)})`);
      if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
