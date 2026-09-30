import { defineConfig } from 'tsdown';

export default defineConfig({
  // Named `server` so the root build can copy it to `dist/server.js` unchanged.
  entry: { server: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  fixedExtension: false,
  deps: {
    // Every third-party import stays external and loads from node_modules,
    // whichever workspace package imports it (the root package must declare
    // it; tests/packaging.test.ts enforces that). Workspace packages export
    // TypeScript source, so they are bundled in.
    neverBundle: true,
    alwaysBundle: [/^@ogdenmad\//],
    onlyBundle: false,
  },
});
