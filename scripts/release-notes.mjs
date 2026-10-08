#!/usr/bin/env node
// Release notes for a GitHub Release, taken from CHANGELOG.md (story 3; date-based versioning,
// RELEASING.md).
//
//   node scripts/release-notes.mjs <version> [--repo owner/name] [--changelog CHANGELOG.md]
//
// Prints Markdown: the changelog section for the version, then how to install
// and verify the release's files. The section is the one whose heading starts
// `## <version>` exactly. Releases are continuous and date-stamped
// (`YYYY.M.D-N`): there is no more stable/prerelease split, so every version
// needs its own section, and a missing one is always an error — a release is
// never cut with empty notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The release version format (RELEASING.md): year, month and day as plain
 * integers with no leading zeros, and a mandatory sequence suffix that is
 * never omitted, even on a day's first release. `2026.10.7-1`, never
 * `2026.10.07-01` or `2026.10.7`. Keeping `-N` on every release, including
 * the first of a day, matters for correctness: under semver precedence a
 * bare version always outranks a suffixed one on the same core version
 * (confirmed against node's `semver` package), so a mix of bare and suffixed
 * versions on one date would sort wrong; always suffixing avoids that trap.
 */
export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(0|[1-9]\d*)$/;

/**
 * @param {string} changelog the CHANGELOG.md text
 * @param {string} version such as `2026.10.7-1`
 * @returns {{ body: string, heading: string } | undefined}
 */
export function extractSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (start === -1) return undefined;
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body === '' ? undefined : { body, heading: /** @type {string} */ (lines[start]).slice(3) };
}

/**
 * @param {string} changelog
 * @param {string} version
 * @param {string} repo `owner/name`
 */
export function releaseNotes(changelog, version, repo) {
  const section = extractSection(changelog, version);
  if (section === undefined) throw new Error(`CHANGELOG.md has no "## ${version}" section; add it before tagging v${version}.`);
  const url = `https://github.com/${repo}`;
  return [
    section.body,
    '',
    '---',
    '',
    `**Install or update from this release.** Download the start script for your computer (see [Start Ogden](${url}/blob/main/README.md#start-ogden)) together with \`ogden-install.mjs\`, keep them in the same folder, and run the script with \`--github\` (or set \`OGDEN_AGENTS_SOURCE=github\`). It downloads \`ogden-agents-${version}.tgz\`, checks it against \`SHA256SUMS.txt\` and installs it in your own user folder, keeping the previous version for rollback. For a private repository, sign in with \`gh auth login\` or set \`OGDEN_AGENTS_GITHUB_TOKEN\`. Details: [RELEASING.md](${url}/blob/main/RELEASING.md#installing-and-updating-from-github-releases).`,
    '',
    `**The desktop app.** Download the one for your computer from the files below: \`Ogden-Agents_${version}_universal.dmg\` (macOS), \`Ogden-Agents_${version}_x64-setup.exe\` or \`Ogden-Agents_${version}_arm64-setup.exe\` (Windows), \`Ogden-Agents_${version}_amd64.AppImage\` or \`Ogden-Agents_${version}_aarch64.AppImage\` (Linux; a \`.deb\` is there too). They are not signed yet, so your computer warns the first time you open one: [how to open it](${url}/blob/main/README.md#download). \`SHA256SUMS-desktop.txt\` lists their checksums.`,
    '',
    '`SHA256SUMS.txt` lists the SHA-256 of every file attached here. Verify a download yourself with `sha256sum -c SHA256SUMS.txt --ignore-missing` (macOS: `shasum -a 256 -c`).',
    '',
  ].join('\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : (args[index + 1] ?? fallback);
  };
  const version = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
  if (version === undefined || !VERSION_PATTERN.test(version)) {
    console.error('usage: node scripts/release-notes.mjs <version> [--repo owner/name] [--changelog file]');
    console.error('<version> must be YYYY.M.D-N: plain integers with no leading zeros and a mandatory -N, e.g. 2026.10.7-1 (RELEASING.md)');
    process.exit(2);
  }
  try {
    const changelog = readFileSync(flag('--changelog', fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))), 'utf8');
    process.stdout.write(releaseNotes(changelog, version, flag('--repo', 'hsmith-dev/ogden-agents')));
  } catch (error) {
    console.error(`release-notes: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
