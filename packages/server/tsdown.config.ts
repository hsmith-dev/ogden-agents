import { defineConfig } from 'tsdown';

export default defineConfig({
  // Named so the root build can copy them to `dist/` unchanged: `server.js`
  // (the library the tests and `--foreground` load), `serve.js` (the detached
  // background server process) and `launcher.js` (what `bin/ogden.js` runs).
  entry: { server: 'src/index.ts', serve: 'src/serve.ts', launcher: 'src/launcher.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  fixedExtension: false,
  // Core's committed SQL migrations ship beside the bundle (`dist/drizzle/`),
  // where core looks for them first, so an installed package migrates on first run.
  copy: [
    { from: '../core/drizzle/*.sql', to: 'dist/drizzle' },
    { from: '../core/drizzle/meta/*.json', to: 'dist/drizzle/meta' },
  ],
  deps: {
    // Every third-party import stays external and loads from node_modules,
    // whichever workspace package imports it (the root package must declare
    // it; tests/packaging.test.ts enforces that). Workspace packages export
    // TypeScript source, so they are bundled in.
    neverBundle: true,
    alwaysBundle: [/^@ogden-agents\//],
    onlyBundle: false,
  },
});
