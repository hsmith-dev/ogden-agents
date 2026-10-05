#!/usr/bin/env node
/**
 * The desktop app's Node pins (story 13.3, AD-23): `packages/desktop/desktop-node-pins.json` names
 * the official Node version the app bundles and the SHA-256 of its archive for each OS and
 * architecture. The build (`packages/desktop/scripts/stage.mjs`) refuses a download that does not
 * match; this script checks the pins themselves.
 *
 *   node scripts/desktop-pins.mjs --check            compare every pin with nodejs.org's SHASUMS256.txt (CI job)
 *   node scripts/desktop-pins.mjs --check --download also re-download each archive and hash it (slow)
 *
 * Exits 0 when every pin matches, 1 otherwise. To bump Node, change `version` and the hashes, then run this.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256WithRetry } from './download-sha256.mjs';

const PINS_FILE = fileURLToPath(new URL('../packages/desktop/desktop-node-pins.json', import.meta.url));
/** The targets the app builds for. Linux stays pinned so it can return without a pins change. */
export const REQUIRED_PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win-arm64', 'win-x64', 'linux-arm64', 'linux-x64'];

/** @typedef {{ version: string, archives: Record<string, { ext: string, sha256: string }> }} Pins */

/**
 * The archive names a Node release lists and their hashes (`<sha256>  <file>` per line).
 * @param {string} text SHASUMS256.txt
 * @returns {Map<string, string>}
 */
export function parseShasums(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match !== null) out.set(match[2], match[1]);
  }
  return out;
}

/** The archive file name a pin stands for. */
export const archiveName = (/** @type {string} */ version, /** @type {string} */ platform, /** @type {string} */ ext) => `node-v${version}-${platform}.${ext}`;

/**
 * What is wrong with the pins, checked against the release's published hashes. Empty when they hold.
 * @param {Pins} pins
 * @param {Map<string, string>} published
 * @returns {string[]}
 */
export function pinProblems(pins, published) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(pins.version)) problems.push(`version "${pins.version}" is not a plain x.y.z`);
  for (const platform of REQUIRED_PLATFORMS) {
    const pin = pins.archives[platform];
    if (pin === undefined) {
      problems.push(`no pin for ${platform}`);
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(pin.sha256)) {
      problems.push(`${platform}: the hash is not 64 lowercase hex characters`);
      continue;
    }
    const name = archiveName(pins.version, platform, pin.ext);
    const actual = published.get(name);
    if (actual === undefined) problems.push(`${platform}: nodejs.org lists no ${name}`);
    else if (actual !== pin.sha256) problems.push(`${platform}: pinned ${pin.sha256} but nodejs.org says ${actual} for ${name}`);
  }
  return problems;
}

async function main() {
  const pins = /** @type {Pins} */ (JSON.parse(readFileSync(PINS_FILE, 'utf8')));
  const base = `https://nodejs.org/dist/v${pins.version}`;
  const response = await fetch(`${base}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`nodejs.org answered ${response.status} for SHASUMS256.txt`);
  const problems = pinProblems(pins, parseShasums(await response.text()));
  if (process.argv.includes('--download')) {
    for (const [platform, pin] of Object.entries(pins.archives)) {
      const actual = await sha256WithRetry(`${base}/${archiveName(pins.version, platform, pin.ext)}`);
      if (actual.sha256 !== pin.sha256) problems.push(`${platform}: the downloaded archive hashes to ${actual.sha256}, not ${pin.sha256}`);
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`MISMATCH ${problem}`);
    process.exit(1);
  }
  console.log(`All ${REQUIRED_PLATFORMS.length} Node ${pins.version} pins match nodejs.org.`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--check')) {
    console.error('usage: node scripts/desktop-pins.mjs --check [--download]');
    process.exit(2);
  }
  await main().catch((error) => {
    console.error(`FAILED ${String(error)}`);
    process.exit(1);
  });
}
