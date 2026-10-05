// Stages what the Tauri shell bundles (story 13.2; grown from spike 13.1's stage.mjs).
//
//   node packages/desktop/scripts/stage.mjs --target <rust triple> --tgz <ogden-agents-x.y.z.tgz>
//
// 1. Downloads the pinned official Node binary for the target (desktop-node-pins.json) and
//    checks its SHA-256; a mismatch fails the build.
// 2. Places it as the `externalBin` sidecar `src-tauri/binaries/ogden-node-<triple>`
//    (a lipo'd fat binary for universal-apple-darwin).
// 3. Copies the npm that ships with it to `stage/npm`.
// 4. Installs the packed tarball's production dependencies with that Node and npm into
//    `stage/app` (so native modules match the bundled Node), and for universal macOS
//    merges an arm64 and an x64 install with lipo.
// 5. Prunes native binaries for other targets, checks that better-sqlite3, @napi-rs/keyring
//    and node-pty load with the bundled Node, and writes `stage/stage-report.json`.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import { verifiedArchive } from './node-archive.mjs';

const pins = JSON.parse(readFileSync(new URL('../desktop-node-pins.json', import.meta.url), 'utf8'));
export const NODE_VERSION = pins.version;
const TRIPLES = {
  'aarch64-apple-darwin': ['darwin-arm64'],
  'x86_64-apple-darwin': ['darwin-x64'],
  'universal-apple-darwin': ['darwin-arm64', 'darwin-x64'],
  'x86_64-unknown-linux-gnu': ['linux-x64'],
  'aarch64-unknown-linux-gnu': ['linux-arm64'],
  'x86_64-pc-windows-msvc': ['win-x64'],
  'aarch64-pc-windows-msvc': ['win-arm64'],
};

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, '..');
const stage = join(desktopRoot, 'stage');
const cache = join(desktopRoot, '.node-cache');

const { values } = parseArgs({ options: { target: { type: 'string' }, tgz: { type: 'string' } }, strict: true });
const target = values.target ?? '';
const plats = TRIPLES[target];
if (!plats || !values.tgz) {
  console.error(`usage: stage.mjs --target <${Object.keys(TRIPLES).join('|')}> --tgz <file>`);
  process.exit(2);
}
const tgz = resolve(values.tgz);
const isWin = target.includes('windows');
const report = { target, nodeVersion: NODE_VERSION, node: {}, checks: {}, sizes: {} };

/** Downloads, verifies and extracts one Node build; returns its folder. */
async function fetchNode(plat) {
  const { file: archive, name, ext, sha256: sha } = await verifiedArchive({ plat, cache, pins });
  const out = join(cache, name);
  // Windows' own bsdtar reads zip; Git Bash's GNU tar on PATH does not (and takes `D:` for a host).
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  if (!existsSync(out)) execFileSync(tar, ['-xf', archive, '-C', cache], { stdio: 'inherit' });
  const bin = plat.startsWith('win') ? join(out, 'node.exe') : join(out, 'bin', 'node');
  const npm = plat.startsWith('win') ? join(out, 'node_modules', 'npm') : join(out, 'lib', 'node_modules', 'npm');
  report.node[plat] = { archive: `${name}.${ext}`, sha256: sha, archiveBytes: statSync(archive).size, binaryBytes: statSync(bin).size };
  return { bin, npm, dir: out };
}

function du(path) {
  let bytes = 0;
  let files = 0;
  const walk = (p) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else {
      bytes += st.size;
      files += 1;
    }
  };
  walk(path);
  return { bytes, files };
}

/** `arch -x86_64` in front of a command for the Intel half of a universal build. */
const runner = (plat) => (target === 'universal-apple-darwin' && plat === 'darwin-x64' ? ['arch', ['-x86_64']] : [null, []]);

function run(plat, file, args, opts = {}) {
  const [wrap, wrapArgs] = runner(plat);
  const [cmd, cmdArgs] = wrap ? [wrap, [...wrapArgs, file, ...args]] : [file, args];
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...opts });
}

function installApp(plat, node, into) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  writeFileSync(join(into, 'package.json'), JSON.stringify({ name: 'ogden-desktop-app', private: true }, null, 2));
  const env = { ...process.env, PATH: `${dirname(node.bin)}${isWin ? ';' : ':'}${process.env.PATH}` };
  const started = Date.now();
  const r = run(plat, node.bin, [join(node.npm, 'bin', 'npm-cli.js'), 'install', '--omit=dev', '--no-bin-links', '--no-audit', '--no-fund', '--no-package-lock', tgz], {
    cwd: into,
    env,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`npm install for ${plat} failed (${r.status})`);
  report.checks[`installMs-${plat}`] = Date.now() - started;
}

const CHECK_JS = `
const { createRequire } = require('node:module');
const req = createRequire(process.argv[1] + '/package.json');
const out = { node: process.version, arch: process.arch, modules: process.versions.modules };
const tryIt = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = 'FAIL: ' + String(e && e.message || e).slice(0, 300); } };
tryIt('better-sqlite3', () => { const D = req('better-sqlite3'); const db = new D(':memory:'); const v = db.prepare('select sqlite_version() v').get().v; db.close(); return 'ok sqlite ' + v; });
tryIt('@napi-rs/keyring', () => { const k = req('@napi-rs/keyring'); return typeof k.Entry === 'function' ? 'ok (Entry loaded, keychain not touched)' : 'FAIL: no Entry'; });
tryIt('node-pty', () => { const p = req('node-pty'); return typeof p.spawn === 'function' ? 'ok' : 'FAIL: no spawn'; });
console.log(JSON.stringify(out));
`;

function checkNatives(plat, nodeBin, label) {
  const pkg = join(stage, 'app', 'node_modules', 'ogden-agents');
  const r = run(plat, nodeBin, ['-e', CHECK_JS, pkg]);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    parsed = { error: `exit ${r.status}: ${r.stderr.slice(0, 500)}` };
  }
  report.checks[`natives-${label}`] = parsed;
  console.log(`natives (${label}):`, parsed);
  // Every native module the app needs must load, node-pty included (E13-R2).
  const failed = Object.entries(parsed).filter(([, v]) => typeof v === 'string' && (v.startsWith('FAIL') || v.startsWith('exit ')));
  if (parsed.error !== undefined || failed.length > 0) throw new Error(`native modules failed to load for ${label}: ${JSON.stringify(parsed)}`);
}

/** A 1024x1024 PNG (a plain mark) for `tauri icon`, so the repository holds no binary. */
function writeIconPng(file) {
  const size = 1024;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const dx = x - size / 2;
      const dy = y - size / 2;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ring = r > 260 && r < 360;
      raw[o] = ring ? 245 : 32;
      raw[o + 1] = ring ? 240 : 37;
      raw[o + 2] = ring ? 230 : 46;
      raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(
    file,
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  );
}

/** Merges the x64 install into the arm64 one: lipo for Mach-O files in both, copy for x64-only files. */
function mergeUniversal(armRoot, x64Root) {
  const merged = [];
  const copied = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const x = join(dir, e.name);
      const rel = relative(x64Root, x);
      const a = join(armRoot, rel);
      if (e.isDirectory()) {
        if (!existsSync(a)) {
          cpSync(x, a, { recursive: true });
          copied.push(rel);
        } else walk(x);
      } else if (!existsSync(a)) {
        mkdirSync(dirname(a), { recursive: true });
        copyFileSync(x, a);
        copied.push(rel);
      } else if (/\.(node|dylib)$/.test(e.name) || e.name === 'spawn-helper') {
        const ab = readFileSync(a);
        const xb = readFileSync(x);
        if (!ab.equals(xb)) {
          const info = spawnSync('lipo', ['-info', a], { encoding: 'utf8' }).stdout;
          if (/x86_64/.test(info) && /arm64/.test(info)) continue;
          const tmp = `${a}.universal`;
          execFileSync('lipo', ['-create', a, x, '-output', tmp]);
          rmSync(a);
          execFileSync('mv', [tmp, a]);
          merged.push(rel);
        }
      }
    }
  };
  walk(x64Root);
  report.checks.universalMerge = { lipoMerged: merged, copiedFromX64: copied };
}

/**
 * Removes native binaries for other targets: node-pty's prebuilds for other OSes, and musl
 * packages on Linux (linuxdeploy fails on `libc.musl-*.so.1`). A first cut of 13.4's pruning.
 */
function pruneForeign(nodeModules) {
  const keep = new Set(plats.map((p) => p.replace(/^win-/, 'win32-')));
  const removed = [];
  const before = du(nodeModules).bytes;
  // `prebuilds/<platform>-<arch>[.node]` in node-pty and better-sqlite3 (which ships every OS's binary).
  const prunePrebuilds = (pkgDir) => {
    const prebuilds = join(pkgDir, 'prebuilds');
    if (!existsSync(prebuilds)) return;
    for (const d of readdirSync(prebuilds)) {
      if (keep.has(d.replace(/\.node$/, ''))) continue;
      rmSync(join(prebuilds, d), { recursive: true, force: true });
      removed.push(relative(nodeModules, join(prebuilds, d)));
    }
  };
  for (const e of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('@')) for (const sub of readdirSync(join(nodeModules, e.name))) prunePrebuilds(join(nodeModules, e.name, sub));
    else prunePrebuilds(join(nodeModules, e.name));
  }
  const walk = (dir, depth) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (/-musl(eabihf)?$/.test(e.name)) (rmSync(p, { recursive: true, force: true }), removed.push(relative(nodeModules, p)));
      else if (depth < 1 && e.name.startsWith('@')) walk(p, depth + 1);
    }
  };
  walk(nodeModules, 0);
  report.checks.pruned = { removed, savedBytes: before - du(nodeModules).bytes };
}

async function main() {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const nodes = {};
  for (const plat of plats) nodes[plat] = await fetchNode(plat);
  const first = nodes[plats[0]];

  // Sidecar.
  const binDir = join(desktopRoot, 'src-tauri', 'binaries');
  rmSync(binDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  const sidecar = join(binDir, `ogden-node-${target}${isWin ? '.exe' : ''}`);
  if (target === 'universal-apple-darwin') {
    execFileSync('lipo', ['-create', nodes['darwin-arm64'].bin, nodes['darwin-x64'].bin, '-output', sidecar]);
    // tauri-build checks the per-architecture sidecars too when it compiles each half.
    copyFileSync(nodes['darwin-arm64'].bin, join(binDir, 'ogden-node-aarch64-apple-darwin'));
    copyFileSync(nodes['darwin-x64'].bin, join(binDir, 'ogden-node-x86_64-apple-darwin'));
  } else copyFileSync(first.bin, sidecar);
  if (!isWin) chmodSync(sidecar, 0o755);
  report.sizes.sidecarBytes = statSync(sidecar).size;

  // npm (the same in every build).
  cpSync(first.npm, join(stage, 'npm'), { recursive: true });
  const npmVersion = spawnSync(first.bin, [join(stage, 'npm', 'bin', 'npm-cli.js'), '--version'], { encoding: 'utf8' });
  report.checks.npm = npmVersion.status === 0 ? `ok ${npmVersion.stdout.trim()}` : `FAIL ${npmVersion.stderr.slice(0, 200)}`;

  // The packed server and its production dependencies.
  installApp(plats[0], first, join(stage, 'app'));
  if (target === 'universal-apple-darwin') {
    const x64 = join(stage, 'app-x64');
    installApp('darwin-x64', nodes['darwin-x64'], x64);
    mergeUniversal(join(stage, 'app'), x64);
    rmSync(x64, { recursive: true, force: true });
  }

  pruneForeign(join(stage, 'app', 'node_modules'));

  // Native modules with the bundled Node (and the Intel slice under Rosetta).
  checkNatives(plats[0], sidecar, plats[0]);
  if (target === 'universal-apple-darwin') checkNatives('darwin-x64', sidecar, 'darwin-x64-rosetta');

  report.sizes.app = du(join(stage, 'app'));
  report.sizes.npm = du(join(stage, 'npm'));
  writeIconPng(join(stage, 'icon-source.png'));
  writeFileSync(join(stage, 'stage-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
