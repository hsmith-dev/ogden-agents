// Assembles the publishable `dist/` from the workspace builds:
//   packages/server/dist/*  -> dist/        (`server.js`, the background server
//                                           entry `serve.js`, `launcher.js`, and
//                                           their shared chunks and migrations)
//   packages/web/dist       -> dist/web/    (the built UI)
// Run by `pnpm build` after every package has built.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const path = (/** @type {string} */ relative) => fileURLToPath(new URL(relative, root));

const serverDist = path('packages/server/dist');
const webDist = path('packages/web/dist');
const out = path('dist');

/** @type {Array<[file: string, what: string]>} */
const required = [
  [path('packages/server/dist/server.js'), 'the server bundle'],
  [path('packages/server/dist/serve.js'), 'the background server entry'],
  [path('packages/server/dist/launcher.js'), 'the launcher bundle'],
  [path('packages/web/dist/index.html'), 'the web UI'],
];
for (const [file, what] of required) {
  if (!existsSync(file)) {
    console.error(`assemble-dist: ${what} is missing (${file}); build the packages first.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
cpSync(serverDist, out, { recursive: true });
cpSync(webDist, path('dist/web'), { recursive: true });
console.log('assemble-dist: wrote dist/server.js, dist/serve.js, dist/launcher.js and dist/web/');
