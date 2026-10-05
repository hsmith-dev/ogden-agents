#!/usr/bin/env node
// The desktop part of a GitHub Release (story 13.9, E13-R8, AD-23): takes the build artifacts of
// every leg, gives them space-free names (GitHub turns spaces into dots), and writes
// `SHA256SUMS-desktop.txt` and, when the builds were signed with the updater key, `latest.json`
// for the Tauri updater.
//
//   node packages/desktop/scripts/release-manifest.mjs --in <downloaded artifacts> --out <folder>
//        --version 0.5.0 --tag v0.5.0 --repo hsmith-dev/ogden-agents [--notes-file notes.md] [--unsigned]
//
// `--unsigned` is for a release built without the user's updater key: installers only, no
// `latest.json` (so no app ever updates to it), and nothing claims otherwise.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * What each leg's files are called in a release, and which updater platforms a file serves.
 * @type {Array<{ test: (name: string) => boolean, name: (version: string) => string, platforms: string[] }>}
 */
const FILE_RULES = [
  { test: (n) => /^Ogden Agents_.+_universal\.dmg$/.test(n), name: (v) => `Ogden-Agents_${v}_universal.dmg`, platforms: [] },
  { test: (n) => n === 'Ogden Agents.app.tar.gz', name: (v) => `Ogden-Agents_${v}_universal.app.tar.gz`, platforms: ['darwin-aarch64', 'darwin-x86_64'] },
  { test: (n) => /^Ogden Agents_.+_x64-setup\.exe$/.test(n), name: (v) => `Ogden-Agents_${v}_x64-setup.exe`, platforms: ['windows-x86_64'] },
  { test: (n) => /^Ogden Agents_.+_arm64-setup\.exe$/.test(n), name: (v) => `Ogden-Agents_${v}_arm64-setup.exe`, platforms: ['windows-aarch64'] },
];

/**
 * Every file below `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * @typedef {{ source: string, name: string, platforms: string[], sigSource: string | undefined, signature?: string }} Artifact
 */

/**
 * The files a release carries, found under `inDir`: each installer or update artifact (by its
 * Tauri name), its `.sig` beside it, and the name it gets in the release.
 * @param {string} inDir
 * @param {string} version
 * @returns {Artifact[]}
 */
export function collectArtifacts(inDir, version) {
  const files = walk(inDir);
  /** @type {Artifact[]} */
  const found = [];
  for (const rule of FILE_RULES) {
    const matches = files.filter((f) => rule.test(basename(f)));
    if (matches.length !== 1) throw new Error(`expected exactly one file for ${rule.name(version)}, found ${matches.length}`);
    const source = /** @type {string} */ (matches[0]);
    const sig = `${source}.sig`;
    found.push({ source, name: rule.name(version), platforms: rule.platforms, sigSource: existsSync(sig) ? sig : undefined });
  }
  return found;
}

/**
 * The updater's `latest.json`: the version, the notes, the time and, for each platform it can
 * update, the signature (the contents of the `.sig`) and where the file is on the release.
 * @param {{ version: string, notes: string, pubDate: string, repo: string, tag: string, artifacts: Artifact[] }} input
 */
export function buildLatestJson({ version, notes, pubDate, repo, tag, artifacts }) {
  /** @type {Record<string, { signature: string, url: string }>} */
  const platforms = {};
  for (const artifact of artifacts) {
    if (artifact.platforms.length === 0) continue;
    if (artifact.signature === undefined || artifact.signature.trim() === '') throw new Error(`${artifact.name} has no signature, so it cannot be offered as an update`);
    for (const platform of artifact.platforms) {
      platforms[platform] = { signature: artifact.signature.trim(), url: `https://github.com/${repo}/releases/download/${tag}/${artifact.name}` };
    }
  }
  return { version, notes, pub_date: pubDate, platforms };
}

/**
 * `<sha256>  <name>` lines, as `sha256sum -c` reads them.
 * @param {Array<{ name: string, bytes: Buffer }>} files
 */
export function sha256sums(files) {
  return `${files.map(({ name, bytes }) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}`).join('\n')}\n`;
}

function main() {
  const { values } = parseArgs({
    options: { in: { type: 'string' }, out: { type: 'string' }, version: { type: 'string' }, tag: { type: 'string' }, repo: { type: 'string' }, 'notes-file': { type: 'string' }, unsigned: { type: 'boolean', default: false } },
    strict: true,
  });
  const { version, tag, repo } = values;
  if (!values.in || !values.out || !version || !tag || !repo) {
    console.error('usage: release-manifest.mjs --in <dir> --out <dir> --version <v> --tag <tag> --repo <owner/name> [--notes-file f] [--unsigned]');
    process.exit(2);
  }
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  const artifacts = collectArtifacts(resolve(values.in), version);
  /** @type {Array<{ name: string, bytes: Buffer }>} */
  const attached = [];
  for (const artifact of artifacts) {
    copyFileSync(artifact.source, join(out, artifact.name));
    attached.push({ name: artifact.name, bytes: readFileSync(artifact.source) });
    if (artifact.sigSource !== undefined) {
      copyFileSync(artifact.sigSource, join(out, `${artifact.name}.sig`));
      attached.push({ name: `${artifact.name}.sig`, bytes: readFileSync(artifact.sigSource) });
      artifact.signature = readFileSync(artifact.sigSource, 'utf8');
    }
  }
  if (!values.unsigned) {
    const notes = values['notes-file'] ? readFileSync(values['notes-file'], 'utf8').trim().slice(0, 4000) : '';
    const manifest = buildLatestJson({ version, notes, pubDate: new Date().toISOString(), repo, tag, artifacts });
    writeFileSync(join(out, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } else console.log('unsigned release: no latest.json, so no installed app is offered this version');
  writeFileSync(join(out, 'SHA256SUMS-desktop.txt'), sha256sums(attached));
  for (const name of readdirSync(out)) console.log(`${name}  ${Math.round(statSync(join(out, name)).size / 1024)} KB`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`release-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
