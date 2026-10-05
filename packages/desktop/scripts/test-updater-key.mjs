// A throwaway updater signing key for CI test builds (story 13.8, AD-23; 13.10 and 13.13 reuse it).
//
//   node packages/desktop/scripts/test-updater-key.mjs <folder>  >> "$GITHUB_ENV"
//
// Generates a fresh minisign key pair in <folder> with a random password (never committed, never
// kept past the job), writes <folder>/config-override.json that turns on updater artifacts and sets
// THAT public key for this build only, and prints the two environment lines `tauri build` needs to
// sign them. Releases never use this: they use the user's own key from a GitHub secret (AD-23).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TAURI_CLI = '@tauri-apps/cli@2.12.1';
const folder = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
if (folder === undefined) {
  console.error('usage: test-updater-key.mjs <folder>');
  process.exit(2);
}
mkdirSync(folder, { recursive: true });
const password = randomBytes(18).toString('base64url');
const keyFile = join(folder, 'updater.key');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const made = spawnSync(npx, ['--yes', TAURI_CLI, 'signer', 'generate', '--ci', '-p', password, '-w', keyFile], { encoding: 'utf8', shell: process.platform === 'win32' });
if (made.status !== 0) {
  // Never echo anything that could hold the password.
  console.error(`could not generate the test key (exit ${made.status})`);
  process.exit(1);
}
const pubkey = readFileSync(`${keyFile}.pub`, 'utf8').trim();
writeFileSync(join(folder, 'config-override.json'), JSON.stringify({ bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey } } }));
const privateKey = readFileSync(keyFile, 'utf8').trim();
if (privateKey.includes('\n')) throw new Error('the private key is not one line');
console.log(`TAURI_SIGNING_PRIVATE_KEY=${privateKey}`);
console.log(`TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${password}`);
