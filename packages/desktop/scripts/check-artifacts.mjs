// What a desktop build produced (story 13.8, E13-R1, E13-R9): the installer exists, every updater
// artifact has its `.sig`, and on macOS the app and its sidecar hold both architectures.
//
//   node packages/desktop/scripts/check-artifacts.mjs --target <rust triple>
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { target: { type: 'string' }, 'no-updater': { type: 'boolean', default: false } }, strict: true });
/** A build with no updater key makes installers only: no `.app.tar.gz`, no `.sig`. */
const updater = !values['no-updater'];
const target = values.target ?? '';
const bundle = resolve(here, '..', 'src-tauri', 'target', target, 'release', 'bundle');
const problems = [];
const files = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const MB = (bytes) => `${Math.round(bytes / 1048576)} MB`;

if (target.includes('apple-darwin')) {
  const dmg = files(join(bundle, 'dmg')).filter((f) => f.endsWith('.dmg'));
  const tarball = files(join(bundle, 'macos')).filter((f) => f.endsWith('.app.tar.gz'));
  if (dmg.length !== 1) problems.push(`expected one .dmg, found ${dmg.length}`);
  if (updater && tarball.length !== 1) problems.push(`expected one .app.tar.gz, found ${tarball.length}`);
  if (updater) for (const f of tarball) if (!existsSync(join(bundle, 'macos', `${f}.sig`))) problems.push(`${f} has no .sig`);
  const app = join(bundle, 'macos', 'Ogden Agents.app', 'Contents', 'MacOS');
  for (const name of ['ogden-agents', 'ogden-node']) {
    const archs = execFileSync('lipo', ['-archs', join(app, name)], { encoding: 'utf8' }).trim().split(/\s+/).sort();
    if (target === 'universal-apple-darwin' && archs.join(',') !== 'arm64,x86_64') problems.push(`${name} has ${archs.join(',')}, not both arm64 and x86_64`);
    console.log(`${name}: ${archs.join(' ')}`);
  }
  for (const f of dmg) console.log(`${f}: ${MB(statSync(join(bundle, 'dmg', f)).size)}`);
} else if (target.includes('windows')) {
  const exe = files(join(bundle, 'nsis')).filter((f) => f.endsWith('.exe'));
  if (exe.length !== 1) problems.push(`expected one NSIS installer, found ${exe.length}`);
  for (const f of exe) {
    if (updater && !existsSync(join(bundle, 'nsis', `${f}.sig`))) problems.push(`${f} has no .sig`);
    console.log(`${f}: ${MB(statSync(join(bundle, 'nsis', f)).size)}`);
  }
  // One Windows installer only: the spike found the MSI and NSIS installers share one folder and remove each other.
  if (files(join(bundle, 'msi')).length > 0) problems.push('an MSI was built; only the NSIS installer ships');
} else problems.push(`unknown target ${target}`);

if (problems.length > 0) {
  for (const p of problems) console.error(`ARTIFACT PROBLEM ${p}`);
  process.exit(1);
}
console.log('artifacts ok');
