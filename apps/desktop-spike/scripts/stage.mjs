// SPIKE 13.1 (temporary, reference for 13.2/13.4): stages what the Tauri shell bundles.
//
//   node apps/desktop-spike/scripts/stage.mjs --target <rust triple> --tgz <ogden-agents-x.y.z.tgz>
//
// 1. Downloads the pinned official Node binary for the target, checks its SHA-256.
// 2. Places it as the `externalBin` sidecar `src-tauri/binaries/ogden-node-<triple>`
//    (a lipo'd fat binary for universal-apple-darwin).
// 3. Copies the npm that ships with it to `stage/npm`.
// 4. Installs the packed tarball's production dependencies with that Node and npm into
//    `stage/app` (so native modules match the bundled Node), and for universal macOS
//    merges an arm64 and an x64 install with lipo.
// 5. Checks that better-sqlite3, @napi-rs/keyring and node-pty load with the bundled Node,
//    re-checks Node SEA, and writes `stage/stage-report.json`.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';

export const NODE_VERSION = '24.21.0';
/** SHA-256 from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt (checked 2026-10-04). */
export const NODE_SHA256 = {
  'darwin-arm64': ['tar.gz', 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'],
  'darwin-x64': ['tar.gz', '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097'],
  'linux-arm64': ['tar.xz', '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2'],
  'linux-x64': ['tar.xz', 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'],
  'win-arm64': ['zip', '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921'],
  'win-x64': ['zip', '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'],
};
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
const spikeRoot = resolve(here, '..');
const stage = join(spikeRoot, 'stage');
const cache = join(spikeRoot, '.node-cache');

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

async function download(url, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
      console.warn(`download ${url} failed (${error}); retrying`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/** Downloads, verifies and extracts one Node build; returns its folder. */
async function fetchNode(plat) {
  const [ext, sha] = NODE_SHA256[plat];
  const name = `node-v${NODE_VERSION}-${plat}`;
  const archive = join(cache, `${name}.${ext}`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(archive)) await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}.${ext}`, archive);
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (actual !== sha) throw new Error(`SHA-256 mismatch for ${name}.${ext}: ${actual} != ${sha}`);
  const out = join(cache, name);
  if (!existsSync(out)) execFileSync('tar', ['-xf', archive, '-C', cache], { stdio: 'inherit' });
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
  writeFileSync(join(into, 'package.json'), JSON.stringify({ name: 'ogden-desktop-spike-app', private: true }, null, 2));
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
}

function checkSea(plat, nodeBin) {
  const build = run(plat, nodeBin, ['--build-sea', 'none.json']);
  const isSea = run(plat, nodeBin, ['-p', "require('node:sea').isSea()"]);
  report.checks.sea = {
    buildSeaFlag: /bad option|unknown option/i.test(build.stderr) ? 'absent in ' + NODE_VERSION : `present? exit ${build.status}: ${build.stderr.slice(0, 160)}`,
    seaModule: isSea.status === 0 ? `node:sea loads (isSea=${isSea.stdout.trim()})` : 'node:sea missing',
    note: 'SEA needs native addons (better-sqlite3, keyring, node-pty) extracted to disk and dlopened; not used (epic 13 Notes).',
  };
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

async function main() {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const nodes = {};
  for (const plat of plats) nodes[plat] = await fetchNode(plat);
  const first = nodes[plats[0]];

  // Sidecar.
  const binDir = join(spikeRoot, 'src-tauri', 'binaries');
  rmSync(binDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  const sidecar = join(binDir, `ogden-node-${target}${isWin ? '.exe' : ''}`);
  if (target === 'universal-apple-darwin') {
    execFileSync('lipo', ['-create', nodes['darwin-arm64'].bin, nodes['darwin-x64'].bin, '-output', sidecar]);
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

  // Native modules with the bundled Node (and the Intel slice under Rosetta).
  checkNatives(plats[0], sidecar, plats[0]);
  if (target === 'universal-apple-darwin') checkNatives('darwin-x64', sidecar, 'darwin-x64-rosetta');
  checkSea(plats[0], first.bin);

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
