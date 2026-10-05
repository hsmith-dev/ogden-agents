import { describe, expect, it } from 'vitest';
import {
  channelFor,
  createGitHubReleasesSource,
  isNewer,
  maskSecrets,
  parseSha256Sums,
  pickRelease,
  ReleaseSourceError,
  toRelease,
  type FetchLike,
  type ReleaseInfo,
} from '../src/release-source.js';

const release = (version: string, prerelease = false): ReleaseInfo => ({ version, tag: `v${version}`, prerelease, notes: '', htmlUrl: '', publishedAt: undefined, assets: [] });
const apiRelease = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  prerelease: tag.includes('-'),
  draft: false,
  body: `notes ${tag}`,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  assets: [{ name: `ogden-agents-${tag.slice(1)}.tgz`, url: `https://api.github.com/repos/o/r/releases/assets/1`, size: 10 }],
  ...extra,
});

/** A fake GitHub: routes by path, records every request. */
function fakeGitHub(routes: Record<string, { status?: number; body?: unknown; location?: string }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const route = routes[url.replace(/^https?:\/\/[^/]+/, '')];
    if (route === undefined) return { status: 404, headers: { get: () => null }, json: async () => ({}) };
    return {
      status: route.status ?? 200,
      headers: { get: (name) => (name.toLowerCase() === 'location' ? (route.location ?? null) : null) },
      json: async () => route.body,
    };
  };
  return { fetch, calls };
}

describe('channels and order', () => {
  it('a prerelease follows next, a stable version follows stable', () => {
    expect(channelFor('0.5.0-rc.1')).toBe('next');
    expect(channelFor('v0.5.0')).toBe('stable');
  });

  it('never offers an equal, older or unparseable version', () => {
    expect(isNewer('0.4.0', '0.4.1')).toBe(true);
    expect(isNewer('0.4.0-rc.1', '0.4.0')).toBe(true);
    expect(isNewer('0.4.0', '0.4.0')).toBe(false);
    expect(isNewer('0.5.0', '0.4.9')).toBe(false);
    expect(isNewer('0.4.0', 'nightly')).toBe(false);
  });

  it('stable skips prereleases, next takes the highest of all', () => {
    const all = [release('0.4.0'), release('0.5.0-rc.1', true), release('0.4.1'), release('0.5.0-rc.2', true)];
    expect(pickRelease(all, 'stable')?.version).toBe('0.4.1');
    expect(pickRelease(all, 'next')?.version).toBe('0.5.0-rc.2');
    expect(pickRelease([release('0.5.0-rc.1', true)], 'stable')).toBeUndefined();
  });
});

describe('parseSha256Sums', () => {
  const hex = 'a'.repeat(64);
  it('reads sha256sum output, text and binary mode', () => {
    expect(parseSha256Sums(`${hex}  one.tgz\n${hex.toUpperCase()} *two.zip\n\n`)).toEqual(new Map([['one.tgz', hex], ['two.zip', hex]]));
  });
  it('refuses a line it does not understand, a path, and a conflicting duplicate', () => {
    expect(() => parseSha256Sums(`${hex}  ok\nnot a sum\n`)).toThrow('line 2');
    expect(() => parseSha256Sums(`${hex}  ../evil.tgz\n`)).toThrow('line 1');
    expect(() => parseSha256Sums(`${hex}  a\n${'b'.repeat(64)}  a\n`)).toThrow('twice');
  });
});

describe('maskSecrets', () => {
  it('masks the given secret and token-shaped strings', () => {
    expect(maskSecrets('failed with secret-value here', ['secret-value'])).toBe('failed with *** here');
    expect(maskSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123 leaked')).toBe('token *** leaked');
  });
});

describe('toRelease', () => {
  it('skips drafts and tags that are not versions', () => {
    expect(toRelease(apiRelease('v1.0.0', { draft: true }))).toBeUndefined();
    expect(toRelease(apiRelease('nightly'))).toBeUndefined();
    expect(toRelease(apiRelease('v1.0.0'))?.assets).toHaveLength(1);
  });
});

describe('GitHub releases source', () => {
  it('stable asks releases/latest, with the token only when given', async () => {
    const gh = fakeGitHub({ '/repos/o/r/releases/latest': { body: apiRelease('v0.4.1') } });
    const source = createGitHubReleasesSource({ repo: 'o/r', fetch: gh.fetch, token: 'tok-1234' });
    expect((await source.latest('stable'))?.version).toBe('0.4.1');
    expect(gh.calls[0]?.headers.Authorization).toBe('Bearer tok-1234');
    const anon = fakeGitHub({ '/repos/o/r/releases/latest': { body: apiRelease('v0.4.1') } });
    await createGitHubReleasesSource({ repo: 'o/r', fetch: anon.fetch }).latest('stable');
    expect(anon.calls[0]?.headers).not.toHaveProperty('Authorization');
  });

  it('next lists releases and takes the highest, including prereleases', async () => {
    const gh = fakeGitHub({ '/repos/o/r/releases?per_page=30': { body: [apiRelease('v0.4.0'), apiRelease('v0.5.0-rc.1'), apiRelease('v0.4.9', { draft: true })] } });
    expect((await createGitHubReleasesSource({ repo: 'o/r', fetch: gh.fetch }).latest('next'))?.version).toBe('0.5.0-rc.1');
  });

  it('says what went wrong: 404, 401, rate limit, network, and never leaks the token', async () => {
    const notFound = createGitHubReleasesSource({ repo: 'o/r', fetch: fakeGitHub({}).fetch });
    await expect(notFound.latest('stable')).rejects.toMatchObject({ kind: 'not-found', hadToken: false });
    const denied = createGitHubReleasesSource({ repo: 'o/r', fetch: fakeGitHub({ '/repos/o/r/releases/latest': { status: 401 } }).fetch, token: 'tok-1234' });
    await expect(denied.latest('stable')).rejects.toMatchObject({ kind: 'unauthorized', hadToken: true });
    const limited = createGitHubReleasesSource({ repo: 'o/r', fetch: fakeGitHub({ '/repos/o/r/releases/latest': { status: 403 } }).fetch });
    await expect(limited.latest('stable')).rejects.toMatchObject({ kind: 'rate-limited' });
    const offline = createGitHubReleasesSource({
      repo: 'o/r',
      token: 'tok-1234',
      fetch: async () => {
        throw new Error('getaddrinfo failed for tok-1234');
      },
    });
    const error = (await offline.latest('stable').catch((e: unknown) => e)) as ReleaseSourceError;
    expect(error.kind).toBe('network');
    expect(error.message).not.toContain('tok-1234');
  });

  it('follows a redirect inside the API and refuses one that leaves it', async () => {
    const inside = fakeGitHub({
      '/repos/o/r/releases/latest': { status: 301, location: 'https://api.github.com/repositories/9/releases/latest' },
      '/repositories/9/releases/latest': { body: apiRelease('v1.0.0') },
    });
    expect((await createGitHubReleasesSource({ repo: 'o/r', fetch: inside.fetch, token: 'tok-1234' }).latest('stable'))?.version).toBe('1.0.0');
    const outside = fakeGitHub({ '/repos/o/r/releases/latest': { status: 302, location: 'https://evil.example/steal' } });
    await expect(createGitHubReleasesSource({ repo: 'o/r', fetch: outside.fetch, token: 'tok-1234' }).latest('stable')).rejects.toMatchObject({ kind: 'bad-response' });
    expect(outside.calls).toHaveLength(1);
  });

  it('refuses a repository name that is not owner/name', () => {
    expect(() => createGitHubReleasesSource({ repo: '../x', fetch: fakeGitHub({}).fetch })).toThrow('owner/name');
  });
});
