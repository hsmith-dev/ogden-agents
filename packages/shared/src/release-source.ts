/**
 * Where "is there a newer Ogden Agents?" comes from (story 3, GitHub Releases).
 *
 * One small interface, `VersionSource`, so every reader of release information
 * shares its semantics: the install helper the start scripts run
 * (`packages/server/src/installer`), and the "a newer version is available"
 * notice (story 13.7, whose npm registry source implements the same interface
 * with no assets). It imports only `./semver.ts` and uses no Node or browser
 * API: the HTTP client is injected, so tests use a fake and never the network.
 *
 * Channels match npm's dist-tags (RELEASING.md): `stable` is `latest` (never a
 * prerelease); `next` is the highest version among all published releases.
 */
import { compareVersions } from './semver.js';

export type Channel = 'stable' | 'next';

/** One file attached to a release. `url` is the API URL that serves its bytes (works for private repositories with a token). */
export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

/** A published (never draft) release. `version` is the tag without its `v`. */
export interface ReleaseInfo {
  version: string;
  tag: string;
  prerelease: boolean;
  notes: string;
  htmlUrl: string;
  publishedAt: string | undefined;
  assets: ReleaseAsset[];
}

export interface VersionSource {
  /** `github-releases`, `npm`, ... for messages. */
  readonly name: string;
  /** The newest release on `channel`, or `undefined` when there is none. Rejects with `ReleaseSourceError`. */
  latest(channel: Channel): Promise<ReleaseInfo | undefined>;
}

export type ReleaseSourceErrorKind = 'not-found' | 'unauthorized' | 'rate-limited' | 'network' | 'bad-response';

export class ReleaseSourceError extends Error {
  readonly kind: ReleaseSourceErrorKind;
  readonly hadToken: boolean;
  constructor(kind: ReleaseSourceErrorKind, message: string, hadToken: boolean) {
    super(message);
    this.name = 'ReleaseSourceError';
    this.kind = kind;
    this.hadToken = hadToken;
  }
}

/**
 * The channel a version belongs to: a prerelease (`0.5.0-rc.1`) follows `next`.
 *
 * UNRESOLVED (2026-10-07): same bug as `channelOf` in `./semver.ts` — every continuous date-based
 * version has a mandatory `-N` suffix that isn't a pre-release marker, so this now reads every
 * released version as `next`. See RELEASING.md's "The stable/preview channel question" for the
 * investigation and the proposed options; not decided.
 */
export function channelFor(version: string): Channel {
  return /^v?\d+\.\d+\.\d+-/.test(version.trim()) ? 'next' : 'stable';
}

/** `candidate` is strictly newer than `current`. An unparseable version is never newer (never offered). */
export function isNewer(current: string, candidate: string): boolean {
  const order = compareVersions(candidate, current);
  return order !== undefined && order > 0;
}

/** The release `channel` should offer from published releases: stable skips prereleases; next takes the highest of all. */
export function pickRelease(releases: readonly ReleaseInfo[], channel: Channel): ReleaseInfo | undefined {
  let best: ReleaseInfo | undefined;
  for (const release of releases) {
    if (channel === 'stable' && release.prerelease) continue;
    if (compareVersions(release.version, release.version) === undefined) continue;
    if (best === undefined || (compareVersions(release.version, best.version) ?? 0) > 0) best = release;
  }
  return best;
}

/**
 * Parses `sha256sum` output (`<64 hex>  <name>`, or `<hex> *<name>` in binary
 * mode). Anything else on a line is an error, never skipped: a file the
 * installer trusts must not be half-understood.
 */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const match = /^([0-9a-fA-F]{64}) [ *]([^/\\\0]+)$/.exec(line);
    if (match === null) throw new Error(`SHA256SUMS.txt line ${index + 1} is not "<sha-256>  <file name>"`);
    const name = match[2] as string;
    const sum = (match[1] as string).toLowerCase();
    if (sums.has(name) && sums.get(name) !== sum) throw new Error(`SHA256SUMS.txt lists ${name} twice with different sums`);
    sums.set(name, sum);
  }
  return sums;
}

/** The release tarball's file name, as `pnpm pack` and `npm pack` name it. */
export const tarballName = (version: string): string => `ogden-agents-${version}.tgz`;
export const SUMS_NAME = 'SHA256SUMS.txt';

/** Replaces every occurrence of each secret (and any GitHub token shape) so a message can be shown or logged. */
export function maskSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= 4) out = out.split(secret).join('***');
  }
  return out.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***');
}

/** What the GitHub client needs from an HTTP response. Node's and the browser's `Response` satisfy it. */
export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'manual' }) => Promise<FetchResponseLike>;

export const DEFAULT_REPO = 'hsmith-dev/ogden-agents';
export const DEFAULT_API_BASE = 'https://api.github.com';
const REPO_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

/** `https://host:port` of an absolute http(s) URL, or `undefined`. (No `URL` global: this package is also type-checked for the browser-free contract.) */
const originOf = (url: string): string | undefined => /^(https?:\/\/[^/?#]+)/i.exec(url)?.[1]?.toLowerCase();

export interface GitHubReleasesOptions {
  /** `owner/name`; default `hsmith-dev/ogden-agents`. */
  repo?: string;
  fetch: FetchLike;
  /** Sent only to `apiBase`'s origin, as `Authorization: Bearer`. Never logged: errors are masked. */
  token?: string | undefined;
  /** For tests and GitHub Enterprise. */
  apiBase?: string;
  /** Releases to look through for the next channel; default 30 (GitHub's page size cap is 100). */
  perPage?: number;
}

/** True for a string that is a valid `owner/name` repository. */
export const isRepoName = (repo: string): boolean => REPO_PATTERN.test(repo);

export function createGitHubReleasesSource(options: GitHubReleasesOptions): VersionSource {
  const repo = options.repo ?? DEFAULT_REPO;
  if (!isRepoName(repo)) throw new Error(`"${repo}" is not a GitHub repository name like owner/name`);
  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const origin = originOf(apiBase);
  if (origin === undefined) throw new Error(`"${apiBase}" is not an http(s) URL`);
  const token = options.token === '' ? undefined : options.token;
  const hadToken = token !== undefined;
  const perPage = Math.min(Math.max(options.perPage ?? 30, 1), 100);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ogden-agents',
    ...(hadToken ? { Authorization: `Bearer ${token}` } : {}),
  };

  async function getJson(path: string): Promise<unknown> {
    let url = `${apiBase}${path}`;
    for (let hops = 0; hops < 4; hops++) {
      let response: FetchResponseLike;
      try {
        // Redirects are followed by hand and only within the API's own origin, so the token never goes anywhere else.
        response = await options.fetch(url, { headers, redirect: 'manual' });
      } catch (error) {
        throw new ReleaseSourceError('network', maskSecrets(`could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`, [token]), hadToken);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location === null ? undefined : location.startsWith('/') ? `${origin}${location}` : location;
        // A renamed repository redirects within the API; anything else is not followed.
        if (next === undefined || originOf(next) !== origin) throw new ReleaseSourceError('bad-response', `GitHub redirected ${path} somewhere unexpected`, hadToken);
        url = next;
        continue;
      }
      if (response.status === 404) throw new ReleaseSourceError('not-found', `GitHub has no ${path} (404)`, hadToken);
      if (response.status === 401) throw new ReleaseSourceError('unauthorized', 'GitHub refused the token (401)', hadToken);
      if (response.status === 403 || response.status === 429) {
        throw new ReleaseSourceError('rate-limited', `GitHub refused the request (${response.status}), most likely its rate limit`, hadToken);
      }
      if (response.status !== 200) throw new ReleaseSourceError('bad-response', `GitHub answered ${path} with ${response.status}`, hadToken);
      try {
        return await response.json();
      } catch {
        throw new ReleaseSourceError('bad-response', `GitHub's answer for ${path} was not JSON`, hadToken);
      }
    }
    throw new ReleaseSourceError('bad-response', `GitHub redirected ${path} too many times`, hadToken);
  }

  return {
    name: 'github-releases',
    async latest(channel) {
      if (channel === 'stable') {
        const body = await getJson(`/repos/${repo}/releases/latest`);
        return toRelease(body);
      }
      const body = await getJson(`/repos/${repo}/releases?per_page=${perPage}`);
      if (!Array.isArray(body)) throw new ReleaseSourceError('bad-response', 'GitHub\'s release list was not a list', hadToken);
      const releases = body.map(toRelease).filter((release): release is ReleaseInfo => release !== undefined);
      return pickRelease(releases, 'next');
    },
  };
}

/** One API release object to `ReleaseInfo`; `undefined` for a draft or a tag that is not `v<semver>`. */
export function toRelease(raw: unknown): ReleaseInfo | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.draft === true || typeof r.tag_name !== 'string') return undefined;
  const version = r.tag_name.replace(/^v/, '');
  if (compareVersions(version, version) === undefined || version.includes('+')) return undefined;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(r.assets)) {
    for (const asset of r.assets) {
      const a = asset as Record<string, unknown> | null;
      if (a !== null && typeof a === 'object' && typeof a.name === 'string' && typeof a.url === 'string' && typeof a.size === 'number') {
        assets.push({ name: a.name, url: a.url, size: a.size });
      }
    }
  }
  return {
    version,
    tag: r.tag_name,
    prerelease: r.prerelease === true,
    notes: typeof r.body === 'string' ? r.body : '',
    htmlUrl: typeof r.html_url === 'string' ? r.html_url : '',
    publishedAt: typeof r.published_at === 'string' ? r.published_at : undefined,
    assets,
  };
}
