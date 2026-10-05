import { readFileSync } from 'node:fs';
import { defineConfig, type UserConfig } from 'tsdown';

/** The published package's version, the one build-time constant every part reads (`src/version.ts`). */
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** What both bundles share: ESM for Node 24, into `dist/` beside each other. */
const common = {
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  // Cleaned once for both builds (tsdown cleans before any config builds).
  clean: true,
  dts: false,
  fixedExtension: false,
  define: { __OGDEN_AGENTS_VERSION__: JSON.stringify(version) },
  deps: {
    // Every third-party import stays external and loads from node_modules,
    // whichever workspace package imports it (the root package must declare
    // it; tests/packaging.test.ts enforces that). Workspace packages export
    // TypeScript source, so they are bundled in.
    neverBundle: true,
    alwaysBundle: [/^@ogden-agents\//],
    onlyBundle: false,
  },
} satisfies UserConfig;

export default defineConfig([
  {
    ...common,
    // Named so the root build can copy them to `dist/` unchanged: `server.js`
    // (the library the tests and `--foreground` load) and `serve.js` (the
    // detached background server process). They share chunks.
    entry: { server: 'src/index.ts', serve: 'src/serve.ts' },
    // Core's committed SQL migrations ship beside the bundle (`dist/drizzle/`),
    // where core looks for them first, so an installed package migrates on first run.
    copy: [
      { from: '../core/drizzle/*.sql', to: 'dist/drizzle' },
      { from: '../core/drizzle/meta/*.json', to: 'dist/drizzle/meta' },
    ],
  },
  {
    ...common,
    // `launcher.js` (what `bin/ogden.js` runs on every `ogden`) is a build of
    // its own, sharing no chunk with the server, so it loads only what the
    // handshake and the spawn need: never `better-sqlite3` (packaging test).
    entry: { launcher: 'src/launcher.ts' },
  },
  {
    ...common,
    // `ogden-install.mjs` (story 3): installs and starts Ogden Agents from a
    // GitHub Release; the start scripts run it, and it ships as a release
    // asset, not inside the npm package. Everything it needs is bundled
    // (Node built-ins only, nothing from node_modules), in its own folder so
    // `assemble-dist` never copies it into `dist/`.
    entry: { 'ogden-install': 'src/installer/main.ts' },
    outDir: 'dist-installer',
    clean: false,
    fixedExtension: true,
    deps: { neverBundle: [/^node:/], alwaysBundle: [/^@ogden-agents\//], onlyBundle: false },
  },
]);
