declare const __OGDEN_AGENTS_VERSION__: string;

/**
 * The Ogden Agents version this code was built as: the root `package.json`
 * version, the one build-time constant the server, the launcher and the UI
 * all read (tsdown, Vite and Vitest define it). The launcher compares it with
 * the running server's, and the UI with the server's `server.started` (AD-20).
 */
export const VERSION: string = __OGDEN_AGENTS_VERSION__;
