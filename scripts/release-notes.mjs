#!/usr/bin/env node
// Release notes for a GitHub Release, taken from CHANGELOG.md (story 3).
//
//   node scripts/release-notes.mjs <version> [--repo owner/name] [--changelog CHANGELOG.md]
//
// Prints Markdown: the changelog section for the version, then how to install
// and verify the release's files. The section is the one whose heading starts
// `## <version>`. A prerelease (`0.5.0-rc.1`) with no section of its own uses
// its release's (`## 0.5.0`), then `## Unreleased`; a stable version with no
// section is an error, so a release is never cut with empty notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} changelog the CHANGELOG.md text
 * @param {string} version such as `0.4.0` or `0.5.0-rc.1`
 * @returns {{ body: string, heading: string } | undefined}
 */
export function extractSection(changelog, version) {
  const base = version.replace(/-.*$/, '');
  const candidates = version === base ? [version] : [version, base, 'Unreleased'];
  const lines = changelog.split(/\r?\n/);
  for (const name of candidates) {
    const start = lines.findIndex((line) => line === `## ${name}` || line.startsWith(`## ${name} `) || line.startsWith(`## ${name} `));
    if (start === -1) continue;
    let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    if (end === -1) end = lines.length;
    const body = lines.slice(start + 1, end).join('\n').trim();
    if (body !== '') return { body, heading: /** @type {string} */ (lines[start]).slice(3) };
  }
  return undefined;
}

/**
 * @param {string} changelog
 * @param {string} version
 * @param {string} repo `owner/name`
 */
export function releaseNotes(changelog, version, repo) {
  const section = extractSection(changelog, version);
  if (section === undefined) {
    if (!version.includes('-')) throw new Error(`CHANGELOG.md has no "## ${version}" section; add it before tagging v${version}.`);
  }
  const url = `https://github.com/${repo}`;
  const channel = version.includes('-') ? ' This is a prerelease: it is only offered to people on the `next` channel.' : '';
  return [
    section === undefined ? `Release notes: [CHANGELOG.md](${url}/blob/main/CHANGELOG.md).` : section.body,
    '',
    '---',
    '',
    `**Install or update from this release.**${channel} Download the start script for your computer (see [Start Ogden](${url}/blob/main/README.md#start-ogden)) together with \`ogden-install.mjs\`, keep them in the same folder, and run the script with \`--github\` (or set \`OGDEN_AGENTS_SOURCE=github\`). It downloads \`ogden-agents-${version}.tgz\`, checks it against \`SHA256SUMS.txt\` and installs it in your own user folder, keeping the previous version for rollback. For a private repository, sign in with \`gh auth login\` or set \`OGDEN_AGENTS_GITHUB_TOKEN\`. Details: [RELEASING.md](${url}/blob/main/RELEASING.md#installing-and-updating-from-github-releases).`,
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
  if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error('usage: node scripts/release-notes.mjs <version> [--repo owner/name] [--changelog file]');
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
