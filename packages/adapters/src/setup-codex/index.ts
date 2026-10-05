/**
 * `setup-codex` (epic 12 entry 6, E12-R4): installing Codex and giving it an
 * OpenAI API key, behind core's `AgentSetupPort`.
 *
 * Codex is API key only (user decision, 2026-10-05): OpenAI's terms don't
 * allow other apps to use ChatGPT subscription sign-in, so there is no
 * sign-in, no sign-out and no login terminal. The port reports itself as
 * signed out and `apiKeyOnly`; core's key rule makes a saved key (or one in
 * the server's environment) the way in, and the card says why plainly.
 *
 * - Install puts the pinned `codex-acp` and its bundled Codex CLI into
 *   `<dataDir>/agents/codex/` with the shared pinned-npm installer.
 * - The key lives in the keychain (core), is checked with a free OpenAI
 *   call, and reaches only Codex's chat process (`CODEX_API_KEY`). Codex keeps
 *   it in memory only (`acp-codex/config.ts`), so no file holds it.
 * - Status reads the data folder only; it never starts Codex.
 */
import { AgentSetupError, type AgentApiKeySupport, type AgentPortStatus, type AgentSetupPort } from '@ogden-agents/core';
import { CODEX, CODEX_AGENT_ID } from '../acp-codex/constants.js';
import { createCodexApiKey, type CodexApiKeyOptions } from './api-key.js';
import { installCodex, installedCodex, removeStaleCodexInstalls, type InstallCodexOptions } from './install.js';

export { CODEX_DESCRIPTOR } from './descriptor.js';
export { BAD_OPENAI_API_KEY, createCodexApiKey, OPENAI_API_KEY_PATTERN, OPENAI_VERIFY_URL, type CodexApiKeyOptions } from './api-key.js';
export {
  CODEX_DIR,
  CODEX_INSTALL_SPEC,
  CODEX_PINS,
  installCodex,
  installedCodex,
  pinnedCodexVersion,
  removeStaleCodexInstalls,
  type InstalledCodex,
  type InstallCodexOptions,
} from './install.js';

/** Why there is no sign-in, in plain words, on Codex's card (user decision, 2026-10-05). */
export const CODEX_NO_SIGN_IN_NOTICE =
  "Codex uses your own OpenAI API key. Signing in with a ChatGPT account isn't supported here, because OpenAI's terms don't allow other apps to use subscription sign-in.";

/** What Install puts where, beside the Install button. */
export const CODEX_INSTALL_NOTE = "Installing puts Codex, about 400 MB, in Ogden Agents' own data folder. Nothing is installed anywhere else.";

const NO_SIGN_IN = `${CODEX} can't be signed in with an account here. Add your OpenAI API key instead.`;
const ALREADY_INSTALLING = `${CODEX} is already being installed.`;

export interface CodexSetupOptions {
  /** The Ogden Agents data folder: Install puts Codex in `agents/codex/`. */
  dataDir: string;
  /** The install's pins, npm and runner (tests: a local fixture lock and a fake runner). */
  install?: Omit<InstallCodexOptions, 'dataDir' | 'onProgress' | 'signal'> | undefined;
  /** The API key check: its `fetch`, timeout or a stub (tests). Default: the real check with the global `fetch`. */
  apiKey?: Omit<CodexApiKeyOptions, 'onDiagnostic'> | undefined;
  /** Step names and codes, for the log. Never a key or npm's output. */
  onDiagnostic?: ((message: string, fields?: Record<string, unknown>) => void) | undefined;
}

export interface CodexSetup extends AgentSetupPort {
  readonly apiKey: AgentApiKeySupport;
  close(): void;
}

export function createCodexSetup(options: CodexSetupOptions): CodexSetup {
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never breaks a setup step.
    }
  };
  let installing: AbortController | undefined;
  removeStaleCodexInstalls(options.dataDir, options.install?.onCleanupError);

  return {
    agentId: CODEX_AGENT_ID,
    displayName: CODEX,
    apiKeyOnly: true,
    apiKey: createCodexApiKey({ ...options.apiKey, onDiagnostic: diagnostic }),

    // Always signed out as an account: only a key (core's rule) makes it ready.
    async status(): Promise<AgentPortStatus> {
      const found = installedCodex(options.dataDir, options.install?.pins);
      const common = { agentId: CODEX_AGENT_ID, displayName: CODEX, apiKeyOnly: true as const, notices: [CODEX_NO_SIGN_IN_NOTICE], installNote: CODEX_INSTALL_NOTE };
      if (found === undefined) return { ...common, install: 'not_installed', version: null, auth: 'needs_sign_in', subscription: 'signed_out' };
      return { ...common, install: 'installed', version: found.version, auth: 'needs_sign_in', subscription: 'signed_out' };
    },

    async install(onProgress) {
      if (installing !== undefined) throw new AgentSetupError(ALREADY_INSTALLING, { details: { step: 'start' } });
      const controller = new AbortController();
      installing = controller;
      try {
        diagnostic('Codex install started', { step: 'install' });
        const installed = await installCodex({ ...options.install, dataDir: options.dataDir, onProgress, signal: controller.signal });
        diagnostic('Codex installed', { step: 'install', version: installed.version });
        return { version: installed.version };
      } finally {
        if (installing === controller) installing = undefined;
      }
    },

    async signIn() {
      throw new AgentSetupError(NO_SIGN_IN, { details: { step: 'sign_in', apiKeyOnly: true } });
    },

    close() {
      installing?.abort();
    },
  };
}

