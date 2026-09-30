/**
 * The pinned `uv` release (story 1.8): its version, the minimum version a
 * `uv` already on this computer must have, and the SHA-256 of every archive
 * Ogden Agents may install. Archives are checked against these pins, never
 * against the release's own `.sha256` files, so an altered release asset is
 * refused. `scripts/check-uv-pins.mjs` re-downloads each archive in CI.
 */
import pinned from './uv-release.json' with { type: 'json' };

/** Every OS and CPU pair with a pinned archive, named as uv's releases name them. */
export const UV_TARGETS = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'aarch64-unknown-linux-gnu',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-musl',
  'x86_64-unknown-linux-musl',
  'aarch64-pc-windows-msvc',
  'x86_64-pc-windows-msvc',
] as const;
export type UvTarget = (typeof UV_TARGETS)[number];

export interface UvArchive {
  /** `uv-<target>.tar.gz`, or `.zip` on Windows. */
  file: string;
  /** Exact size in bytes; a download is stopped as soon as it grows past this. */
  size: number;
  /** Lowercase hex SHA-256 of the whole archive. */
  sha256: string;
}

export interface UvRelease {
  version: string;
  minimumVersion: string;
  /** Downloads are `<baseUrl>/<version>/<file>`. */
  baseUrl: string;
  archives: Partial<Record<UvTarget, UvArchive>>;
}

export const UV_RELEASE: UvRelease = pinned;

/** `<baseUrl>/<version>/<file>`. */
export function archiveUrl(release: UvRelease, archive: UvArchive, baseUrl = release.baseUrl): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(release.version)}/${encodeURIComponent(archive.file)}`;
}

export type Libc = 'gnu' | 'musl';

export interface Platform {
  /** `process.platform`. */
  os: string;
  /** `process.arch`. */
  cpu: string;
  /** Only read on Linux. */
  libc: () => Libc;
}

const OS_NAMES: Readonly<Record<string, string>> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
const CPU_NAMES: Readonly<Record<string, string>> = { arm64: 'ARM', x64: 'Intel or AMD' };

/**
 * The uv target for this OS and CPU, or a plain explanation of why there is
 * none. Linux picks glibc or musl by the C library this Node runs on.
 */
export function selectTarget(platform: Platform): { target: UvTarget } | { unsupported: string } {
  const cpu = platform.cpu === 'arm64' ? 'aarch64' : platform.cpu === 'x64' ? 'x86_64' : undefined;
  let os: string | undefined;
  if (platform.os === 'darwin') os = 'apple-darwin';
  else if (platform.os === 'win32') os = 'pc-windows-msvc';
  else if (platform.os === 'linux') os = `unknown-linux-${platform.libc()}`;
  const target = cpu === undefined || os === undefined ? undefined : `${cpu}-${os}`;
  if (target !== undefined && (UV_TARGETS as readonly string[]).includes(target)) return { target: target as UvTarget };
  const osName = OS_NAMES[platform.os] ?? platform.os;
  const cpuName = CPU_NAMES[platform.cpu] ?? platform.cpu;
  return {
    unsupported: `Ogden Agents can't install uv on this computer: there is no uv download for ${osName} on ${cpuName} processors.`,
  };
}

/**
 * glibc or musl, the way Node reports it: a glibc build of Node reports the
 * glibc version it runs on; on musl (such as Alpine) there is none.
 */
export function detectLibc(): Libc {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: unknown } } | undefined;
    return typeof report?.header?.glibcVersionRuntime === 'string' ? 'gnu' : 'musl';
  } catch {
    return 'gnu';
  }
}

/** `[major, minor, patch]` from `0.12.21` or `uv 0.12.21 (…)`, or `undefined`. */
export function parseVersion(text: string): [number, number, number] | undefined {
  const match = /(?:^|\buv\s+)(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** `0.12.0` as users say it: `0.12`. */
export function shortVersion(version: string): string {
  return version.replace(/\.0$/, '');
}
