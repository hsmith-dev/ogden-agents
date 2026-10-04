#!/usr/bin/env node
/**
 * Re-downloads every uv archive pinned in
 * `packages/adapters/src/toolchain-uv/uv-release.json` and checks its SHA-256
 * and size against the pin (story 1.8), so a wrong pin is caught in CI rather than on a
 * user's computer. Needs the network; the unit tests never do.
 *
 *   node scripts/check-uv-pins.mjs
 *
 * Exits 0 when every pin matches, 1 otherwise. To bump uv, change `version`
 * and the hashes, then run this.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RELEASE_FILE = fileURLToPath(new URL('../packages/adapters/src/toolchain-uv/uv-release.json', import.meta.url));

/** @typedef {{ file: string, size: number, sha256: string }} Archive */
/** @type {{ version: string, baseUrl: string, archives: Record<string, Archive> }} */
const release = JSON.parse(readFileSync(RELEASE_FILE, 'utf8'));

const ATTEMPTS = 5;

/**
 * Downloads `url` and returns its lowercase hex SHA-256 and its size.
 * @param {string} url
 * @returns {Promise<{ sha256: string, size: number }>}
 */
async function sha256Of(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) {
    hash.update(chunk);
    size += chunk.byteLength;
  }
  return { sha256: hash.digest('hex'), size };
}

/**
 * @param {string} url
 * @returns {Promise<{ sha256: string, size: number }>}
 */
async function sha256WithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await sha256Of(url);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

const entries = Object.entries(release.archives);
let failures = 0;
console.log(`Checking ${entries.length} pinned uv ${release.version} archives against ${release.baseUrl}`);
for (const [target, archive] of entries) {
  const url = `${release.baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(release.version)}/${encodeURIComponent(archive.file)}`;
  try {
    const actual = await sha256WithRetry(url);
    if (actual.sha256 === archive.sha256.toLowerCase() && actual.size === archive.size) {
      console.log(`ok       ${target}  ${actual.size}  ${actual.sha256}`);
    } else {
      failures++;
      console.error(
        `MISMATCH ${target}\n  pinned   ${archive.size}  ${archive.sha256}\n  download ${actual.size}  ${actual.sha256}\n  from     ${url}`,
      );
    }
  } catch (error) {
    failures++;
    console.error(`FAILED   ${target}: could not download ${url}: ${String(error)}`);
  }
}

if (failures > 0) {
  console.error(`${failures} of ${entries.length} pins did not check out.`);
  process.exit(1);
}
console.log(`All ${entries.length} pins match.`);
