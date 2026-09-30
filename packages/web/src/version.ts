declare const __OGDEN_AGENTS_VERSION__: string | undefined;

/**
 * The version this UI was built as (Vite defines it at build time from
 * packages/web/package.json). `undefined` outside a Vite build, such as in
 * unit tests, where no drift is ever reported.
 */
export const BUILD_VERSION: string | undefined =
  typeof __OGDEN_AGENTS_VERSION__ === 'string' ? __OGDEN_AGENTS_VERSION__ : undefined;
