// Downloading one pinned Node archive and refusing a wrong one (story 13.4, AD-23). Split out of
// stage.mjs so a test can feed it a local server and a tampered file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where official Node builds come from. A build-time override (`OGDEN_DESKTOP_NODE_BASE`) exists for tests only. */
export const NODE_DIST_BASE = 'https://nodejs.org/dist';

export class PinMismatchError extends Error {
  /**
   * @param {string} name
   * @param {string} actual
   * @param {string} pinned
   */
  constructor(name, actual, pinned) {
    super(`SHA-256 mismatch for ${name}: got ${actual}, the pin says ${pinned}. The archive was refused and not used.`);
    this.name = 'PinMismatchError';
  }
}

/**
 * @param {string} url
 * @param {string} file
 * @param {number} [attempts]
 */
async function download(url, file, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`download ${url} failed (${error}); retrying`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/**
 * The pinned archive for `plat` in `cache`, downloaded if missing and checked against its SHA-256
 * either way (a cached file is never trusted unchecked). A mismatch deletes the file and throws.
 * @param {{ plat: string, cache: string, pins: { version: string, archives: Record<string, { ext: string, sha256: string }> }, base?: string }} options
 * @returns {Promise<{ file: string, name: string, ext: string, sha256: string }>}
 */
export async function verifiedArchive({ plat, cache, pins, base = process.env.OGDEN_DESKTOP_NODE_BASE ?? NODE_DIST_BASE }) {
  const pin = pins.archives[plat];
  if (pin === undefined) throw new Error(`no Node pin for ${plat}`);
  const name = `node-v${pins.version}-${plat}`;
  const file = join(cache, `${name}.${pin.ext}`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(file)) await download(`${base.replace(/\/+$/, '')}/v${pins.version}/${name}.${pin.ext}`, file);
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== pin.sha256) {
    rmSync(file, { force: true });
    throw new PinMismatchError(`${name}.${pin.ext}`, actual, pin.sha256);
  }
  return { file, name, ext: pin.ext, sha256: pin.sha256 };
}
