/**
 * `setup-local` (epic 14, story 14.2): core's `AgentSetupPort` for the Local
 * model. There is no account and no key to set up: Install puts the pinned
 * OpenCode (the harness the Local model runs through) in the data folder,
 * and the endpoint it talks to is the user's, set up in Settings (story 14.4).
 *
 * - Install (only when the user asks): `install.ts`; nothing is installed
 *   anywhere else, and nothing is run.
 * - Status reads the data folder only, never starts the harness.
 * - Uninstall removes `<dataDir>/agents/local/` and keeps its home
 *   (`local-home`: its chat database, in plain text, and its config).
 * - There is no sign-in.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSetupError, type AgentPlatform, type AgentPortStatus, type AgentSetupPort } from '@ogden-agents/core';
import { LOCAL, LOCAL_AGENT_ID, OPENCODE } from '../acp-opencode/constants.js';
import { errorCode } from '../error-code.js';
import { renameWithRetry } from '../toolchain-uv/uv-toolchain.js';
import { LOCAL_PINS, type LocalPins } from './descriptor.js';
import { ALREADY_INSTALLING, NOT_AVAILABLE, installLocal, removeLocalLeftovers } from './install.js';
import { currentPlatform, installedOpenCode, localInstallDir, localPin } from './layout.js';

export { LOCAL_DESCRIPTOR, LOCAL_PINS, type LocalArchivePin, type LocalFilePin, type LocalPins, type LocalRipgrepPin } from './descriptor.js';
export { LOCAL_INSTALL_RECORD, RIPGREP_FILE, installedOpenCode, localInstallDir, localPin, localVersionDir, readLocalInstallRecord, ripgrepPin, writeLocalInstallRecord, type LocalInstallRecord, type InstalledOpenCode } from './layout.js';
export { installLocal, removeLocalLeftovers, type InstallLocalOptions } from './install.js';
export { extractPinnedTarGz } from './untar.js';

/** The privacy statement the card shows in every state (user decision, 2026-10-05). Plain words, no secrets. */
export const LOCAL_PRIVACY_NOTICE = `Nothing leaves this computer except to the server you set up. Your chats with the ${LOCAL} are saved in plain text in Ogden Agents' data folder.`;

/** What Install puts where, beside the Install button. */
export const LOCAL_INSTALL_NOTE = `Installing downloads ${OPENCODE}, about 60 MB, from its official releases on GitHub into Ogden Agents' own data folder. Nothing is installed anywhere else.`;

const INSTALLED_NOTE = `Uninstall keeps your ${LOCAL} chats and settings.`;
const NO_SIGN_IN = `The ${LOCAL} needs no account and no sign in.`;
const IN_USE = `${LOCAL} is still running. Close its chats, then try again.`;
const REMOVING_PREFIX = `.${LOCAL_AGENT_ID}-removing-`;

export interface LocalSetupOptions {
  /** The Ogden Agents data folder: Install puts the harness in `agents/local/`. */
  dataDir: string;
  /** Default: this computer's. */
  platform?: AgentPlatform | undefined;
  /** Default: the shipped pins (tests: a fixture archive's). */
  pins?: Readonly<LocalPins> | undefined;
  /** The download's `fetch` (tests: a local server's archive). Default: the global one. */
  fetch?: typeof fetch | undefined;
  idleTimeoutMs?: number | undefined;
  backoffMs?: number | undefined;
  /** Step names and codes, for the log. Never a URL or a response. */
  onDiagnostic?: ((message: string, fields?: Record<string, unknown>) => void) | undefined;
  /** Told about leftovers that could not be removed; they never change an outcome. */
  onCleanupError?: ((error: unknown) => void) | undefined;
}

export interface LocalSetup extends AgentSetupPort {
  close(): void;
}

export function createLocalSetup(options: LocalSetupOptions): LocalSetup {
  const platform = options.platform ?? currentPlatform();
  const pins = options.pins ?? LOCAL_PINS;
  const onCleanupError = options.onCleanupError ?? (() => {});
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never changes an outcome.
    }
  };
  const base = { agentId: LOCAL_AGENT_ID, displayName: LOCAL, notices: [LOCAL_PRIVACY_NOTICE] };
  let installing: AbortController | undefined;
  removeLocalLeftovers(options.dataDir, pins, onCleanupError);
  // An uninstall the OS was still holding files for is finished by the next start.
  const agentsDir = join(options.dataDir, 'agents');
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir)) {
      if (!entry.startsWith(REMOVING_PREFIX)) continue;
      try {
        rmSync(join(agentsDir, entry), { recursive: true, force: true });
      } catch (error) {
        onCleanupError(error);
      }
    }
  }

  return {
    agentId: LOCAL_AGENT_ID,
    displayName: LOCAL,

    // There is no account: an installed Local model counts as signed in, so only a missing install refuses a chat.
    async status(): Promise<AgentPortStatus> {
      const found = installedOpenCode(options.dataDir, platform, pins);
      if (found !== undefined) return { ...base, install: 'installed', version: found.version, auth: 'signed_in', canUninstall: true, installNote: INSTALLED_NOTE, subscription: 'signed_in' };
      if (localPin(platform, pins) === undefined) return { ...base, install: 'not_installed', version: null, auth: 'needs_sign_in', reason: NOT_AVAILABLE, canInstall: false, subscription: 'unknown' };
      return { ...base, install: 'not_installed', version: null, auth: 'needs_sign_in', installNote: LOCAL_INSTALL_NOTE, subscription: 'unknown' };
    },

    async install(onProgress) {
      if (installing !== undefined) throw new AgentSetupError(ALREADY_INSTALLING, { details: { step: 'start' } });
      const controller = new AbortController();
      installing = controller;
      try {
        diagnostic('Local model install started', { step: 'install', platform });
        const installed = await installLocal({
          dataDir: options.dataDir,
          platform,
          pins,
          onProgress,
          signal: controller.signal,
          onCleanupError,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
          ...(options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs }),
        });
        diagnostic('Local model installed', { step: 'install', version: installed.version });
        return { version: installed.version };
      } catch (error) {
        if (error instanceof AgentSetupError) diagnostic('Local model install failed', { ...error.details });
        throw error;
      } finally {
        if (installing === controller) installing = undefined;
      }
    },

    async signIn() {
      throw new AgentSetupError(NO_SIGN_IN, { details: { step: 'sign_in', noAccount: true } });
    },

    async uninstall() {
      if (installing !== undefined) throw new AgentSetupError(`${LOCAL} is being installed. Try again when it finishes.`);
      const installDir = localInstallDir(options.dataDir);
      if (!existsSync(installDir)) {
        removeLocalLeftovers(options.dataDir, pins, onCleanupError);
        return;
      }
      // Renamed first, so a copy in use (Windows) fails before anything is half removed.
      const removing = join(options.dataDir, 'agents', `${REMOVING_PREFIX}${randomBytes(4).toString('hex')}`);
      try {
        await renameWithRetry(installDir, removing);
      } catch (error) {
        diagnostic('Local model could not be uninstalled', { step: 'uninstall', code: errorCode(error, 'unknown') });
        throw new AgentSetupError(IN_USE, { cause: error, details: { step: 'uninstall', code: errorCode(error, 'unknown') } });
      }
      try {
        rmSync(removing, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        onCleanupError(error);
      }
      diagnostic('Local model uninstalled', { step: 'uninstall' });
    },

    close() {
      installing?.abort();
    },
  };
}
export { ripgrepCacheFile, seedRipgrep } from './ripgrep.js';
