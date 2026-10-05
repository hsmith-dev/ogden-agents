// Installs an NSIS installer silently into a folder (current user, no UI) and prints the app's exe.
//   node packages/desktop/scripts/install-nsis.mjs <setup.exe> <folder>
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { installNsis } from './app-harness.mjs';

const [installer, folder] = process.argv.slice(2);
if (!installer || !folder) {
  console.error('usage: install-nsis.mjs <setup.exe> <folder>');
  process.exit(2);
}
const dir = resolve(folder);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
console.log(installNsis(resolve(installer), dir));
