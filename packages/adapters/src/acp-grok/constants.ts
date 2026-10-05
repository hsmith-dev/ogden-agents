/**
 * Grok's names, as a leaf module (epic 12 entry 4): the chat adapter, its
 * descriptor and its install all read them, and the chat adapter reads the
 * descriptor, so they live apart to keep imports acyclic (as Codex's
 * `constants.ts`). The facts are spike 12.2's (`@xai-official/grok` 1.0.49,
 * probed on macOS, Linux and Windows) and the follow-up probes of epic 12
 * entry 7 on the pinned macOS binary with a dummy key and no model turn.
 */
import type { AgentPlatform } from '@ogden-agents/core';

/** Grok's stable agent id. */
export const GROK_AGENT_ID = 'grok';

/** The product name the UI shows. */
export const GROK = 'Grok';

/** The npm package that carries Grok Build (registry id `grok-build`); the lock pins it and its six platform packages. */
export const GROK_PACKAGE = '@xai-official/grok';

/** The scope and prefix of the platform packages (`@xai-official/grok-<os>-<arch>`), each with the binary brotli compressed. */
export const GROK_BINARY_SCOPE = '@xai-official';
export const GROK_BINARY_PREFIX = 'grok-';

/** The variable that moves Grok's settings, sign-in token, sessions and logs into Ogden's data folder (spike 12.2). */
export const GROK_HOME_ENV = 'GROK_HOME';

/**
 * The variables Grok reads an xAI API access token from: the first is the one
 * Ogden sets in Grok's chat process, both are kept out of every other process (AD-16).
 */
export const GROK_API_KEY_ENV = 'XAI_API_KEY';
export const GROK_CODE_API_KEY_ENV = 'GROK_CODE_XAI_API_KEY';

/** Turns off Grok's self-update, so the binary Ogden checked is the one that runs (documented for agent SDKs). */
export const GROK_DISABLE_AUTOUPDATER_ENV = 'GROK_DISABLE_AUTOUPDATER';

/**
 * Grok's own folder trust (probed on 1.0.49): until a folder is in its
 * trust store, it silently skips the project's hooks, MCP servers, instructions,
 * skills and permission rules. Ogden's own per-project trust has already been
 * given before a Grok chat starts (`needsProjectTrust`), so Grok's is turned off:
 * with it on, a Grok chat would never see the BMad skills Planning puts in the project.
 */
export const GROK_FOLDER_TRUST_ENV = 'GROK_FOLDER_TRUST';

/**
 * Its own sign-in method ids (spike 12.2). Ogden uses only `apiKey` (user decision,
 * 2026-10-05: Grok is an xAI API access token only; `grok.com` ("Sign in with Grok")
 * is the one method it advertises and is never offered or called). `xai.api_key`
 * is accepted but unadvertised: it takes the token from `XAI_API_KEY` in its environment.
 */
export const GROK_AUTH_METHOD_IDS = { grokCom: 'grok.com', apiKey: 'xai.api_key' } as const;

/**
 * Its permission modes. Grok has no ACP session modes: a mode is given once, in the
 * `_meta` of `session/new`, `resume` and `load` (`autoMode`, `yoloMode`), and the
 * default is Ask. The descriptor's native ids are the names Ogden gives them.
 */
export const GROK_MODE_IDS = { ask: 'ask', auto: 'autoMode', skipAll: 'yoloMode' } as const;

/** The decompressed binary's SHA-256 per platform (probed on 1.0.49 by spike 12.2 and recomputed for the other three in entry 4). */
export const GROK_BINARY_SHA256: Readonly<Record<AgentPlatform, string>> = {
  'darwin-arm64': '184f4cb1ba2a8eefaa2c2f267b9102bdb13c32dce53db7f7e3095b88f5fe0cce',
  'darwin-x64': '7efdfb4253a5f7a8a71a482ee34afdda106a28936842537c85dac2a8f2819826',
  'linux-x64': '2cc2ef5dcaa0509b56cdfb9559e27fabe322a0d893810e5129f507110e9b9c6c',
  'linux-arm64': 'df7e60362b1934b6f09e1e64b6d75a8c94b1bd9bf68c2803da273e4c6ed9a451',
  'win32-x64': 'af67a14cc1439dc9fca3ef73686239f4aabf6e53a15d29add6f1194b1179698e',
  'win32-arm64': '24bd9df7228a869b9bc10c83ed756c12d794f2844336908cb1fa20ff756fd393',
};
