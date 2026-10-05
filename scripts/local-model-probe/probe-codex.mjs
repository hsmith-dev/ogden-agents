// @ts-nocheck
// TEMPORARY (epic 14, spike 14.1), route 1: does codex-acp (the merged Codex adapter, pinned 2.1.1)
// honour a local provider? Variants: a custom model provider in config.toml, the same as a
// CODEX_CONFIG JSON merge, oss_provider alone, and the defaults (what does Codex call on its own).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function npmCli(IS_WIN) {
  const candidates = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const dir of (process.env.PATH ?? '').split(IS_WIN ? ';' : ':')) {
    const shim = join(dir, 'npm');
    if (!existsSync(shim)) continue;
    try { const real = realpathSync(shim); candidates.push(real, join(dirname(real), 'npm-cli.js'), join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')); } catch {}
  }
  return candidates.find((p) => existsSync(p) && p.endsWith('npm-cli.js'));
}

export async function run({ ctx }) {
  const { root, dataDir, home, tmp, KEY, results, log, baseEnv, Driver, startFakeServer, startProxy, mb, duBytes, here, externalOnly, trim, sleep } = ctx;
  const IS_WIN = process.platform === 'win32';
  const installDir = join(dataDir, 'agents', 'local', 'codex-acp');
  mkdirSync(installDir, { recursive: true });
  cpSync(join(here, 'pins', 'codex', 'package.json'), join(installDir, 'package.json'));
  cpSync(join(here, 'pins', 'codex', 'package-lock.json'), join(installDir, 'package-lock.json'));
  const lock = JSON.parse(readFileSync(join(here, 'pins', 'codex', 'package-lock.json'), 'utf8'));
  const top = lock.packages['node_modules/@agentclientprotocol/codex-acp'];
  const t0 = Date.now();
  const inst = spawnSync(process.execPath, [npmCli(IS_WIN), 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(root, 'npm-cache')], { cwd: installDir, encoding: 'utf8', timeout: 300_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), TEMP: tmp, TMP: tmp } });
  results.install = { ok: inst.status === 0, seconds: (Date.now() - t0) / 1000, size: inst.status === 0 ? mb(duBytes(installDir)) : null, version: top.version, integrity: top.integrity, codexCli: lock.packages['node_modules/@openai/codex']?.version };
  log('install', results.install);
  if (inst.status !== 0) throw new Error(`npm ci failed: ${inst.stderr?.slice(-600)}`);
  const entry = join(installDir, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js');

  const fake = await startFakeServer({ requireKey: KEY });
  const proxy = await startProxy();
  const provider = { name: 'Ogden endpoint', base_url: `${fake.url}/v1`, env_key: 'OGDEN_ENDPOINT_KEY', wire_api: 'responses' };
  const toml = (o) => Object.entries(o).map(([k, v]) => `${k} = ${typeof v === 'string' ? JSON.stringify(v) : v}`).join('\n');
  const hardenedToml = 'check_for_update_on_startup = false\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n[features]\nplugins = false\n';
  const variants = {
    'custom-provider-config-toml': { toml: `model = "fake-small"\nmodel_provider = "ogden"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n${hardenedToml}[model_providers.ogden]\n${toml(provider)}\n`, env: {} },
    'custom-provider-CODEX_CONFIG-env': { toml: '', env: { CODEX_CONFIG: JSON.stringify({ model: 'fake-small', model_provider: 'ogden', approval_policy: 'on-request', sandbox_mode: 'read-only', check_for_update_on_startup: false, analytics: { enabled: false }, model_providers: { ogden: provider } }), MODEL_PROVIDER: 'ogden' } },
    'oss_provider-only': { toml: `oss_provider = "lmstudio"\nmodel = "fake-small"\n${hardenedToml}`, env: { CODEX_OSS_BASE_URL: `${fake.url}/v1`, CODEX_OSS_PORT: String(fake.port) } },
    'defaults-dummy-key': { toml: '', env: { CODEX_API_KEY: 'sk-ogden-probe-not-a-real-key' }, authenticate: 'api-key' },
  };
  results.variants = {};
  for (const [name, v] of Object.entries(variants)) {
    const codexHome = join(dataDir, 'agents', 'local', 'codex-home', name);
    mkdirSync(codexHome, { recursive: true });
    if (v.toml) writeFileSync(join(codexHome, 'config.toml'), v.toml);
    const before = proxy.hits.length;
    const fakeBefore = fake.log.length;
    const make = () => new Driver(name, fake, {
      cmd: process.execPath, args: [entry], authenticate: v.authenticate,
      env: baseEnv({ CODEX_HOME: codexHome, NO_BROWSER: '1', INITIAL_AGENT_MODE: 'read-only', OGDEN_ENDPOINT_KEY: KEY, ...proxy.env, ...v.env }, join(dataDir, 'xdg', name)),
    }, proxy);
    try {
      const out = await ctx.genericFlow(name, make, { runText: 'Please run the shell command echo ogden-probe-ran' });
      out.proxyHosts = [...new Set(proxy.hits.slice(before).map((h) => h.target ?? h.url))].sort();
      out.fakePaths = Object.fromEntries([...new Set(fake.log.slice(fakeBefore).map((e) => `${e.method} ${e.path}`))].map((k) => [k, fake.log.slice(fakeBefore).filter((e) => `${e.method} ${e.path}` === k).length]));
      out.fakeModels = [...new Set(fake.log.slice(fakeBefore).map((e) => e.model).filter(Boolean))];
      out.fakeToolNames = [...new Set(fake.log.slice(fakeBefore).flatMap((e) => e.tools ?? []))].slice(0, 20);
      out.homeFiles = ctx.listTree(codexHome).filter((f) => !f.endsWith('/')).slice(0, 30);
      out.keyInCodexHome = ctx.grepTree(codexHome, Buffer.from(KEY));
      results.variants[name] = out;
      log(`CODEX VARIANT ${name}`, trim({ ...out, steps: undefined }, 6000));
    } catch (e) {
      results.variants[name] = { error: String(e?.stack ?? e) };
      log(`CODEX VARIANT ${name} FAILED`, String(e?.stack ?? e));
    }
  }
  await proxy.close(); await fake.close();
}
