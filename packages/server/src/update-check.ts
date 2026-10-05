/**
 * The "a newer version is available" notice (story 13.7, E13-R7). The server,
 * never the browser, reads npm's public dist-tags list for `ogden-agents`:
 * once per start (off the start path), and when the user clicks Check now in
 * Settings, About.
 *
 * Privacy (AD-15, AD-16): the whole request is one `GET` of
 * {@link DIST_TAGS_URL} asking for JSON. No version, id, account, project or
 * path goes in it, redirects are refused, it times out after
 * {@link CHECK_TIMEOUT_MS} and its body is capped. The only things kept are
 * the switch and the time of the last check, in `<dataDir>/update-check.json`.
 * A failed check is silent (one log line with a code only); Check now says so.
 * Tests give a fake client; with none, a test run never makes a request.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { channelOf, decideUpdate, SETTINGS_STREAM, type InstallMethod, type UpdateCheckResponse, type UpdateNoticeResponse, type UpdateOffer } from '@ogden-agents/shared';
import type { Core } from '@ogden-agents/core';
import { z } from 'zod';
import type { Logger } from './log.js';
import { isTestRun } from './test-hooks.js';

/** npm's public dist-tags list for the package: the only thing ever requested. */
export const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/ogden-agents/dist-tags';
/** A slow network never holds anything up: the check gives up after this long. */
export const CHECK_TIMEOUT_MS = 5000;
/** The most of the answer that is read; a real one is a few hundred bytes. */
export const MAX_BODY_BYTES = 16 * 1024;
/** `<dataDir>/<this>`: `{ "enabled": true, "lastCheckedAt": "…" }`. */
export const UPDATE_CHECK_FILE = 'update-check.json';

/** The request the check makes: a `GET` with these and nothing else. */
export interface UpdateRequestInit {
  signal: AbortSignal;
  redirect: 'error';
  headers: { accept: 'application/json' };
}
/** What the check reaches npm with (tests: a fake). */
export type UpdateFetch = (url: string, init: UpdateRequestInit) => Promise<Response>;

/** `StartOptions.updates`: `false` turns the check off for good; a client replaces the real one. */
export type UpdatesOption = false | { fetch: UpdateFetch; timeoutMs?: number };

const StoredState = z.object({ enabled: z.boolean().optional(), lastCheckedAt: z.string().optional() });
const DistTags = z.record(z.string(), z.string());

/** How this install was started, from its launcher's path: under npx's cache, under a global `node_modules`, or neither. */
export function installMethodOf(launcherEntry: string | undefined): InstallMethod {
  if (launcherEntry === undefined) return 'other';
  const path = launcherEntry.replaceAll('\\', '/');
  if (path.includes('/_npx/')) return 'npx';
  return path.includes('/node_modules/ogden-agents/') ? 'global' : 'other';
}

/** `OGDEN_AGENTS_OFFLINE`: any value but empty, `0` or `false`. */
export function isOffline(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.OGDEN_AGENTS_OFFLINE?.trim().toLowerCase();
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
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
  notice(): UpdateNoticeResponse;
  /** Turns the start check on or off; appends the event when it changed. */
  setEnabled(enabled: boolean): UpdateNoticeResponse;
  /** The once-per-start check: nothing when the switch is off, offline, or already run. Never throws. */
  runOnStart(): Promise<void>;
  /** Check now: the user asked, so it runs even with the switch off, but never offline. */
  checkNow(): Promise<UpdateCheckResponse>;
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
  let inFlight: Promise<UpdateCheckResponse['outcome']> | undefined;

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

  const notice = (): UpdateNoticeResponse => {
    const state = read();
    return { current: version, channel, installMethod, enabled: state.enabled !== false, offline, lastCheckedAt: state.lastCheckedAt ?? null, available: offer };
  };
  const announce = (): void => {
    try {
      events.append({ type: 'settings.update_notice_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { available: offer?.version ?? null, enabled: notice().enabled } });
    } catch {
      // The core may be closing; the notice is read again by the next page load.
    }
  };

  async function readTags(): Promise<Record<string, string>> {
    if (options.fetch === undefined) throw new Error('no client');
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
    const response = await options.fetch(DIST_TAGS_URL, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error('body too large');
      }
      chunks.push(value);
    }
    return DistTags.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }

  function run(): Promise<UpdateCheckResponse['outcome']> {
    inFlight ??= (async () => {
      try {
        const tags = await readTags();
        offer = decideUpdate(version, tags);
        write({ ...read(), lastCheckedAt: now().toISOString() });
        announce();
        return offer === null ? 'current' : 'newer';
      } catch (error) {
        // Silent for the user: a code only, never the response.
        log.info('update check did not finish', { code: error instanceof z.ZodError ? 'bad_answer' : ((error as NodeJS.ErrnoException).code ?? (error as Error).name ?? 'unexpected') });
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
