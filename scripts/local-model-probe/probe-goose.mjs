// TEMPORARY (epic 14, spike 14.1), route 3 (reserve): Goose over ACP against the fake server,
// installed from the ACP registry's per-OS binary pin (sha256 checked).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const V = '1.53.0';
const PINS = {
  'darwin-arm64': ['goose-aarch64-apple-darwin.tar.bz2', '49cf9cfd6195f558d0d9f39ccd691213004bccb2c626e2b40b244059ff9dbdba', 'goose'],
  'darwin-x64': ['goose-x86_64-apple-darwin.tar.bz2', '5d96ae149294fbeda930e693144bf333bbc9c1121d949f1ed77f176eb6a35f49', 'goose'],
  'linux-arm64': ['goose-aarch64-unknown-linux-gnu.tar.bz2', 'e156799760a174bfbc5d14443aacef064ce7592f9099dc9ce04c3db74e72224b', 'goose'],
  'linux-x64': ['goose-x86_64-unknown-linux-gnu.tar.bz2', '2d010c66dfd4348bb437b3a94001882468a5db1aa556858920481522f57752d7', 'goose'],
  'win32-x64': ['goose-x86_64-pc-windows-msvc.zip', '3a951c661f12415f7947daac2bb4651af1a7b41532f34d7c2f05ea6636eadaa9', 'goose-package/goose.exe'],
};

export async function run({ ctx }) {
  const { dataDir, KEY, results, log, baseEnv, Driver, startFakeServer, startProxy, mb, duBytes, listTree, grepTree, externalOnly, trim } = ctx;
  const IS_WIN = process.platform === 'win32';
  const pin = PINS[`${process.platform}-${process.arch}`];
  if (!pin) throw new Error('no goose pin for this OS');
  const dir = join(dataDir, 'agents', 'local', 'goose');
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const url = `https://github.com/block/goose/releases/download/v${V}/${pin[0]}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  results.install = { url, bytes: buf.length, sha256: sha, expected: pin[1], match: sha === pin[1], downloadSeconds: (Date.now() - t0) / 1000 };
  if (sha !== pin[1]) throw new Error(`sha256 mismatch ${sha}`);
  const archive = join(dir, pin[0]);
  writeFileSync(archive, buf);
  const x = spawnSync('tar', [pin[0].endsWith('.zip') ? '-xf' : '-xjf', archive, '-C', dir], { encoding: 'utf8' });
  if (x.status !== 0) throw new Error(`extract: ${x.stderr}`);
  const bin = join(dir, ...pin[2].split('/'));
  if (!existsSync(bin)) throw new Error(`no binary at ${bin}: ${listTree(dir).slice(0, 20)}`);
  if (!IS_WIN) spawnSync('chmod', ['+x', bin]);
  results.install.installedSize = mb(duBytes(dir));
  results.version = (spawnSync(bin, ['--version'], { env: baseEnv(), encoding: 'utf8', timeout: 30_000 }).stdout ?? '').trim();
  log('install', { ...results.install, version: results.version });

  const fake = await startFakeServer({ requireKey: KEY });
  const proxy = await startProxy();
  const goose = (extra) => ({ GOOSE_PATH_ROOT: join(dataDir, 'goose-root'), GOOSE_PROVIDER: 'openai', GOOSE_MODEL: 'fake-small', OPENAI_HOST: fake.url, OPENAI_BASE_PATH: 'v1/chat/completions', OPENAI_API_KEY: KEY, GOOSE_MODE: 'approve', GOOSE_DISABLE_KEYRING: '1', ...extra });
  const make = (extra) => () => new Driver('goose', fake, { cmd: bin, args: ['acp'], env: baseEnv({ ...goose(extra), ...proxy.env }, join(dataDir, 'xdg-goose')) }, proxy);
  try {
    const before = proxy.hits.length;
    const out = await ctx.genericFlow('goose-openai-provider', make({}));
    out.proxyHosts = [...new Set(proxy.hits.slice(before).map((h) => h.target ?? h.url))].sort();
    out.fakeSummary = Object.fromEntries([...new Set(fake.log.map((e) => `${e.method} ${e.path}`))].map((k) => [k, fake.log.filter((e) => `${e.method} ${e.path}` === k).length]));
    out.toolNames = [...new Set(fake.log.flatMap((e) => e.tools ?? []))].slice(0, 30);
    out.keyOnDisk = grepTree(ctx.root, Buffer.from(KEY));
    out.files = listTree(join(dataDir, 'goose-root')).filter((f) => !f.endsWith('/')).slice(0, 30);
    results.goose = out;
    log('GOOSE', trim({ ...out, steps: undefined }, 7000));
  } catch (e) { results.goose = { error: String(e?.stack ?? e) }; log('GOOSE FAILED', String(e?.stack ?? e)); }
  await proxy.close(); await fake.close();
}
