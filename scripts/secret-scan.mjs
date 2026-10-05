#!/usr/bin/env node
/**
 * A small secret scan for the tracked files, run by CI on every pull request.
 * It fails when a file holds something shaped like a real key or token. No
 * third-party code runs, and nothing touches the network.
 *
 *   node scripts/secret-scan.mjs              scan every tracked file
 *   node scripts/secret-scan.mjs --self-test  check that the patterns still catch a fake key
 *
 * Test fixtures stay out of the way two ways. The patterns need a real key's
 * full length, which the short fixtures don't reach. A value that contains
 * TEST_ONLY, or a line that carries `secret-scan:allow`, is skipped.
 * Add an allow marker only for a value that is not a real credential.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/** @type {{ name: string, re: RegExp }[]} */
export const PATTERNS = [
  { name: 'Anthropic key', re: /\bsk-ant-(?:api|admin|sid)\d{2}-[A-Za-z0-9_-]{60,}/g },
  { name: 'OpenAI key', re: /\bsk-(?!ant-)(?:proj-|svcacct-)?(?=[A-Za-z0-9_-]{40,})[A-Za-z0-9_-]*[A-Za-z0-9]{20,}/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'xAI key', re: /\bxai-[A-Za-z0-9]{70,}/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{70,}/g },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'Private key block', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
];

const ALLOW_MARKER = 'secret-scan:allow';
const MAX_BYTES = 2 * 1024 * 1024;

/** @param {string} text @returns {{ line: number, name: string }[]} */
export function scanText(text) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        if (m[0].includes('TEST_ONLY')) continue;
        found.push({ line: i + 1, name });
      }
    }
  });
  return found;
}

function selfTest() {
  // Built from parts so this file never contains a key-shaped string itself.
  const fake = ['sk', 'ant', 'api03'].join('-') + '-' + 'A1b2C3d4'.repeat(10);
  const ok = ['sk', 'ant', 'api03'].join('-') + '-' + 'A1b2C3d4_TEST_ONLY_'.repeat(5);
  const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
  const failures = [];
  if (scanText(`key = ${fake}`).length !== 1) failures.push('missed a key-shaped value');
  if (scanText(`key = ${ok}`).length !== 0) failures.push('flagged a TEST_ONLY fixture');
  if (scanText(`key = ${fake} // ${ALLOW_MARKER}`).length !== 0) failures.push('ignored the allow marker');
  if (scanText(pem).length !== 1) failures.push('missed a private key block');
  if (scanText('sk-ant-api03-short-fixture-value').length !== 0) failures.push('flagged a short fixture');
  if (failures.length) {
    console.error(`secret-scan self-test failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('secret-scan self-test passed');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
  let bad = 0;
  for (const file of files) {
    let text;
    try {
      if (statSync(file).size > MAX_BYTES) continue;
      const buf = readFileSync(file);
      if (buf.includes(0)) continue; // binary
      text = buf.toString('utf8');
    } catch {
      continue; // deleted or unreadable
    }
    for (const hit of scanText(text)) {
      bad += 1;
      // Never print the value itself.
      console.error(`${file}:${hit.line}: looks like a ${hit.name}`);
    }
  }
  if (bad) {
    console.error(`\n${bad} possible secret(s). If one is real, revoke it now: removing it from the code does not undo a leak. If it is a fake test value, make it obviously fake (include TEST_ONLY).`);
    process.exit(1);
  }
  console.log(`secret-scan: ${files.length} files, nothing found`);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('secret-scan.mjs')) main();
