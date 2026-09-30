import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  fixedExtension: false,
  deps: {
    // Workspace packages export TypeScript source, so they are bundled in;
    // third-party dependencies stay external and load from node_modules.
    alwaysBundle: [/^@ogdenmad\//],
    onlyBundle: false,
  },
});
