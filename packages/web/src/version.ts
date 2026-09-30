declare const __OGDEN_AGENTS_VERSION__: string | undefined;

/**
 * The version this UI was built as: the root package.json version, the one
 * build-time constant the server and launcher read too (Vite and Vitest
 * define it). `undefined` where nothing defines it, and then no drift is
 * ever reported.
 */
export const BUILD_VERSION: string | undefined =
  typeof __OGDEN_AGENTS_VERSION__ === 'string' ? __OGDEN_AGENTS_VERSION__ : undefined;
