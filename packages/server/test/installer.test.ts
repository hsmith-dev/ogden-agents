/**
 * The GitHub Releases installer (story 3): `run` from `src/installer/cli.ts`
 * with a fake GitHub (no network: every request is answered in-process) and
 * real fixture tarballs made with `npm pack`, installed by the real npm from a
 * local file (the fixture package has no dependencies, so npm needs no registry).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, type CliDeps } from '../src/installer/cli.js';
import { findNpmCli } from '../src/installer/npm.js';

const API = 'https://api.github.com';
const CDN = 'https://release-assets.githubusercontent.com';
const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwx';

let root: string;
const tarballs = new Map<string, Buffer>();

/** `npm pack` of a one-file package named ogden-agents at `version`, no dependencies. */
function makeTarball(version: string): Buffer {
  const cached = tarballs.get(version);
  if (cached !== undefined) return cached;
  const dir = join(root, `pkg-${version}`);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ogden-agents', version, bin: { ogden: 'bin/ogden.js' }, files: ['bin'] }));
  writeFileSync(join(dir, 'bin', 'ogden.js'), `console.log('fixture ${version}');\n`);
  const cli = findNpmCli();
  if (cli === undefined) throw new Error('npm not found beside this Node');
  const out = spawnSync(process.execPath, [cli, 'pack', '--pack-destination', root, '--loglevel=error'], { cwd: dir, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' } });
  if (out.status !== 0) throw new Error(`npm pack failed: ${out.stderr}`);
  const buffer = readFileSync(join(root, `ogden-agents-${version}.tgz`));
  tarballs.set(version, buffer);
  return buffer;
}

const sha = (buffer: Buffer | string) => createHash('sha256').update(buffer).digest('hex');

interface FakeRelease {
  version: string;
  prerelease?: boolean;
  /** Override the checksum list's line for the tarball. */
  sum?: string;
  omitSums?: boolean;
  omitSumsLine?: boolean;
  /** Serve the tarball bytes from here (a hostile redirect target). */
  redirectTo?: string;
}

/** A fake GitHub: the API, release assets with a 302 to a CDN host, and a log of every request. */
function fakeGitHub(releases: FakeRelease[], { privateRepo = false }: { privateRepo?: boolean } = {}) {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const assets = new Map<number, { bytes: Buffer | string; release: FakeRelease }>();
  const apiReleases = releases.map((release, index) => {
    const tar = makeTarball(release.version);
    const tarId = index * 10 + 1;
    const sumsId = index * 10 + 2;
    const sumsText = release.omitSumsLine ? `${'0'.repeat(64)}  other.zip\n` : `${release.sum ?? sha(tar)}  ogden-agents-${release.version}.tgz\n`;
    assets.set(tarId, { bytes: tar, release });
    assets.set(sumsId, { bytes: sumsText, release });
    return {
      tag_name: `v${release.version}`,
      prerelease: release.prerelease ?? false,
      draft: false,
      body: 'notes',
      html_url: `https://github.com/o/r/releases/tag/v${release.version}`,
      assets: [
        { name: `ogden-agents-${release.version}.tgz`, url: `${API}/repos/o/r/releases/assets/${tarId}`, size: tar.length },
        ...(release.omitSums ? [] : [{ name: 'SHA256SUMS.txt', url: `${API}/repos/o/r/releases/assets/${sumsId}`, size: Buffer.byteLength(sumsText) }]),
      ],
    };
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization');
    requests.push({ url, authorization });
    if (privateRepo && url.startsWith(API) && authorization !== `Bearer ${TOKEN}`) return json({ message: 'Not Found' }, 404);
    if (url.startsWith(`${CDN}/`)) {
      const asset = assets.get(Number(url.slice(CDN.length + 1)));
      return asset === undefined ? json({}, 404) : new Response(asset.bytes, { status: 200 });
    }
    const path = url.slice(API.length);
    if (path === '/repos/o/r/releases/latest') {
      const stable = apiReleases.filter((r) => !r.prerelease);
      return stable.length === 0 ? json({}, 404) : json(stable[stable.length - 1]);
    }
    if (path.startsWith('/repos/o/r/releases?')) return json([...apiReleases].reverse());
    const asset = /^\/repos\/o\/r\/releases\/assets\/(\d+)$/.exec(path);
    if (asset !== null) {
      const found = assets.get(Number(asset[1]));
      if (found === undefined) return json({}, 404);
      return new Response(null, { status: 302, headers: { location: found.release.redirectTo ?? `${CDN}/${asset[1]}` } });
    }
    return json({}, 404);
  };
  return { fetch: fetchFn, requests };
}

interface Harness {
  deps: CliDeps;
  appDir: string;
  out: string[];
  err: string[];
  started: Array<{ launcher: string; args: string[] }>;
}

function harness(fetchFn: typeof fetch | undefined, env: Record<string, string> = {}, ghToken?: string): Harness {
  const appDir = mkdtempSync(join(root, 'app-'));
  const out: string[] = [];
  const err: string[] = [];
  const started: Harness['started'] = [];
  const deps: CliDeps = {
    fetch:
      fetchFn ??
      (async () => {
        throw new Error('network was used');
      }),
    env: { OGDEN_AGENTS_APP_DIR: appDir, OGDEN_AGENTS_REPO: 'o/r', ...env },
    platform: process.platform,
    home: root,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ghToken: async () => ghToken,
    npmInstall: (prefix, tarball) =>
      new Promise((resolve, reject) => {
        const cli = findNpmCli();
        if (cli === undefined) return reject(new Error('npm not found'));
        const child = spawn(process.execPath, [cli, 'install', tarball, '--prefix', prefix, '--no-audit', '--no-fund', '--no-update-notifier', '--no-save', '--loglevel=error'], {
          cwd: prefix,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, npm_config_update_notifier: 'false' },
        });
        let output = '';
        child.stderr.on('data', (c: Buffer) => (output += c.toString()));
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(output))));
      }),
    startLauncher: async (launcher, args) => {
      started.push({ launcher, args });
      return 0;
    },
  };
  return { deps, appDir, out, err, started };
}

const versions = (appDir: string) => (existsSync(join(appDir, 'versions')) ? readdirSync(join(appDir, 'versions')).sort() : []);
const state = (appDir: string) => JSON.parse(readFileSync(join(appDir, 'state.json'), 'utf8')) as Record<string, string | undefined>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ogden installer '));
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe('installing from a release', () => {
  it('downloads, verifies, installs with npm into the app folder, and starts it with the launcher options', async () => {
    const gh = fakeGitHub([{ version: '0.5.0' }]);
    const h = harness(gh.fetch);
    expect(await run(['start', '--no-open', '--port', '0'], h.deps)).toBe(0);
    expect(versions(h.appDir)).toEqual(['0.5.0']);
    expect(state(h.appDir)).toMatchObject({ current: '0.5.0' });
    expect(h.started).toHaveLength(1);
    expect(h.started[0]?.launcher).toBe(join(h.appDir, 'versions', '0.5.0', 'node_modules', 'ogden-agents', 'bin', 'ogden.js'));
    expect(h.started[0]?.args).toEqual(['--no-open', '--port', '0']);
    expect(h.out.join('\n')).toContain('Checksum verified');
    expect(existsSync(join(h.appDir, 'downloads', '0.5.0'))).toBe(false);
  }, 60_000);

  it('refuses a tarball that does not match its checksum, and installs nothing', async () => {
    const h = harness(fakeGitHub([{ version: '0.5.0', sum: 'f'.repeat(64) }]).fetch);
    expect(await run(['start'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('does not match its checksum');
    expect(versions(h.appDir)).toEqual([]);
    expect(existsSync(join(h.appDir, 'state.json'))).toBe(false);
    expect(h.started).toEqual([]);
  }, 60_000);

  it('refuses when the checksum list is missing or does not list the tarball: there is no way around it', async () => {
    for (const release of [{ version: '0.5.0', omitSums: true }, { version: '0.5.0', omitSumsLine: true }]) {
      const h = harness(fakeGitHub([release]).fetch);
      expect(await run(['start'], h.deps)).toBe(1);
      expect(h.err.join('\n')).toMatch(/SHA256SUMS\.txt/);
      expect(versions(h.appDir)).toEqual([]);
      expect(h.started).toEqual([]);
    }
  }, 60_000);

  it('refuses an installed package that is not the release version', async () => {
    // The release says 0.5.1 but the tarball inside is 0.5.0.
    const wrong = makeTarball('0.5.0');
    tarballs.set('0.5.1', wrong);
    const h = harness(fakeGitHub([{ version: '0.5.1' }]).fetch);
    tarballs.delete('0.5.1');
    expect(await run(['start'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('not ogden-agents@0.5.1');
    expect(versions(h.appDir)).toEqual([]);
  }, 60_000);

  it('refuses to download from a host that is not GitHub, and never sends the token off the API host', async () => {
    const gh = fakeGitHub([{ version: '0.5.0', redirectTo: 'https://evil.example/ogden-agents-0.5.0.tgz' }]);
    const h = harness(gh.fetch, { GITHUB_TOKEN: TOKEN });
    expect(await run(['start'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('evil.example');
    expect(gh.requests.some((r) => r.url.startsWith('https://evil.example'))).toBe(false);
    expect(versions(h.appDir)).toEqual([]);
  }, 60_000);

  it('sends the token to the API only, never to the download host, and never prints it', async () => {
    const gh = fakeGitHub([{ version: '0.5.0' }]);
    const h = harness(gh.fetch, { OGDEN_AGENTS_GITHUB_TOKEN: TOKEN });
    expect(await run(['start'], h.deps)).toBe(0);
    for (const request of gh.requests) {
      expect(request.authorization === null ? 'none' : 'bearer').toBe(request.url.startsWith(API) ? 'bearer' : 'none');
    }
    expect(gh.requests.some((r) => r.url.startsWith(CDN))).toBe(true);
    expect([...h.out, ...h.err].join('\n')).not.toContain(TOKEN);
    expect(readFileSync(join(h.appDir, 'state.json'), 'utf8')).not.toContain(TOKEN);
  }, 60_000);
});

describe('updates, rollback and the previous version', () => {
  it('updates to a newer release, keeps the previous version and removes older ones', async () => {
    const h = harness(undefined);
    for (const version of ['0.5.0', '0.5.1', '0.5.2']) {
      h.deps.fetch = fakeGitHub([{ version }]).fetch;
      expect(await run(['start'], h.deps)).toBe(0);
    }
    expect(versions(h.appDir)).toEqual(['0.5.1', '0.5.2']);
    expect(state(h.appDir)).toMatchObject({ current: '0.5.2', previous: '0.5.1' });
    expect(h.started.map((s) => s.launcher.includes(join('versions', '0.5.2')))).toEqual([false, false, true]);
  }, 120_000);

  it('does not reinstall the same version, and never downgrades', async () => {
    const h = harness(fakeGitHub([{ version: '0.5.1' }]).fetch);
    await run(['start'], h.deps);
    h.deps.fetch = fakeGitHub([{ version: '0.5.1' }]).fetch;
    const before = h.out.length;
    await run(['start'], h.deps);
    expect(h.out.slice(before).join('\n')).toContain('is the newest');
    h.deps.fetch = fakeGitHub([{ version: '0.5.0' }]).fetch;
    await run(['start'], h.deps);
    expect(state(h.appDir)).toMatchObject({ current: '0.5.1' });
  }, 60_000);

  it('rollback switches back and start does not reinstall the rolled-back version; update does', async () => {
    const h = harness(undefined);
    for (const version of ['0.5.0', '0.5.1']) {
      h.deps.fetch = fakeGitHub([{ version }]).fetch;
      await run(['start'], h.deps);
    }
    expect(await run(['rollback'], h.deps)).toBe(0);
    expect(state(h.appDir)).toMatchObject({ current: '0.5.0', previous: '0.5.1', skip: '0.5.1' });
    h.deps.fetch = fakeGitHub([{ version: '0.5.1' }]).fetch;
    h.started.length = 0;
    await run(['start'], h.deps);
    expect(h.started[0]?.launcher).toContain(join('versions', '0.5.0'));
    expect(await run(['update'], h.deps)).toBe(0);
    expect(state(h.appDir)).toMatchObject({ current: '0.5.1' });
  }, 120_000);

  it('rollback with nothing to go back to says so', async () => {
    const h = harness(undefined);
    expect(await run(['rollback'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('no previous version');
  });

  it('offline, it starts the installed version; with nothing installed it fails plainly', async () => {
    const h = harness(fakeGitHub([{ version: '0.5.0' }]).fetch);
    await run(['start'], h.deps);
    h.started.length = 0;
    h.deps.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    };
    expect(await run(['start'], h.deps)).toBe(0);
    expect(h.err.join('\n')).toContain('Starting the installed version instead');
    expect(h.started).toHaveLength(1);
    const fresh = harness(h.deps.fetch);
    expect(await run(['start'], fresh.deps)).toBe(1);
    expect(fresh.err.join('\n')).toContain('Check your internet connection');
  }, 60_000);
});

describe('channels', () => {
  it('stable never installs a prerelease; the next channel does; a prerelease install follows next', async () => {
    const releases = [{ version: '0.4.0' }, { version: '0.5.0-rc.1', prerelease: true }];
    const stable = harness(fakeGitHub(releases).fetch);
    await run(['update'], stable.deps);
    expect(state(stable.appDir)).toMatchObject({ current: '0.4.0' });

    const next = harness(fakeGitHub(releases).fetch, { OGDEN_AGENTS_CHANNEL: 'next' });
    await run(['update'], next.deps);
    expect(state(next.appDir)).toMatchObject({ current: '0.5.0-rc.1' });
    // Without the variable an installed prerelease keeps following next.
    next.deps.env = { ...next.deps.env, OGDEN_AGENTS_CHANNEL: '' };
    next.deps.fetch = fakeGitHub([...releases, { version: '0.5.0-rc.2', prerelease: true }]).fetch;
    await run(['update'], next.deps);
    expect(state(next.appDir)).toMatchObject({ current: '0.5.0-rc.2' });
  }, 120_000);

  it('with only prereleases, stable says to use the next channel', async () => {
    const h = harness(fakeGitHub([{ version: '0.5.0-rc.1', prerelease: true }]).fetch);
    expect(await run(['start'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('OGDEN_AGENTS_CHANNEL=next');
  });

  it('rejects a bad channel or repository name before touching the network', async () => {
    const bad = harness(undefined, { OGDEN_AGENTS_CHANNEL: 'beta' });
    expect(await run(['start'], bad.deps)).toBe(2);
    const repo = harness(undefined, { OGDEN_AGENTS_REPO: '../etc' });
    expect(await run(['start'], repo.deps)).toBe(2);
  });
});

describe('a private repository', () => {
  it('without a token, explains what to do and prints nothing secret', async () => {
    const h = harness(fakeGitHub([{ version: '0.5.0' }], { privateRepo: true }).fetch);
    expect(await run(['start'], h.deps)).toBe(1);
    const text = h.err.join('\n');
    expect(text).toContain('gh auth login');
    expect(text).toContain('OGDEN_AGENTS_GITHUB_TOKEN');
    expect(text).toContain('404');
    expect(versions(h.appDir)).toEqual([]);
  });

  it('uses the GitHub CLI sign-in when the repository is not found without one, and masks it', async () => {
    const gh = fakeGitHub([{ version: '0.5.0' }], { privateRepo: true });
    const h = harness(gh.fetch, {}, TOKEN);
    expect(await run(['start'], h.deps)).toBe(0);
    expect(state(h.appDir)).toMatchObject({ current: '0.5.0' });
    expect([...h.out, ...h.err].join('\n')).not.toContain(TOKEN);
    expect(h.out.join('\n')).toContain('GitHub CLI');
  }, 60_000);

  it('a wrong token gets a plain message that does not repeat it', async () => {
    const h = harness(fakeGitHub([{ version: '0.5.0' }], { privateRepo: true }).fetch, { GITHUB_TOKEN: 'ghp_wrongwrongwrongwrongwrongwrongwrong' });
    expect(await run(['start'], h.deps)).toBe(1);
    expect(h.err.join('\n')).not.toContain('wrongwrong');
    expect(h.err.join('\n')).toContain('refused the token or could not find');
  });
});

describe('status', () => {
  it('reports without the network', async () => {
    const h = harness(undefined);
    expect(await run(['status'], h.deps)).toBe(0);
    expect(h.out.join('\n')).toContain('Installed: nothing yet');
  });
});
