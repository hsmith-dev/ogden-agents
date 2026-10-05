/**
 * The "a newer version is available" notice (story 13.7, E13-R7; GitHub
 * Releases added in story 13.14). The server, never the browser, asks once per
 * start (off the start path), and when the user clicks Check now in Settings,
 * About. It asks this project's GitHub Releases (the latest release, through
 * `@ogden-agents/shared/release-source`) and, unless this install came from
 * GitHub Releases, npm's public dist-tags list for `ogden-agents` too. The
 * highest newer version either one reports is offered.
 *
 * Privacy (AD-15, AD-16): each source is asked with one `GET` of a fixed URL
 * ({@link DIST_TAGS_URL}, {@link GITHUB_LATEST_URL}) asking for JSON. No
 * version, id, account, project, path or token goes in it (the GitHub source
 * adds only its constant `user-agent: ogden-agents`, which GitHub requires; a
 * token is never sent, because the repository is public. Node's own default
 * headers apply, and a proxy set in the environment sees it), redirects are
 * refused, it times out after {@link CHECK_TIMEOUT_MS} and its body is capped
 * ({@link MAX_BODY_BYTES} for npm's few hundred bytes, {@link GITHUB_MAX_BODY_BYTES}
 * for a release answer, which lists its files). The only things kept are the
 * switch and the time of the last check, in `<dataDir>/update-check.json`.
 * A failed check is silent (one log line with a code only); Check now says so.
 * Tests give a fake client; with none, a test run never makes a request.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { channelOf, compareVersions, decideUpdate, SETTINGS_STREAM, type InstallMethod, type UpdateCheckOutcome, type UpdateNoticeResponse, type UpdateOffer, type UpdateSourceName } from '@ogden-agents/shared';
import { channelFor, createGitHubReleasesSource, DEFAULT_API_BASE, DEFAULT_REPO, isNewer, ReleaseSourceError, type FetchLike } from '@ogden-agents/shared/release-source';
import type { Core } from '@ogden-agents/core';
import { z } from 'zod';
import type { Logger } from './log.js';
import { isTestRun } from './test-hooks.js';

/** npm's public dist-tags list for the package: the only thing ever requested. */
export const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/ogden-agents/dist-tags';
const GITHUB_PER_PAGE = 5;
/** The newest published release of this project: the only thing asked of GitHub (the source's `releases/latest`). Nothing is sent in it. */
export const GITHUB_LATEST_URL = `${DEFAULT_API_BASE}/repos/${DEFAULT_REPO}/releases/latest`;
/** Preview installs ask for the newest few releases instead (the highest of them is offered); a small page keeps the answer small. */
export const GITHUB_NEXT_URL = `${DEFAULT_API_BASE}/repos/${DEFAULT_REPO}/releases?per_page=${GITHUB_PER_PAGE}`;
/** A slow network never holds anything up: the check gives up after this long. */
export const CHECK_TIMEOUT_MS = 5000;
/** The most of the answer that is read; a real one is a few hundred bytes. */
export const MAX_BODY_BYTES = 16 * 1024;
/** A GitHub release answer lists its files and notes, so it is bigger than npm's; still capped. */
export const GITHUB_MAX_BODY_BYTES = 256 * 1024;
/** `<dataDir>/<this>`: `{ "enabled": true, "lastCheckedAt": "…" }`. */
export const UPDATE_CHECK_FILE = 'update-check.json';

/** The request the check makes: a `GET` with these options. Node's fetch adds its own defaults (such as `user-agent: node`); nothing of Ogden's goes in it. */
export interface UpdateRequestInit {
  signal: AbortSignal;
  redirect: 'error';
  headers: Record<string, string>;
}
/** What the check reaches npm and GitHub with (tests: a fake that answers by URL). */
export type UpdateFetch = (url: string, init: UpdateRequestInit) => Promise<Response>;

/** `StartOptions.updates`: `false` turns the check off for good; a client replaces the real one. */
export type UpdatesOption = false | { fetch: UpdateFetch; timeoutMs?: number };

const StoredState = z.object({ enabled: z.boolean().optional(), lastCheckedAt: z.string().optional() });
const DistTags = z.record(z.string(), z.string());

/** How this install was started, from its launcher's path: made by the GitHub Releases helper, under npx's cache, under a global `node_modules`, or none of these. */
export function installMethodOf(launcherEntry: string | undefined): InstallMethod {
  if (launcherEntry === undefined) return 'other';
  const path = launcherEntry.replaceAll('\\', '/');
  // The GitHub Releases helper installs under `<app dir>/versions/<version>/node_modules/ogden-agents/`.
  if (/\/versions\/\d+\.\d+\.\d+[^/]*\/node_modules\/ogden-agents\//.test(path)) return 'github';
  if (path.includes('/_npx/')) return 'npx';
  return path.includes('/node_modules/ogden-agents/') ? 'global' : 'other';
}

/** `OGDEN_AGENTS_OFFLINE`: any value but empty, `0` or `false`. */
export function isOffline(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.OGDEN_AGENTS_OFFLINE?.trim().toLowerCase();
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/** The sources a check asks: GitHub Releases always; npm too unless this install came from GitHub Releases. */
export function sourcesFor(installMethod: InstallMethod): UpdateSourceName[] {
  return installMethod === 'github' ? ['github-releases'] : ['github-releases', 'npm'];
}

/** The notice; the route adds `shell` and the desktop app's `app` (story 13.3). */
export type NpmNotice = Omit<UpdateNoticeResponse, 'shell' | 'appChannel' | 'app'>;
/** What Check now answers with, before the route adds the desktop fields. */
export interface NpmCheckResult {
  outcome: UpdateCheckOutcome;
  notice: NpmNotice;
}

export interface UpdateCheckOptions {
  dataDir: string;
  /** The running version. */
  version: string;
  /** `undefined`: never make a request (a test run with no fake). */
  fetch: UpdateFetch | undefined;
  offline: boolean;
  installMethod: InstallMethod;
  events: Core['events'];
  log: Logger;
  timeoutMs?: number;
  now?: () => Date;
}

export interface UpdateCheck {
  notice(): NpmNotice;
  /** Turns the start check on or off; appends the event when it changed. */
  setEnabled(enabled: boolean): NpmNotice;
  /** The once-per-start check: nothing when the switch is off, offline, or already run. Never throws. */
  runOnStart(): Promise<void>;
  /** Check now: the user asked, so it runs even with the switch off, but never offline. */
  checkNow(): Promise<NpmCheckResult>;
  /** Stops a check in flight (the server is closing). */
  close(): void;
}

export function createUpdateCheck(options: UpdateCheckOptions): UpdateCheck {
  const { dataDir, version, offline, installMethod, events, log } = options;
  const file = join(dataDir, UPDATE_CHECK_FILE);
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const channel = channelOf(version) ?? 'stable';
  const abort = new AbortController();
  let offer: UpdateOffer | null = null;
  let started = false;
  let inFlight: Promise<UpdateCheckOutcome> | undefined;

  const read = (): z.infer<typeof StoredState> => {
    try {
      const parsed = StoredState.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  };
  const write = (state: z.infer<typeof StoredState>): void => {
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      log.warn('update check state not saved', { code: (error as NodeJS.ErrnoException).code ?? 'unexpected' });
    }
  };

  const notice = (): NpmNotice => {
    const state = read();
    return { current: version, channel, installMethod, enabled: state.enabled !== false, offline, sources: sourcesFor(installMethod), lastCheckedAt: state.lastCheckedAt ?? null, available: offer };
  };
  const announce = (): void => {
    try {
      events.append({ type: 'settings.update_notice_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { available: offer?.version ?? null, enabled: notice().enabled } });
    } catch {
      // The core may be closing; the notice is read again by the next page load.
    }
  };

  /** One capped, no-redirect `GET` of `url`; the body is read only for a 200 and only up to `max` bytes. */
  async function get(url: string, headers: Record<string, string>, max: number): Promise<{ status: number; headers: Response['headers']; text: string }> {
    if (options.fetch === undefined) throw new Error('no client');
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await options.fetch(url, { signal, redirect: 'error', headers });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { status: response.status, headers: response.headers, text: '' };
    }
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        void reader.cancel().catch(() => {});
        throw new Error('body too large');
      }
      chunks.push(value);
    }
    return { status: 200, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') };
  }

  /** npm's dist-tags: one `GET`. */
  async function askNpm(): Promise<UpdateOffer | null> {
    const answer = await get(DIST_TAGS_URL, { accept: 'application/json' }, MAX_BODY_BYTES);
    if (answer.status !== 200) throw new Error(`status ${answer.status}`);
    return decideUpdate(version, DistTags.parse(JSON.parse(answer.text)), 'npm');
  }

  /** The `VersionSource` for this project's GitHub Releases, over the same capped, no-redirect client. */
  const githubClient: FetchLike = async (url, init) => {
    // The source asks for `redirect: 'manual'`; the check never follows one, so a redirect is an error.
    const answer = await get(url, init.headers, GITHUB_MAX_BODY_BYTES);
    return { status: answer.status, headers: answer.headers, json: async () => JSON.parse(answer.text) as unknown };
  };
  const github = createGitHubReleasesSource({ fetch: githubClient, perPage: GITHUB_PER_PAGE });

  /** GitHub Releases: the latest release on this version's channel, if newer. */
  async function askGitHub(): Promise<UpdateOffer | null> {
    // No release published yet (a 404) is "nothing newer", not a failure.
    const release = await github.latest(channelFor(version)).catch((error: unknown) => {
      if (error instanceof ReleaseSourceError && error.kind === 'not-found') return undefined;
      throw error;
    });
    if (release === undefined || !isNewer(version, release.version)) return null;
    // A stable version is told only of a stable release, as with npm's `latest`.
    if (channel === 'stable' && release.prerelease) return null;
    return { version: release.version, tag: channel === 'stable' ? 'latest' : 'next', source: 'github-releases' };
  }

  /** The offer to show: the highest version; on a tie, npm's, whose update command works from any terminal. */
  function best(offers: readonly UpdateOffer[]): UpdateOffer | null {
    let top: UpdateOffer | null = null;
    for (const candidate of offers) {
      const order = top === null ? 1 : (compareVersions(candidate.version, top.version) ?? 0);
      if (order > 0 || (order === 0 && candidate.source === 'npm')) top = candidate;
    }
    return top;
  }

  function run(): Promise<UpdateCheckOutcome> {
    inFlight ??= (async () => {
      try {
        const asked = sourcesFor(installMethod);
        const results = await Promise.allSettled(asked.map((name) => (name === 'npm' ? askNpm() : askGitHub())));
        const offers: UpdateOffer[] = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            if (result.value !== null) offers.push(result.value);
            return;
          }
          // Silent for the user: a code only, never the response.
          const error: unknown = result.reason;
          const code = error instanceof z.ZodError || error instanceof SyntaxError ? 'bad_answer' : error instanceof ReleaseSourceError ? error.kind : ((error as NodeJS.ErrnoException).code ?? (error as Error).name ?? 'unexpected');
          log.info('update check did not finish', { source: asked[index], code });
        });
        // A source that failed and found nothing means we can't say "up to date": keep what was known and report a failure.
        if (offers.length === 0 && results.some((result) => result.status === 'rejected')) return 'failed';
        offer = best(offers);
        write({ ...read(), lastCheckedAt: now().toISOString() });
        announce();
        return offer === null ? 'current' : 'newer';
      } catch (error) {
        log.info('update check did not finish', { code: (error as NodeJS.ErrnoException).code ?? (error as Error).name ?? 'unexpected' });
        return 'failed';
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  }

  return {
    notice,
    setEnabled(enabled) {
      const previous = notice().enabled;
      if (previous !== enabled) {
        write({ ...read(), enabled });
        announce();
      }
      return notice();
    },
    async runOnStart() {
      if (started) return;
      started = true;
      if (offline || options.fetch === undefined || !notice().enabled) return;
      await run();
    },
    async checkNow() {
      if (offline || options.fetch === undefined) return { outcome: 'offline', notice: notice() };
      const outcome = await run();
      return { outcome, notice: notice() };
    },
    close: () => abort.abort(),
  };
}

/**
 * The update check for `start()`: the option's fake client, else npm's real one
 * (`fetch`); never a request in a test run with no fake, and none at all with
 * `false`. Offline (`OGDEN_AGENTS_OFFLINE`) is passed on: the About page says so.
 */
export function wireUpdateCheck(
  option: UpdatesOption | undefined,
  rest: Omit<UpdateCheckOptions, 'fetch' | 'offline' | 'timeoutMs'>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): UpdateCheck {
  const client = option === false ? undefined : (option?.fetch ?? (isTestRun(env) ? undefined : (url, init) => fetch(url, init)));
  return createUpdateCheck({ ...rest, fetch: client, offline: isOffline(env), ...(option === undefined || option === false || option.timeoutMs === undefined ? {} : { timeoutMs: option.timeoutMs }) });
}
