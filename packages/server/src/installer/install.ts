/**
 * Installs one release's tarball into the app folder (story 3).
 *
 * Order, and why: download the checksum list and the tarball; compare the
 * tarball's SHA-256 with its line in `SHA256SUMS.txt` (a missing list, a
 * missing line or a mismatch stops here, and there is no option that skips it);
 * only then let npm install the file into a temporary prefix (npm extracts it:
 * this program has no tar code, so no path in an archive is ever written by
 * it); check that what was installed is the version the release says; move it
 * into place; keep the previous version; remove the rest.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSha256Sums, SUMS_NAME, tarballName, type ReleaseInfo } from '@ogden-agents/shared/release-source';
import { downloadText, downloadToFile, type DownloadOptions } from './download.js';
import { isSafeVersion, launcherPath, packageDir, pruneVersions, readState, versionDir, writeState } from './state.js';

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallError';
  }
}

export interface InstallDeps {
  download: Pick<DownloadOptions, 'fetch' | 'token' | 'apiOrigin' | 'extraAllowedHosts'>;
  /** Runs `npm install <tarball>` with `prefix` as the prefix; rejects with npm's output on failure. */
  npmInstall(prefix: string, tarball: string): Promise<void>;
  log(line: string): void;
}

const MAX_TARBALL_BYTES = 300 * 1024 * 1024;
const MAX_SUMS_BYTES = 1024 * 1024;

export async function installRelease(appDir: string, release: ReleaseInfo, deps: InstallDeps): Promise<void> {
  if (!isSafeVersion(release.version)) throw new InstallError(`release ${release.tag} is not a plain version number, so it will not be installed`);
  const tarName = tarballName(release.version);
  const tarAsset = release.assets.find((asset) => asset.name === tarName);
  const sumsAsset = release.assets.find((asset) => asset.name === SUMS_NAME);
  if (tarAsset === undefined) throw new InstallError(`release ${release.tag} has no ${tarName}, so there is nothing to install`);
  if (sumsAsset === undefined) throw new InstallError(`release ${release.tag} has no ${SUMS_NAME}; Ogden Agents installs only what it can verify, so it will not install ${tarName}`);

  const work = join(appDir, 'downloads', `${release.version}-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    deps.log(`Downloading ${SUMS_NAME} for ${release.tag}...`);
    const sums = parseSha256Sums(await downloadText({ ...deps.download, url: sumsAsset.url, maxBytes: MAX_SUMS_BYTES }));
    const expected = sums.get(tarName);
    if (expected === undefined) throw new InstallError(`${SUMS_NAME} does not list ${tarName}, so it cannot be verified and will not be installed`);

    deps.log(`Downloading ${tarName} (${(tarAsset.size / 1024 / 1024).toFixed(1)} MB)...`);
    const tarFile = join(work, tarName);
    const { sha256, bytes } = await downloadToFile({ ...deps.download, url: tarAsset.url, maxBytes: MAX_TARBALL_BYTES }, tarFile);
    if (sha256 !== expected) {
      rmSync(tarFile, { force: true });
      throw new InstallError(`${tarName} does not match its checksum (expected ${expected}, got ${sha256}); nothing was installed. Try again, and if it keeps happening do not use this release.`);
    }
    if (tarAsset.size > 0 && bytes !== tarAsset.size) throw new InstallError(`${tarName} is ${bytes} bytes but the release lists ${tarAsset.size}; nothing was installed`);
    deps.log(`Checksum verified (SHA-256 ${sha256.slice(0, 12)}...). Installing...`);

    const staging = join(appDir, 'versions', `.installing-${release.version}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    try {
      writeFileSync(join(staging, 'package.json'), `${JSON.stringify({ name: 'ogden-agents-install', private: true, version: '0.0.0' })}\n`);
      await deps.npmInstall(staging, tarFile);
      const installed = JSON.parse(readFileSync(join(staging, 'node_modules', 'ogden-agents', 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
      if (installed.name !== 'ogden-agents' || installed.version !== release.version) {
        throw new InstallError(`the installed package is ${String(installed.name)}@${String(installed.version)}, not ogden-agents@${release.version}; nothing was installed`);
      }
      if (!existsSync(join(staging, 'node_modules', 'ogden-agents', 'bin', 'ogden.js'))) throw new InstallError('the installed package has no launcher; nothing was installed');
      const final = versionDir(appDir, release.version);
      rmSync(final, { recursive: true, force: true });
      renameSync(staging, final);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const before = readState(appDir);
  const previous = before.current !== undefined && before.current !== release.version ? before.current : before.previous;
  writeState(appDir, { current: release.version, previous, skip: undefined });
  pruneVersions(appDir, new Set([release.version, ...(previous === undefined ? [] : [previous])]), (dir) => readdirSync(dir));
  deps.log(`Installed Ogden Agents ${release.version}.${previous === undefined ? '' : ` The previous version, ${previous}, is kept for rollback.`}`);
}

/** Switches `current` and `previous`. Returns the version now current, or undefined when there is no previous version. */
export function rollback(appDir: string): { now: string; from: string } | undefined {
  const state = readState(appDir);
  if (state.current === undefined || state.previous === undefined) return undefined;
  if (!existsSync(packageDir(appDir, state.previous))) return undefined;
  writeState(appDir, { current: state.previous, previous: state.current, skip: state.current });
  return { now: state.previous, from: state.current };
}

export { launcherPath };
