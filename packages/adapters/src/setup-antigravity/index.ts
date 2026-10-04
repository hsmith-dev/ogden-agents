/**
 * `setup-antigravity` (epic 6 entries 5 and 7): core's `AgentSetupPort` for
 * Antigravity. Entry 5 found a pinned copy and took a key; entry 7 completes
 * it: Install, Uninstall, Google sign-in, sign-out and the key's free check.
 *
 * - Install (only when the user asks): the pinned archive for this computer
 *   (`pins/antigravity-acp.json`) is downloaded into the data folder,
 *   resuming an interrupted download (`download.ts`), checked against its
 *   pinned size and SHA-256, unpacked file by file into a staging folder
 *   (`unzip.ts`: only the pinned files, each checked against its own pinned
 *   SHA-256), started once to read the version its `initialize` reports
 *   (never `--version`, which hangs on Windows), then renamed into
 *   `<dataDir>/agents/antigravity/<version>/` with Ogden's install record.
 *   A copy already there without a record is used when every file matches
 *   its pin and it reports the pinned version. Nothing is installed
 *   globally; spike 6.1: the server itself still writes one helper,
 *   `webm_encoder`, to `~/.gemini/antigravity/bin/`, which the card says.
 * - Status is read from the data folder only, never by running the server.
 *   A computer without a pinned archive (an Intel Mac, Linux or Windows on
 *   ARM) is told so plainly, with no Install button.
 * - Uninstall removes `<dataDir>/agents/antigravity/` and keeps its home
 *   (`antigravity-home`: chats and sign-in) and Ogden's sign-in record.
 * - Google sign-in (`sign-in.ts`; the user accepted Google's terms risk,
 *   2026-10-02) runs the server's own `authenticate oauth-personal`; Ogden
 *   keeps a record that it finished (Antigravity has no status call) and
 *   removes it on sign-out (ACP `logout`). Its credentials are never read or
 *   written by Ogden (AD-16).
 * - Setup processes get the agent allowlist without any API key, plus its
 *   `GEMINI_HOME`; nothing they print is logged.
 * - API key: `GEMINI_API_KEY`, `AIza` + 35, checked with Google for free
 *   (`api-key.ts`); core decides when the chat gets it (story 9.2's rule).
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSetupError, type AgentPlatform, type AgentPortStatus, type AgentSetupPort } from '@ogden-agents/core';
import { renameWithRetry } from '../toolchain-uv/uv-toolchain.js';
import { errorCode } from '../error-code.js';
import { readServerVersion, SETUP_INITIALIZE, startSetupServer, withTimeout, type ServerCommand } from './acp-probe.js';
import { createGeminiApiKey, type GeminiApiKeyOptions } from './api-key.js';
import { ANTIGRAVITY, ANTIGRAVITY_AGENT_ID, ANTIGRAVITY_GOOGLE_LOGIN_ID, ANTIGRAVITY_PINS, GEMINI_API_KEY_ENV, GEMINI_HOME_ENV, type AntigravityArchivePin, type AntigravityPins } from './descriptor.js';
import { DownloadError, discardPartial, downloadVerified, sha256File } from './download.js';
import { antigravityInstallDir, antigravityPin, antigravityVersionDir, currentPlatform, pinnedServer, readInstallRecord, signInRecordPath, writeInstallRecord } from './layout.js';
import { GOOGLE_SIGN_IN_HOSTS, startGoogleSignIn } from './sign-in.js';
import { UnsafeArchiveError, extractPinned } from './unzip.js';

export {
  ANTIGRAVITY,
  ANTIGRAVITY_AGENT_ID,
  ANTIGRAVITY_API_KEY_METHOD_ID,
  ANTIGRAVITY_DESCRIPTOR,
  ANTIGRAVITY_GOOGLE_LOGIN_ID,
  ANTIGRAVITY_MODE_IDS,
  ANTIGRAVITY_PINS,
  GEMINI_API_KEY_ENV,
  GEMINI_HOME_ENV,
  type AntigravityArchivePin,
  type AntigravityFilePin,
  type AntigravityPins,
} from './descriptor.js';
export {
  antigravityInstallDir,
  antigravityPin,
  antigravityVersionDir,
  currentPlatform,
  INSTALL_RECORD,
  pinnedServer,
  readInstallRecord,
  signInRecordPath,
  writeInstallRecord,
  type AntigravityServer,
  type InstallRecord,
} from './layout.js';
export { BAD_GEMINI_KEY, createGeminiApiKey, GEMINI_API_KEY_PATTERN, GEMINI_VERIFY_URL, type GeminiApiKeyOptions } from './api-key.js';
export { DownloadError, downloadVerified, type DownloadOptions } from './download.js';
export { extractPinned, isSafeEntryName, UnsafeArchiveError } from './unzip.js';
export { GOOGLE_SIGN_IN_HOSTS } from './sign-in.js';
export type { ServerCommand } from './acp-probe.js';

/** How long its server may take to answer `initialize` (Windows: about 17 s per process, spike 6.1). */
export const ANTIGRAVITY_SETUP_START_TIMEOUT_MS = 120_000;
/** How long, from the start, the sign-in may take to show its link (the start included). */
export const ANTIGRAVITY_SIGN_IN_URL_TIMEOUT_MS = 150_000;
/** How long a sign-in may stay open before it is stopped. */
export const ANTIGRAVITY_SIGN_IN_TIMEOUT_MS = 10 * 60_000;

const NOT_AVAILABLE = `${ANTIGRAVITY} isn't available on this computer. Google publishes it for Macs with Apple silicon and for 64-bit Intel or AMD Linux and Windows.`;
const NOT_SET_UP = `${ANTIGRAVITY} isn't installed for Ogden Agents on this computer yet.`;
const ALREADY_INSTALLING = `${ANTIGRAVITY} is already being installed.`;
const MISMATCH = "The download didn't match the expected file, so nothing was installed. Try again.";
const NOT_FINISHED = "The download didn't finish. Check your internet connection and try again; it picks up where it stopped.";
const NO_SPACE = `${ANTIGRAVITY} couldn't be saved in Ogden Agents' data folder. Check there is free space, then try again.`;
const NOT_EXPECTED = `The download wasn't the expected ${ANTIGRAVITY} files, so nothing was installed. Try again.`;
const DID_NOT_START = `The downloaded ${ANTIGRAVITY} didn't start on this computer, so nothing was installed.`;
const STOPPED = `The ${ANTIGRAVITY} install was stopped.`;
const IN_USE = `${ANTIGRAVITY} is still running. Close its chats, then try again.`;
const COULD_NOT_SIGN_OUT = `${ANTIGRAVITY} couldn't sign out. Try again.`;
const NO_LOGOUT = `${ANTIGRAVITY} doesn't offer signing out from other apps.`;
export const ANTIGRAVITY_SIGN_IN_NOTE =
  "Finish signing in with Google in a browser on this computer. Google's Antigravity terms say that using it through apps Google doesn't make can get your Antigravity and Gemini CLI accounts suspended; that covers a Gemini API key too.";
const HELPER_NOTE = `${ANTIGRAVITY} also puts one helper file in ~/.gemini/antigravity/bin on this computer, which Uninstall leaves.`;

/** What Install downloads, in plain words. */
const installNote = (pin: AntigravityArchivePin) => `Downloads about ${Math.max(1, Math.round(pin.size / 1_000_000))} MB from Google into Ogden Agents' data folder. ${HELPER_NOTE}`;
const INSTALLED_NOTE = `Uninstall keeps your ${ANTIGRAVITY} chats and sign-in. ${HELPER_NOTE}`;

/** Prefixes of the work folders an install uses inside the install folder. */
const STAGING_PREFIX = '.staging-';
const ASIDE_PREFIX = '.previous-';
const DOWNLOADS = '.download';

export interface AntigravitySetupOptions {
  /** The Ogden Agents data folder: the pinned copy goes in `agents/antigravity/`, its home in `agents/antigravity-home`. */
  dataDir: string;
  /** Default: this computer's. */
  platform?: AgentPlatform;
  /** Default: the shipped pins (tests: a fixture archive's). */
  pins?: Readonly<AntigravityPins>;
  /**
   * The agent environment allowlist (AD-16), read at each run; any Gemini or
   * Google key in it is dropped. Default: `PATH`, the home and temp folders,
   * and Windows' system folders from this process.
   */
  env?: () => Readonly<Record<string, string>>;
  /** Its `GEMINI_HOME`. Default `<dataDir>/agents/antigravity-home` (the folder its chats use, `agentHomeDir`). */
  homeDir?: string;
  /** The download's `fetch` (tests: a local server's archive). Default: the global one. */
  fetch?: typeof fetch;
  /** How an installed server file is started (tests: Node and the fake agent). Default: the file itself. */
  serverCommand?: (server: ServerCommand) => ServerCommand;
  apiKey?: Omit<GeminiApiKeyOptions, 'onDiagnostic'>;
  timeouts?: { startMs?: number; urlMs?: number; signInMs?: number; idleMs?: number; backoffMs?: number };
  /** Sign-in URL hosts. Default {@link GOOGLE_SIGN_IN_HOSTS}. */
  signInHosts?: readonly string[];
  /** Step names, codes and sizes, for the log. Never a URL, the server's output or a key. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
  /** Told about leftovers that could not be removed; they never change an outcome. */
  onCleanupError?: (error: unknown) => void;
}

export interface AntigravitySetup extends AgentSetupPort {
  /** Stops a running install and sign-in (server stop). Safe to call more than once. */
  close(): void;
}

const DEFAULT_ENV_NAMES = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LANG', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'PATHEXT'];
const defaultEnv = (): Record<string, string> =>
  Object.fromEntries(DEFAULT_ENV_NAMES.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]!]])));

/** `env` without any Gemini or Google key, or a `GEMINI_HOME` of its own, whatever their case. */
function setupEnvOf(env: Readonly<Record<string, string>>): Record<string, string> {
  const drop = new Set([GEMINI_API_KEY_ENV, 'GOOGLE_API_KEY', GEMINI_HOME_ENV]);
  return Object.fromEntries(Object.entries(env).filter(([name]) => !drop.has(name.toUpperCase())));
}

export function createAntigravitySetup(options: AntigravitySetupOptions): AntigravitySetup {
  const platform = options.platform ?? currentPlatform();
  const pins = options.pins ?? ANTIGRAVITY_PINS;
  const installDir = antigravityInstallDir(options.dataDir);
  const versionDir = antigravityVersionDir(options.dataDir, pins);
  const home = options.homeDir ?? join(options.dataDir, 'agents', `${ANTIGRAVITY_AGENT_ID}-home`);
  const startMs = options.timeouts?.startMs ?? ANTIGRAVITY_SETUP_START_TIMEOUT_MS;
  const toServer = options.serverCommand ?? ((server: ServerCommand) => server);
  const onCleanupError = options.onCleanupError ?? (() => {});
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never changes an outcome.
    }
  };
  const base = { agentId: ANTIGRAVITY_AGENT_ID, displayName: ANTIGRAVITY } as const;
  let installing: AbortController | undefined;
  /** Stops the sign-in under way, from the moment its server is spawned. */
  let cancelSignIn: (() => Promise<void>) | undefined;
  /** Setup servers running now (a version check, a sign-out), so `close` stops them. */
  const live = new Set<{ stop(): void }>();
  const REMOVING_PREFIX = `.${ANTIGRAVITY_AGENT_ID}-removing-`;

  /** The server's environment for setup: the allowlist without keys, plus its home (made owner-only). */
  const setupEnv = (): Record<string, string> => {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    return { ...setupEnvOf((options.env ?? defaultEnv)()), [GEMINI_HOME_ENV]: home };
  };

  const signedIn = () => existsSync(signInRecordPath(options.dataDir));

  const removeQuietly = (path: string) => {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      onCleanupError(error);
    }
  };

  /** Names in `dir`, or none when it can't be read. */
  const namesIn = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };

  /**
   * Removes what a crashed install or uninstall left behind: staging and
   * aside folders, other versions than the pinned one (after a reviewed pin
   * bump), and an uninstall's renamed folder that could not be removed.
   */
  const removeLeftovers = () => {
    for (const entry of namesIn(installDir)) {
      const otherVersion = /^\d+\.\d+\.\d+$/.test(entry) && entry !== pins.version;
      if (entry.startsWith(STAGING_PREFIX) || entry.startsWith(ASIDE_PREFIX) || otherVersion) removeQuietly(join(installDir, entry));
    }
    for (const entry of namesIn(join(options.dataDir, 'agents'))) if (entry.startsWith(REMOVING_PREFIX)) removeQuietly(join(options.dataDir, 'agents', entry));
  };

  /** Starts the server file in `dir` once and checks it reports the pinned version. */
  const checkVersion = async (dir: string, pin: AntigravityArchivePin): Promise<string> => {
    let reported: string | undefined;
    try {
      reported = await readServerVersion({
        server: toServer({ command: join(dir, pin.binary), args: [...pin.args] }),
        env: setupEnv(),
        cwd: home,
        timeoutMs: startMs,
        track: (server) => {
          live.add(server);
          return () => live.delete(server);
        },
      });
    } catch (error) {
      diagnostic('Antigravity did not answer initialize', { step: 'initialize', code: errorCode(error, 'unknown') });
      throw new AgentSetupError(DID_NOT_START, { cause: error, details: { step: 'initialize' } });
    }
    if (reported !== pins.version) {
      diagnostic('Antigravity reported another version', { step: 'initialize', reported: typeof reported === 'string' && /^[\w.+-]{1,40}$/.test(reported) ? reported : 'unreadable' });
      throw new AgentSetupError(DID_NOT_START, { details: { step: 'initialize', expected: pins.version } });
    }
    return reported;
  };

  const recordOf = (pin: AntigravityArchivePin, reportedVersion: string) => ({
    version: pins.version,
    platform,
    reportedVersion,
    files: Object.fromEntries(Object.entries(pin.files).map(([name, file]) => [name, file.size])),
  });

  /** A copy already in the version folder without Ogden's record: used when every file matches its pin and it reports the pinned version. */
  const adoptExisting = async (pin: AntigravityArchivePin, step: (name: string) => void): Promise<boolean> => {
    if (!existsSync(versionDir) || readInstallRecord(versionDir) !== undefined) return false;
    step(`Checking the ${ANTIGRAVITY} already in Ogden Agents' data folder`);
    for (const [name, file] of Object.entries(pin.files)) {
      const path = join(versionDir, name);
      try {
        const stat = statSync(path);
        if (!stat.isFile() || stat.size !== file.size || (await sha256File(path)) !== file.sha256) return false;
      } catch {
        return false;
      }
    }
    const reported = await checkVersion(versionDir, pin).catch(() => undefined);
    if (reported === undefined) return false;
    writeInstallRecord(versionDir, recordOf(pin, reported));
    diagnostic('Antigravity copy already in the data folder adopted', { step: 'adopt', version: reported });
    return true;
  };

  /** Moves `staging` into the version folder, setting aside (then removing) what was there. */
  const moveIntoPlace = async (staging: string) => {
    const aside = join(installDir, `${ASIDE_PREFIX}${randomBytes(4).toString('hex')}`);
    const had = existsSync(versionDir);
    if (had) await renameWithRetry(versionDir, aside);
    try {
      await renameWithRetry(staging, versionDir);
    } catch (error) {
      if (had) await renameWithRetry(aside, versionDir).catch(onCleanupError);
      throw new AgentSetupError(NO_SPACE, { cause: error, details: { step: 'move', code: errorCode(error, 'unknown') } });
    }
    if (had) removeQuietly(aside);
  };

  const failure = (error: unknown, signal: AbortSignal): AgentSetupError => {
    if (error instanceof AgentSetupError) return error;
    if (signal.aborted) return new AgentSetupError(STOPPED, { details: { step: 'stopped' } });
    if (error instanceof DownloadError) {
      const message = error.kind === 'mismatch' ? MISMATCH : error.kind === 'disk' ? NO_SPACE : NOT_FINISHED;
      return new AgentSetupError(message, { cause: error, details: { step: 'download', kind: error.kind, ...error.details } });
    }
    if (error instanceof UnsafeArchiveError) return new AgentSetupError(NOT_EXPECTED, { cause: error, details: { step: 'unpack', reason: error.message } });
    return new AgentSetupError(NO_SPACE, { cause: error, details: { step: 'unpack', code: errorCode(error, 'unknown') } });
  };

  const notInstalled = (): AgentPortStatus => {
    const pin = antigravityPin(platform, pins);
    if (pin === undefined) return { ...base, install: 'not_installed', version: null, auth: 'needs_sign_in', reason: NOT_AVAILABLE, canInstall: false, subscription: 'unknown' };
    return { ...base, install: 'not_installed', version: null, auth: 'needs_sign_in', installNote: installNote(pin), subscription: 'unknown' };
  };

  const installedServer = () => pinnedServer(options.dataDir, platform, pins);

  return {
    ...base,
    apiKey: createGeminiApiKey({ ...options.apiKey, onDiagnostic: diagnostic }),

    async status(): Promise<AgentPortStatus> {
      const server = installedServer();
      if (server === undefined) return notInstalled();
      const shared = {
        ...base,
        install: 'installed' as const,
        version: server.version,
        canUninstall: true,
        // Windows: the server opens the browser itself (no `BROWSER` helper there), so the page shows a link.
        signInTab: process.platform === 'win32' ? ('agent' as const) : ('page' as const),
        signInTakesCode: false,
        installNote: INSTALLED_NOTE,
        signInNote: ANTIGRAVITY_SIGN_IN_NOTE,
      };
      if (signedIn()) return { ...shared, auth: 'signed_in', method: 'subscription', canSignOut: true, subscription: 'signed_in' };
      return { ...shared, auth: 'needs_sign_in', subscription: 'signed_out' };
    },

    async install(onProgress) {
      const pin = antigravityPin(platform, pins);
      if (pin === undefined) throw new AgentSetupError(NOT_AVAILABLE, { details: { step: 'start', platform } });
      if (installing !== undefined) throw new AgentSetupError(ALREADY_INSTALLING, { details: { step: 'start' } });
      const controller = new AbortController();
      installing = controller;
      const step = (name: string, percent: number | null = null) => onProgress({ step: name, percent });
      let staging: string | undefined;
      try {
        mkdirSync(installDir, { recursive: true, mode: 0o700 });
        removeLeftovers();
        if (await adoptExisting(pin, step)) return { version: installedServer()?.version ?? pins.version };

        const downloads = join(installDir, DOWNLOADS);
        mkdirSync(downloads, { recursive: true, mode: 0o700 });
        const partFile = join(downloads, `${pins.version}-${platform}.zip.part`);
        const downloading = `Downloading ${ANTIGRAVITY}`;
        diagnostic('Antigravity install started', { step: 'download', version: pins.version, platform, bytes: pin.size });
        await downloadVerified({
          url: pin.url,
          size: pin.size,
          sha256: pin.sha256,
          partFile,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.timeouts?.idleMs === undefined ? {} : { idleTimeoutMs: options.timeouts.idleMs }),
          ...(options.timeouts?.backoffMs === undefined ? {} : { backoffMs: options.timeouts.backoffMs }),
          signal: controller.signal,
          onProgress: (bytes, total) => step(downloading, total === 0 ? null : Math.floor((bytes / total) * 100)),
        });
        if (controller.signal.aborted) throw new AgentSetupError(STOPPED);

        step(`Unpacking ${ANTIGRAVITY}`);
        staging = mkdtempSync(join(installDir, STAGING_PREFIX));
        if (process.platform !== 'win32') chmodSync(staging, 0o755);
        try {
          await extractPinned(partFile, staging, pin.files);
        } catch (error) {
          // An archive that isn't what the pin says is never resumed or unpacked again.
          if (error instanceof UnsafeArchiveError) await discardPartial(partFile).catch(() => {});
          throw error;
        }
        if (controller.signal.aborted) throw new AgentSetupError(STOPPED);

        step(`Checking ${ANTIGRAVITY}`);
        const reported = await checkVersion(staging, pin);
        writeInstallRecord(staging, recordOf(pin, reported));
        await moveIntoPlace(staging);
        staging = undefined;
        removeLeftovers();
        await discardPartial(partFile).catch(onCleanupError);
        diagnostic('Antigravity installed', { step: 'done', version: reported });
        return { version: reported };
      } catch (error) {
        const refusal = failure(error, controller.signal);
        diagnostic('Antigravity install failed', { ...refusal.details });
        throw refusal;
      } finally {
        if (staging !== undefined) removeQuietly(staging);
        if (installing === controller) installing = undefined;
      }
    },

    async uninstall() {
      if (installing !== undefined) throw new AgentSetupError(`${ANTIGRAVITY} is being installed. Try again when it finishes.`);
      await cancelSignIn?.().catch(() => {});
      if (!existsSync(installDir)) {
        removeLeftovers();
        return;
      }
      // Renamed first, so a copy in use (Windows) fails before anything is half-removed.
      // A sibling, removed now or, if the OS still holds a file, by the next install or uninstall.
      const removing = join(options.dataDir, 'agents', `${REMOVING_PREFIX}${randomBytes(4).toString('hex')}`);
      try {
        await renameWithRetry(installDir, removing);
      } catch (error) {
        diagnostic('Antigravity could not be uninstalled', { step: 'uninstall', code: errorCode(error, 'unknown') });
        throw new AgentSetupError(IN_USE, { cause: error, details: { step: 'uninstall', code: errorCode(error, 'unknown') } });
      }
      removeQuietly(removing);
      diagnostic('Antigravity uninstalled', { step: 'uninstall' });
    },

    async signIn() {
      const server = installedServer();
      if (server === undefined) throw new AgentSetupError(NOT_SET_UP, { details: { step: 'start' } });
      await cancelSignIn?.().catch(() => {});
      let mine: (() => Promise<void>) | undefined;
      const handle = await startGoogleSignIn({
        workRoot: join(options.dataDir, 'agents'),
        onStarted: (cancel) => {
          mine = cancel;
          cancelSignIn = cancel;
        },
        server: toServer({ command: server.command, args: server.args }),
        env: setupEnv(),
        cwd: home,
        platform: process.platform,
        methodId: ANTIGRAVITY_GOOGLE_LOGIN_ID,
        displayName: ANTIGRAVITY,
        hosts: options.signInHosts ?? GOOGLE_SIGN_IN_HOSTS,
        startTimeoutMs: startMs,
        urlTimeoutMs: options.timeouts?.urlMs ?? ANTIGRAVITY_SIGN_IN_URL_TIMEOUT_MS,
        signInTimeoutMs: options.timeouts?.signInMs ?? ANTIGRAVITY_SIGN_IN_TIMEOUT_MS,
        onSignedIn: () => {
          mkdirSync(join(options.dataDir, 'agents'), { recursive: true, mode: 0o700 });
          // Ogden's own record that the sign-in finished: the method and when, no secret.
          writeFileSync(signInRecordPath(options.dataDir), `${JSON.stringify({ method: ANTIGRAVITY_GOOGLE_LOGIN_ID, at: new Date().toISOString() })}\n`, { mode: 0o600 });
        },
        diagnostic,
      });
      void handle.done.then(() => {
        if (cancelSignIn === mine) cancelSignIn = undefined;
      });
      return handle;
    },

    async signOut() {
      await cancelSignIn?.().catch(() => {});
      const installed = installedServer();
      if (installed === undefined) throw new AgentSetupError(NOT_SET_UP, { details: { step: 'sign_out' } });
      const server = startSetupServer({ server: toServer({ command: installed.command, args: installed.args }), env: setupEnv(), cwd: home });
      live.add(server);
      try {
        const exited = server.exited.then((code) => {
          throw Object.assign(new Error('the server exited'), { code: `exit_${code ?? 'signal'}` });
        });
        exited.catch(() => {});
        const init = await withTimeout(Promise.race([server.connection.initialize(SETUP_INITIALIZE), exited]), startMs, 'initialize');
        if (init.agentCapabilities?.auth?.logout == null) throw new AgentSetupError(NO_LOGOUT, { details: { step: 'sign_out' } });
        await withTimeout(Promise.race([server.connection.logout({}), exited]), startMs, 'logout');
      } catch (error) {
        diagnostic('Antigravity sign-out failed', { step: 'sign_out', code: errorCode(error, 'unknown') });
        if (error instanceof AgentSetupError) throw error;
        throw new AgentSetupError(COULD_NOT_SIGN_OUT, { cause: error, details: { step: 'sign_out' } });
      } finally {
        server.stop();
        live.delete(server);
      }
      try {
        unlinkSync(signInRecordPath(options.dataDir));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AgentSetupError(COULD_NOT_SIGN_OUT, { cause: error, details: { step: 'sign_out' } });
      }
      diagnostic('Antigravity signed out', { step: 'sign_out' });
    },

    close() {
      installing?.abort();
      installing = undefined;
      void cancelSignIn?.().catch(() => {});
      cancelSignIn = undefined;
      for (const server of live) server.stop();
      live.clear();
    },
  };
}
