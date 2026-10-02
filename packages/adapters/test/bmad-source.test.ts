/**
 * The pinned upstream sources (story 4.14, `bmad-source`), with stub
 * `fetch`es and a fake `uv`, never the network:
 *
 * - a download fetches the exact commit once, verifies it, extracts it to
 *   `<data>/bmad/<name>/<commit>/<include>`, writes the marker, and removes
 *   other commits and leftover temp folders; `file` then answers paths
 *   inside it only;
 * - a hash mismatch or an unsafe archive leaves nothing; offline, an HTTP
 *   error, a timeout and a download that is too large are `offline`;
 * - concurrent downloads share one fetch; `status` and `file` never fetch;
 *   a marker for another pin (an upgrade that moved it) is `missing`;
 * - the bmad-loop resolver installs the verified source with `uv venv` and
 *   `uv pip install --build-constraints`, in the work folder, with exactly
 *   the environment given, and answers the executable;
 * - the shipped lock and label mapping have the shapes their readers expect.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BmadDownloadError } from '@ogden-agents/core';
import { BmadLock, BmadLockSource, SKILL_NAME_PATTERN } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { tarGz, type TarEntry } from '../../../tests/fixtures/tar.js';
import {
  BMAD_LOCK,
  bmadLoopExecutable,
  createBmadLoopResolver,
  createMemoryBmadSource,
  createPinnedSource,
  createUpstreamBmadSource,
  gunzipLimited,
  hashEntries,
  parseTar,
  selectVerified,
  SKILL_LABELS,
  uvEnvironment,
  VERIFIED_MARKER,
  type FetchLike,
} from '../src/index.js';

const FAKE_UV = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-uv.mjs');
const COMMIT = '1'.repeat(40);
const OLD_COMMIT = '2'.repeat(40);
const TOP = `BMAD-METHOD-${COMMIT}`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-bmad-source-'));
  dirs.push(dir);
  return dir;
};

/** The fixture tree as codeload would serve it, with `extra` entries (unchecked: an unsafe one too). */
function rawTarball(extra: readonly TarEntry[] = []): Buffer {
  const entries: TarEntry[] = [
    { name: `${TOP}/`, type: 'dir' },
    { name: `${TOP}/README.md`, data: '# BMad\n' },
    { name: `${TOP}/skills/bmad-ticket/scripts/tickets.py`, data: 'print("tickets")\r\n' },
    { name: `${TOP}/skills/bmad/scripts/setup.py`, data: 'print("setup")\n' },
    ...extra,
  ];
  return tarGz(entries, { globalComment: COMMIT });
}

function upstream() {
  const tarball = rawTarball();
  const contentHash = hashEntries(selectVerified(parseTar(gunzipLimited(tarball, 1 << 20)), 'skills/'));
  const pin: BmadLockSource = { repo: 'bmad-code-org/BMAD-METHOD', ref: 'main', commit: COMMIT, version: '6.13.0-test', include: 'skills/', contentHash };
  return { tarball, pin };
}

/** A `fetch` that answers `respond()` and records each URL. */
function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    return respond();
  };
  return { calls, fetch };
}

const methodSource = (dataDir: string, pin: BmadLockSource, fetch: FetchLike, extra: Partial<Parameters<typeof createPinnedSource>[0]> = {}) =>
  createUpstreamBmadSource({ dataDir, lock: { sources: { 'bmad-method': pin } }, fetch, ...extra });

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

describe('downloading the pinned source', () => {
  it('fetches the exact commit once, verifies, extracts under include with the marker, and removes stale folders', async () => {
    const dataDir = tempDir();
    const { tarball, pin } = upstream();
    // An older pin's folder and a temp folder a stopped server left: both go.
    mkdirSync(join(dataDir, 'bmad', 'bmad-method', OLD_COMMIT, 'skills'), { recursive: true });
    mkdirSync(join(dataDir, 'bmad', '.tmp-bmad-method-left'), { recursive: true });
    const { calls, fetch } = stubFetch(() => new Response(tarball));
    const source = methodSource(dataDir, pin, fetch);
    expect(source.status()).toEqual({ state: 'missing', version: '6.13.0-test', commit: COMMIT });
    expect(source.file('bmad-ticket/scripts/tickets.py')).toBeUndefined();

    expect(await source.download()).toEqual({ state: 'ready', version: '6.13.0-test', commit: COMMIT });
    expect(calls).toEqual([`https://codeload.github.com/bmad-code-org/BMAD-METHOD/tar.gz/${COMMIT}`]);
    const folder = join(dataDir, 'bmad', 'bmad-method', COMMIT);
    expect(readFileSync(join(folder, 'skills', 'bmad-ticket', 'scripts', 'tickets.py'), 'utf8')).toBe('print("tickets")\n');
    expect(existsSync(join(folder, 'README.md'))).toBe(false);
    expect(JSON.parse(readFileSync(join(folder, VERIFIED_MARKER), 'utf8'))).toEqual({ repo: pin.repo, commit: COMMIT, contentHash: pin.contentHash });
    expect(readdirSync(join(dataDir, 'bmad', 'bmad-method'))).toEqual([COMMIT]);
    expect(readdirSync(join(dataDir, 'bmad'))).toEqual(['bmad-method']);
    expect(source.status().state).toBe('ready');
    expect(source.file('bmad-ticket/scripts/tickets.py')).toBe(join(folder, 'skills', 'bmad-ticket', 'scripts', 'tickets.py'));
    expect(source.file('bmad/scripts/setup.py')).toBe(join(folder, 'skills', 'bmad', 'scripts', 'setup.py'));
    for (const outside of ['../README.md', '/etc/passwd', 'bmad\\scripts\\setup.py', 'missing.py', 'bmad', '']) expect(source.file(outside), outside).toBeUndefined();

    // Ready already: no second fetch.
    await source.download();
    expect(calls).toHaveLength(1);
  });

  it('a ready copy damaged since (a file deleted) is downloaded again on the next download, not before', async () => {
    const dataDir = tempDir();
    const { tarball, pin } = upstream();
    const { calls, fetch } = stubFetch(() => new Response(tarball));
    const source = methodSource(dataDir, pin, fetch);
    await source.download();
    const script = source.file('bmad-ticket/scripts/tickets.py')!;
    rmSync(script);
    // The marker still says ready, and reads never re-check or fetch.
    expect(source.status().state).toBe('ready');
    expect(source.file('bmad-ticket/scripts/tickets.py')).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(await source.download()).toEqual(source.status());
    expect(calls).toHaveLength(2);
    expect(readFileSync(script, 'utf8')).toBe('print("tickets")\n');
    // Intact again: no third fetch.
    await source.download();
    expect(calls).toHaveLength(2);
  });

  it('a file the disk refuses to write is an integrity failure, never a raw file-system error, and leaves nothing', async () => {
    const dataDir = tempDir();
    // A name longer than any file system allows (ENAMETOOLONG), which no archive check catches.
    const tarball = rawTarball([{ name: `${TOP}/skills/${'x'.repeat(300)}.md`, data: 'x' }]);
    const contentHash = hashEntries(selectVerified(parseTar(gunzipLimited(tarball, 1 << 20)), 'skills/'));
    const { pin } = upstream();
    const error = await failureOf(methodSource(dataDir, { ...pin, contentHash }, stubFetch(() => new Response(tarball)).fetch).download());
    expect(error).toBeInstanceOf(BmadDownloadError);
    expect((error as BmadDownloadError).reason).toBe('integrity');
    expect((error as BmadDownloadError).detail).not.toContain(dataDir);
    expect(readdirSync(join(dataDir, 'bmad')).filter((name) => name.startsWith('.tmp-'))).toEqual([]);
    expect(existsSync(join(dataDir, 'bmad', 'bmad-method', COMMIT))).toBe(false);
  });

  it('a hash mismatch is an integrity failure and leaves nothing', async () => {
    const dataDir = tempDir();
    const { tarball, pin } = upstream();
    const source = methodSource(dataDir, { ...pin, contentHash: `sha256:${'0'.repeat(64)}` }, stubFetch(() => new Response(tarball)).fetch);
    const error = await failureOf(source.download());
    expect(error).toBeInstanceOf(BmadDownloadError);
    expect((error as BmadDownloadError).reason).toBe('integrity');
    expect((error as BmadDownloadError).detail).toMatch(/expected sha256:0+, got sha256:/);
    expect(existsSync(join(dataDir, 'bmad'))).toBe(false);
    expect(source.status().state).toBe('missing');
  });

  it('an unsafe archive is an integrity failure and writes nothing', async () => {
    const dataDir = tempDir();
    const { pin } = upstream();
    for (const bad of [
      { name: `${TOP}/skills/bmad/link`, type: 'symlink', link: '/etc/passwd' },
      { name: `${TOP}/skills/../../escape.py`, data: 'x' },
    ] satisfies TarEntry[]) {
      const tarball = rawTarball([bad]);
      const error = await failureOf(methodSource(dataDir, pin, stubFetch(() => new Response(tarball)).fetch).download());
      expect((error as BmadDownloadError).reason, bad.name).toBe('integrity');
    }
    expect(existsSync(join(dataDir, 'bmad'))).toBe(false);
    expect(existsSync(join(dataDir, '..', 'escape.py'))).toBe(false);
  });

  it('offline, an HTTP error, a timeout and a download that is too large are offline failures and leave it missing', async () => {
    const { tarball, pin } = upstream();
    const cases: Array<[string, FetchLike, Partial<Parameters<typeof createPinnedSource>[0]>]> = [
      ['offline', () => Promise.reject(new TypeError('fetch failed')), {}],
      ['HTTP 404', async () => new Response('Not Found', { status: 404 }), {}],
      [
        'a timeout',
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
        { timeoutMs: 50 },
      ],
      ['too large', async () => new Response(tarball), { maxBytes: 100 }],
      ['too large, declared', async () => new Response(tarball, { headers: { 'content-length': String(10 ** 9) } }), {}],
    ];
    for (const [what, fetch, extra] of cases) {
      const dataDir = tempDir();
      const source = methodSource(dataDir, pin, fetch, extra);
      const error = await failureOf(source.download());
      expect(error, what).toBeInstanceOf(BmadDownloadError);
      expect((error as BmadDownloadError).reason, what).toBe('offline');
      expect((error as BmadDownloadError).code, what).toBe('bmad_download_failed');
      expect(source.status().state, what).toBe('missing');
      expect(existsSync(join(dataDir, 'bmad')), what).toBe(false);
    }
  });

  it('an archive that unpacks past the cap is refused', async () => {
    const { tarball, pin } = upstream();
    const error = await failureOf(methodSource(tempDir(), pin, stubFetch(() => new Response(tarball)).fetch, { maxUnpackedBytes: 1024 }).download());
    expect((error as BmadDownloadError).reason).toBe('integrity');
  });

  it('concurrent downloads share one fetch and report downloading meanwhile', async () => {
    const { tarball, pin } = upstream();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { calls, fetch } = stubFetch(async () => {
      await gate;
      return new Response(tarball);
    });
    const source = methodSource(tempDir(), pin, fetch);
    const first = source.download();
    const second = source.download();
    expect(source.status().state).toBe('downloading');
    release();
    expect(await Promise.all([first, second])).toEqual([source.status(), source.status()]);
    expect(calls).toHaveLength(1);
  });

  it('status and file never fetch; a marker for another pin counts as missing', () => {
    const dataDir = tempDir();
    const { pin } = upstream();
    const { calls, fetch } = stubFetch(() => {
      throw new Error('no fetch expected');
    });
    const folder = join(dataDir, 'bmad', 'bmad-method', COMMIT);
    mkdirSync(join(folder, 'skills'), { recursive: true });
    writeFileSync(join(folder, VERIFIED_MARKER), JSON.stringify({ repo: pin.repo, commit: COMMIT, contentHash: `sha256:${'f'.repeat(64)}` }));
    const source = methodSource(dataDir, pin, fetch);
    expect(source.status().state).toBe('missing');
    expect(source.file('bmad-ticket/scripts/tickets.py')).toBeUndefined();
    writeFileSync(join(folder, VERIFIED_MARKER), JSON.stringify({ repo: pin.repo, commit: COMMIT, contentHash: pin.contentHash }));
    expect(source.status().state).toBe('ready');
    expect(calls).toEqual([]);
  });
});

describe('the memory source (tests)', () => {
  it('starts missing, a download makes it ready once, and a failure rejects as told', async () => {
    const source = createMemoryBmadSource({ files: { 'a.py': '/x/a.py' } });
    expect(source.status().state).toBe('missing');
    expect(source.file('a.py')).toBeUndefined();
    await Promise.all([source.download(), source.download()]);
    expect(source.downloads).toBe(1);
    expect(source.file('a.py')).toBe('/x/a.py');
    const failing = createMemoryBmadSource({ failWith: 'integrity' });
    expect(((await failureOf(failing.download())) as BmadDownloadError).reason).toBe('integrity');
    expect(failing.status().state).toBe('missing');
  });
});

describe('the bmad-loop resolver', () => {
  it('names the executable where uv puts it on each OS', () => {
    expect(bmadLoopExecutable(join('v'), 'linux')).toBe(join('v', 'bin', 'bmad-loop'));
    expect(bmadLoopExecutable(join('v'), 'darwin')).toBe(join('v', 'bin', 'bmad-loop'));
    expect(bmadLoopExecutable(join('v'), 'win32')).toBe(join('v', 'Scripts', 'bmad-loop.exe'));
  });

  it('downloads the source, installs it with uv venv and uv pip install --build-constraints in the work folder with only the given environment, and reuses it', async () => {
    const dataDir = tempDir();
    const workDir = tempDir();
    const srcDir = tempDir();
    writeFileSync(join(srcDir, 'pyproject.toml'), '[project]\nname = "bmad-loop"\n');
    const envFile = join(tempDir(), 'uv.jsonl');
    const source = createMemoryBmadSource({ files: { 'pyproject.toml': join(srcDir, 'pyproject.toml') } });
    const planted = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-planted', GITHUB_TOKEN: 'ghp_planted' };
    const env = () => ({ ...uvEnvironment(planted), FAKE_UV_MODE: 'install', FAKE_UV_ENV_FILE: envFile });
    const pin = { commit: COMMIT, buildConstraints: ['hatchling==1.32.4'] };
    const resolver = createBmadLoopResolver({ source, pin, uvCommand: async () => ({ file: process.execPath, args: [FAKE_UV] }), env, dataDir, workDir });

    const venv = join(dataDir, 'tools', 'bmad-loop', COMMIT);
    expect(await resolver.resolve()).toBe(bmadLoopExecutable(venv));
    expect(source.downloads).toBe(1);
    const runs = readFileSync(envFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[]; cwd: string; env: Record<string, string> });
    expect(runs.map((run) => run.argv.slice(0, 2))).toEqual([
      ['venv', '--no-config'],
      ['pip', 'install'],
    ]);
    expect(runs[0]!.argv.at(-1)).toBe(venv);
    const install = runs[1]!.argv;
    expect(install[install.indexOf('--python') + 1]).toBe(venv);
    expect(install.at(-1)).toBe(srcDir);
    expect(install).toContain('--build-constraints');
    for (const run of runs) {
      // Windows may report the 8.3 short form of the temp path (RUNNER~1); compare resolved paths.
      expect(realpathSync.native(run.cwd)).toBe(realpathSync.native(workDir));
      const text = JSON.stringify(run.env);
      for (const secret of ['sk-ant-planted', 'ghp_planted']) expect(text).not.toContain(secret);
      expect(run.env.PYTHONUTF8).toBe('1');
    }
    // The constraints file is gone once installed.
    expect(readdirSync(join(dataDir, 'tools', 'bmad-loop'))).toEqual([COMMIT]);

    // A finished install is reused: no uv runs again.
    expect(await resolver.resolve()).toBe(bmadLoopExecutable(venv));
    expect(readFileSync(envFile, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('without uv it fails and leaves no environment', async () => {
    const dataDir = tempDir();
    const srcDir = tempDir();
    writeFileSync(join(srcDir, 'pyproject.toml'), '');
    const source = createMemoryBmadSource({ files: { 'pyproject.toml': join(srcDir, 'pyproject.toml') } });
    const resolver = createBmadLoopResolver({ source, uvCommand: async () => undefined, env: () => ({}), dataDir, workDir: tempDir() });
    await expect(resolver.resolve()).rejects.toThrow(/needs uv/);
    expect(existsSync(join(dataDir, 'tools', 'bmad-loop', BMAD_LOCK.sources['bmad-loop'].commit))).toBe(false);
  });
});

describe('the shipped files', () => {
  it('the lock pins both upstream repos to full commits with content hashes, unchanged by this story', () => {
    expect(BmadLock.parse(BMAD_LOCK)).toEqual(BMAD_LOCK);
    expect(BMAD_LOCK.sources['bmad-method']).toMatchObject({
      repo: 'bmad-code-org/BMAD-METHOD',
      commit: '1cbcfa272fe65787c06a1fa164a901f46117cca7',
      include: 'skills/',
      contentHash: 'sha256:6a4471ad7c8861b47a881ca35e0b598b9d32aed10c1e19a78e559d005f2c3c7b',
    });
    expect(BMAD_LOCK.sources['bmad-loop']).toMatchObject({
      repo: 'bmad-code-org/bmad-loop',
      ref: 'v0.13.0',
      commit: '6bbe469637e2b8ac490b1f8c085aed8e2b19ce1b',
      include: '',
      buildConstraints: ['hatchling==1.32.4'],
    });
  });

  it("the lock's include is a folder inside the tree: no . or .. segments", () => {
    const base = BMAD_LOCK.sources['bmad-method'];
    for (const include of ['', 'skills/', 'a/b/']) expect(BmadLockSource.safeParse({ ...base, include }).success, include).toBe(true);
    for (const include of ['../', './', 'skills/../', 'a/./', 'skills', '/skills/']) expect(BmadLockSource.safeParse({ ...base, include }).success, include).toBe(false);
  });

  it('the label mapping is keyed by skill name with the per-skill fields 4.5 reads (empty until 4.5 fills it)', () => {
    expect(Object.keys(SKILL_LABELS).sort()).toEqual(['entry', 'skills']);
    expect(SKILL_LABELS.entry === null || SKILL_NAME_PATTERN.test(SKILL_LABELS.entry)).toBe(true);
    for (const [name, labels] of Object.entries(SKILL_LABELS.skills)) {
      expect(name).toMatch(SKILL_NAME_PATTERN);
      expect(Object.keys(labels).every((key) => ['label', 'description', 'group', 'next'].includes(key)), name).toBe(true);
      expect(typeof labels.label, name).toBe('string');
    }
  });
});
