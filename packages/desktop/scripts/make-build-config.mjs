#!/usr/bin/env node
// The per-build Tauri config override (story 13.9, AD-23): what differs between a CI test build, a
// release signed with the user's updater key, and a release with no key yet.
//
//   node packages/desktop/scripts/make-build-config.mjs --mode test|release|none --out <file>
//        [--base <config-override.json from test-updater-key.mjs>] [--apple-identity <id>] [--windows-thumbprint <sha1>]
//
// - test: the throwaway key's override (updater artifacts on, its public key) is the base.
// - release: updater artifacts on, signed by the key in the environment; the PUBLIC key must already
//   be committed in tauri.conf.json (`plugins.updater.pubkey`), and a missing or odd one fails here
//   with what to do, before an hour of building.
// - none: nothing is added; the build makes installers only, with no updater artifacts.
// Code signing is a slot: an Apple identity or a Windows thumbprint, given only when the user's
// secrets exist, is set for this build; without one the build stays unsigned (ad-hoc on macOS).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'tauri.conf.json');

/**
 * @param {unknown} base
 * @param {unknown} extra
 * @returns {any}
 */
export function deepMerge(base, extra) {
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof extra !== 'object' || extra === null || Array.isArray(extra)) return extra;
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) out[key] = key in out ? deepMerge(out[key], value) : value;
  return out;
}

/**
 * Whether `pubkey` (as `tauri signer generate` writes its `.pub`: base64 of a minisign public key file) looks like one.
 * @param {unknown} pubkey
 */
export function isMinisignPublicKey(pubkey) {
  if (typeof pubkey !== 'string' || pubkey.trim() === '') return false;
  try {
    return Buffer.from(pubkey.trim(), 'base64').toString('utf8').startsWith('untrusted comment: minisign public key');
  } catch {
    return false;
  }
}

/**
 * @param {{ mode: string, base?: unknown, committedPubkey?: unknown, appleIdentity?: string, windowsThumbprint?: string }} input
 */
export function buildConfig({ mode, base, committedPubkey, appleIdentity, windowsThumbprint }) {
  /** @type {any} */
  let config = {};
  if (mode === 'test') {
    if (base === undefined) throw new Error('test mode needs --base (the throwaway key override)');
    config = base;
  } else if (mode === 'release') {
    if (!isMinisignPublicKey(committedPubkey)) {
      throw new Error(
        'plugins.updater.pubkey in packages/desktop/src-tauri/tauri.conf.json is empty or not a minisign public key. ' +
          'Generate the updater key and commit its public key there (RELEASING.md, "The desktop app: the updater key"), or set the repository variable DESKTOP_SIGNING to something other than true to release installers without updates.',
      );
    }
    config = { bundle: { createUpdaterArtifacts: true } };
  } else if (mode !== 'none') throw new Error(`unknown mode "${mode}"`);
  if (appleIdentity) config = deepMerge(config, { bundle: { macOS: { signingIdentity: appleIdentity } } });
  if (windowsThumbprint) config = deepMerge(config, { bundle: { windows: { certificateThumbprint: windowsThumbprint, digestAlgorithm: 'sha256', timestampUrl: 'http://timestamp.digicert.com' } } });
  return config;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { mode: { type: 'string' }, out: { type: 'string' }, base: { type: 'string' }, 'apple-identity': { type: 'string' }, 'windows-thumbprint': { type: 'string' } }, strict: true });
  if (!values.mode || !values.out) {
    console.error('usage: make-build-config.mjs --mode test|release|none --out <file> [--base file]');
    process.exit(2);
  }
  try {
    const committed = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const config = buildConfig({
      mode: values.mode,
      ...(values.base ? { base: JSON.parse(readFileSync(values.base, 'utf8')) } : {}),
      committedPubkey: committed.plugins?.updater?.pubkey,
      ...(values['apple-identity'] ? { appleIdentity: values['apple-identity'] } : {}),
      ...(values['windows-thumbprint'] ? { windowsThumbprint: values['windows-thumbprint'] } : {}),
    });
    writeFileSync(values.out, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`wrote ${values.out} (mode ${values.mode}${values['apple-identity'] ? ', Apple signing' : ''}${values['windows-thumbprint'] ? ', Windows signing' : ''})`);
  } catch (error) {
    console.error(`make-build-config: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
