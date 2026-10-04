/**
 * `setup-antigravity` (epic 6 entry 5): core's `AgentSetupPort` for
 * Antigravity, as far as entry 5 goes. It finds a pinned copy already in the
 * data folder (`layout.ts`) and takes a Gemini API key; downloading the
 * archive and signing in with Google are entry 7's, which completes this
 * port without touching `start.ts` (the wiring slot).
 *
 * - Status is read from the data folder only, never by running the server.
 * - Until entry 7 there is no Google sign-in, so an installed copy reports
 *   its subscription as signed out: core's precedence rule (story 9.2) then
 *   gives its chat process the key, saved or from the environment, under
 *   `GEMINI_API_KEY`, and a chat without one is refused `agent_signed_out`.
 * - It never reads or writes Antigravity's own settings or credentials
 *   (AD-16), and never reaches the network: the key's free check is entry 7's,
 *   so a key saved here is kept as `unchecked`.
 */
import { AgentSetupError, type AgentPlatform, type AgentPortStatus, type AgentSetupPort } from '@ogden-agents/core';
import { ANTIGRAVITY, ANTIGRAVITY_AGENT_ID, ANTIGRAVITY_PINS, GEMINI_API_KEY_ENV } from './descriptor.js';
import { antigravityPin, currentPlatform, pinnedServer } from './layout.js';

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
  type AntigravityPins,
} from './descriptor.js';
export { antigravityInstallDir, antigravityPin, currentPlatform, pinnedServer, type AntigravityServer } from './layout.js';

/** A Gemini API key: `AIza` and 35 more letters, digits, `_` or `-`. */
export const GEMINI_API_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/;

const NOT_YET_INSTALL = `Installing ${ANTIGRAVITY} from Ogden Agents comes in a later version.`;
const NOT_YET_SIGN_IN = `Signing in to ${ANTIGRAVITY} with Google comes in a later version. Use a Gemini API key for now.`;
const NO_PIN = `${ANTIGRAVITY} isn't available for this computer's system yet.`;
const BAD_KEY = "That doesn't look like a Gemini API key. It starts with AIza.";

export interface AntigravitySetupOptions {
  /** The Ogden Agents data folder, where the pinned copy is looked for. */
  dataDir: string;
  /** Default: this computer's. */
  platform?: AgentPlatform;
}

export function createAntigravitySetup(options: AntigravitySetupOptions): AgentSetupPort {
  const platform = options.platform ?? currentPlatform();
  const base = { agentId: ANTIGRAVITY_AGENT_ID, displayName: ANTIGRAVITY } as const;
  return {
    ...base,

    async status(): Promise<AgentPortStatus> {
      const server = pinnedServer(options.dataDir, platform);
      if (server === undefined) {
        return {
          ...base,
          install: 'not_installed',
          version: null,
          auth: 'needs_sign_in',
          ...(antigravityPin(platform) === undefined ? { reason: NO_PIN } : {}),
          subscription: 'unknown',
        };
      }
      return { ...base, install: 'installed', version: server.version, auth: 'needs_sign_in', reason: NOT_YET_SIGN_IN, subscription: 'signed_out' };
    },

    async install() {
      throw new AgentSetupError(NOT_YET_INSTALL, { details: { step: 'start', version: ANTIGRAVITY_PINS.version } });
    },

    async signIn() {
      throw new AgentSetupError(NOT_YET_SIGN_IN, { details: { step: 'start' } });
    },

    apiKey: {
      envName: GEMINI_API_KEY_ENV,
      check: (value) => (GEMINI_API_KEY_PATTERN.test(value) ? undefined : BAD_KEY),
      // The free check against Google is entry 7's: never the network here.
      verify: async () => 'unchecked',
    },
  };
}
