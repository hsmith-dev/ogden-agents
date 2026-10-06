/**
 * `setup-grok` (epic 12 entry 8, E12-R5): installing Grok and giving it an
 * xAI API access token, behind core's `AgentSetupPort`.
 *
 * Grok is an xAI API access token only (user decision, 2026-10-05): there is
 * no account sign-in ("Sign in with Grok" is never offered or called), no
 * sign-out and no login terminal. The port reports itself as signed out and
 * `apiKeyOnly`; core's key rule makes a saved token (or one in the server's
 * environment) the way in, so Grok is off by default (listed, but a chat is
 * refused) until a token is added, and the card says why in every state.
 *
 * - Install puts the pinned `@xai-official/grok` and this computer's checked
 *   binary into `<dataDir>/agents/grok/` with the shared pinned-npm installer
 *   (`install.ts`: npm's launcher and postinstall never run, `~/.grok` is
 *   never touched) and refuses a version that no longer takes a token.
 * - The token lives in the keychain (core), is checked with a free xAI call,
 *   and reaches only Grok's chat process (`XAI_API_KEY`).
 * - Status reads the data folder only; it never starts Grok.
 */
import { AgentSetupError, type AgentApiKeySupport, type AgentPortStatus, type AgentSetupPort } from '@ogden-agents/core';
import { GROK, GROK_AGENT_ID, GROK_KEY_NAME } from '../acp-grok/constants.js';
import { createGrokApiKey, type GrokApiKeyOptions } from './api-key.js';
import { installedGrok, installGrok, removeStaleGrokInstalls, type InstallGrokOptions } from './install.js';

export { GROK_DESCRIPTOR, GROK_PROJECT_FILES } from './descriptor.js';
export { BAD_XAI_API_KEY, createGrokApiKey, XAI_API_KEY_PATTERN, XAI_VERIFY_URL, type GrokApiKeyOptions } from './api-key.js';
export { grokAcceptsToken, TOKEN_PROBE_TIMEOUT_MS } from './token-probe.js';
export {
  decompressBinary,
  GROK_CHECK_RECORD_SUFFIX,
  GROK_CHECKED_DIR,
  GROK_DIR,
  GROK_INSTALL_SPEC,
  GROK_MAX_BINARY_BYTES,
  GROK_PINS,
  grokBinaryUnchanged,
  grokInstallSpec,
  installedGrok,
  installGrok,
  NO_TOKEN_METHOD,
  pinnedGrokVersion,
  removeStaleGrokInstalls,
  type GrokBinaryHashes,
  type GrokTokenProbe,
  type InstalledGrok,
  type InstallGrokOptions,
} from './install.js';

/**
 * Why there is no sign-in, in plain words, on Grok's card in every state (user decision, 2026-10-05). The reason xAI's
 * terms give could not be read (the page refuses automated reading; deferred-work), so the card claims only what is
 * known: Grok works with the token and nothing else here.
 */
export const GROK_NO_SIGN_IN_NOTICE = "Grok works with your own xAI API access token only. Signing in with an account isn't supported here.";

/** What Grok's key is called on the card. */
export { GROK_KEY_NAME };

/** What Install puts where, beside the Install button. */
export const GROK_INSTALL_NOTE = "Installing puts Grok, about 200 MB, in Ogden Agents' own data folder. Nothing is installed anywhere else.";

const NO_SIGN_IN = `${GROK} can't be signed in with an account here. Add your xAI API access token instead.`;
const ALREADY_INSTALLING = `${GROK} is already being installed.`;

export interface GrokSetupOptions {
  /** The Ogden Agents data folder: Install puts Grok in `agents/grok/`. */
  dataDir: string;
  /** The install's pins, npm, binary hashes and token probe (tests: a local fixture lock, a fake runner and stubs). */
  install?: Omit<InstallGrokOptions, 'dataDir' | 'onProgress' | 'signal'> | undefined;
  /** The token check: its `fetch`, timeout or a stub (tests). Default: the real check with the global `fetch`. */
  apiKey?: Omit<GrokApiKeyOptions, 'onDiagnostic'> | undefined;
  /** Step names and codes, for the log. Never a token or npm's output. */
  onDiagnostic?: ((message: string, fields?: Record<string, unknown>) => void) | undefined;
}

export interface GrokSetup extends AgentSetupPort {
  readonly apiKey: AgentApiKeySupport;
  close(): void;
}

export function createGrokSetup(options: GrokSetupOptions): GrokSetup {
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never breaks a setup step.
    }
  };
  let installing: AbortController | undefined;
  removeStaleGrokInstalls(options.dataDir, options.install?.onCleanupError);

  return {
    agentId: GROK_AGENT_ID,
    displayName: GROK,
    apiKeyOnly: true,
    apiKey: createGrokApiKey({ ...options.apiKey, onDiagnostic: diagnostic }),

    // Always signed out as an account: only a token (core's rule) makes it ready.
    async status(): Promise<AgentPortStatus> {
      const found = installedGrok(options.dataDir, options.install?.pins);
      const common = { agentId: GROK_AGENT_ID, displayName: GROK, apiKeyOnly: true as const, apiKeyName: GROK_KEY_NAME, notices: [GROK_NO_SIGN_IN_NOTICE], installNote: GROK_INSTALL_NOTE };
      if (found === undefined) return { ...common, install: 'not_installed', version: null, auth: 'needs_sign_in', subscription: 'signed_out' };
      return { ...common, install: 'installed', version: found.version, auth: 'needs_sign_in', subscription: 'signed_out' };
    },

    async install(onProgress) {
      if (installing !== undefined) throw new AgentSetupError(ALREADY_INSTALLING, { details: { step: 'start' } });
      const controller = new AbortController();
      installing = controller;
      try {
        diagnostic('Grok install started', { step: 'install' });
        const installed = await installGrok({ ...options.install, dataDir: options.dataDir, onProgress, signal: controller.signal });
        diagnostic('Grok installed', { step: 'install', version: installed.version });
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
