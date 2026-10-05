// Checks what stage.mjs staged, the way the app will run it (story 13.4, E13-R2): with ONLY the
// staged Node on PATH (no system Node, no npm, no uv), the packed server starts through the
// launcher's `--json` mode as the shell runs it, serves the page, exchanges a launch code for a tab
// token and quits through its own route; and the staged npm installs a package from a local
// fixture, which is what installing an agent from Welcome needs on a machine with no Node.
//
//   node packages/desktop/scripts/verify-stage.mjs --target <rust triple>
//
// A private data folder, no network, no real agent, no real keychain (memory secret store).
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const { values } = parseArgs({ options: { target: { type: 'string' } }, strict: true });
const target = values.target ?? '';
const isWin = target.includes('windows');
if (target === '') {
  console.error('usage: verify-stage.mjs --target <rust triple>');
  process.exit(2);
}
const sidecar = join(root, 'src-tauri', 'binaries', `ogden-node-${target}${isWin ? '.exe' : ''}`);
const pkg = join(root, 'stage', 'app', 'node_modules', 'ogden-agents');
const npmCli = join(root, 'stage', 'npm', 'bin', 'npm-cli.js');
for (const required of [sidecar, join(pkg, 'bin', 'ogden.js'), join(pkg, 'dist', 'serve.js'), join(pkg, 'dist', 'web', 'index.html'), npmCli]) {
  if (!existsSync(required)) throw new Error(`not staged: ${required}`);
}

const work = mkdtempSync(join(tmpdir(), 'ogden-verify-stage-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// A PATH with exactly one program in it: the staged Node, under its usual name.
const binDir = join(work, 'bin');
mkdirSync(binDir);
const nodeOnPath = join(binDir, isWin ? 'node.exe' : 'node');
if (isWin) copyFileSync(sidecar, nodeOnPath);
else {
  symlinkSync(sidecar, nodeOnPath);
  chmodSync(sidecar, 0o755);
}
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
// What the OS itself needs to start a process; never Node, npm, uv or any agent.
const env = {
  PATH: isWin ? `${binDir};${join(systemRoot, 'System32')}` : binDir,
  ...(isWin ? { SystemRoot: systemRoot, USERPROFILE: work, LOCALAPPDATA: join(work, 'local'), APPDATA: join(work, 'roaming'), TEMP: work, TMP: work } : { HOME: work, TMPDIR: work }),
  OGDEN_AGENTS_DATA_DIR: join(work, 'data'),
  OGDEN_AGENTS_TEST_SECRET_STORE: 'memory',
  OGDEN_AGENTS_SHELL: 'desktop',
  NODE_ENV: 'test',
  npm_execpath: npmCli,
};

let launcher;
let serverPid;
let failure;
try {
  // 1. Prove the PATH has no other Node.
  const which = spawnSync(nodeOnPath, ['-p', 'process.execPath'], { env, encoding: 'utf8' });
  if (which.status !== 0) throw new Error(`the staged Node does not run: ${which.stderr}`);
  console.log(`staged node ${spawnSync(nodeOnPath, ['--version'], { env, encoding: 'utf8' }).stdout.trim()} on a PATH of only ${binDir}`);

  // 2. The packed server through the launcher, as the shell runs it.
  launcher = spawn(nodeOnPath, [join(pkg, 'bin', 'ogden.js'), '--json', '--no-open', '--port', '0'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  let err = '';
  launcher.stdout.on('data', (c) => (out += c));
  launcher.stderr.on('data', (c) => (err += c));
  const deadline = Date.now() + 90_000;
  while (!out.includes('\n')) {
    if (launcher.exitCode !== null) throw new Error(`the launcher exited ${launcher.exitCode}: ${err}`);
    if (Date.now() > deadline) throw new Error(`the launcher printed no line in 90 s: ${err}`);
    await sleep(200);
  }
  const info = JSON.parse(out.split('\n')[0]);
  serverPid = info.pid;
  if (!info.owned || info.action !== 'started') throw new Error(`expected a started, owned server: ${JSON.stringify({ ...info, launchUrl: '(hidden)' })}`);
  console.log(`server ${info.version} on ${info.url} (pid ${info.pid})`);

  const page = await fetch(info.url);
  if (page.status !== 200 || !(await page.text()).includes('<div id="root">')) throw new Error(`the page did not load (${page.status})`);
  const code = new URL(info.launchUrl).hash.replace(/^#c=/, '');
  const exchange = await fetch(`${info.url}/api/v1/tab/exchange`, { method: 'POST', headers: { origin: info.url, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  if (exchange.status !== 200) throw new Error(`the code exchange answered ${exchange.status}`);
  const { token } = await exchange.json();
  const tab = await fetch(`${info.url}/api/v1/tab`, { headers: { authorization: `Bearer ${token}` } });
  if (tab.status !== 204) throw new Error(`the tab check answered ${tab.status}`);
  console.log('ok: page served, launch code exchanged, tab token accepted');

  // 3. Quit through the server's own route; the held launcher ends with it.
  const quit = await fetch(`${info.url}/api/v1/server/quit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: info.url } });
  if (quit.status !== 202) throw new Error(`quit answered ${quit.status}`);
  const stopBy = Date.now() + 30_000;
  while (alive(info.pid) || launcher.exitCode === null) {
    if (Date.now() > stopBy) throw new Error('the server or its launcher did not stop after Quit');
    await sleep(200);
  }
  console.log('ok: quit stopped the server and its launcher');

  // 4. The staged npm works with the staged Node alone: pack and install a local fixture.
  const fixture = join(work, 'fixture');
  mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'ogden-desktop-fixture', version: '1.0.0', main: 'index.js' }));
  writeFileSync(join(fixture, 'index.js'), "module.exports = 'fixture ok';\n");
  const npmEnv = { ...env, npm_config_cache: join(work, 'npm-cache'), npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
  const npm = (args, cwd) => spawnSync(nodeOnPath, [npmCli, ...args], { cwd, env: npmEnv, encoding: 'utf8' });
  const packed = npm(['pack', '--silent'], fixture);
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const tarball = join(fixture, packed.stdout.trim().split(/\r?\n/).pop());
  const target2 = join(work, 'install');
  mkdirSync(target2);
  writeFileSync(join(target2, 'package.json'), '{"name":"x","private":true}');
  const installed = npm(['install', tarball, '--no-audit', '--no-fund'], target2);
  if (installed.status !== 0) throw new Error(`npm install failed: ${installed.stderr}`);
  const loaded = spawnSync(nodeOnPath, ['-p', "require('ogden-desktop-fixture')"], { cwd: target2, env, encoding: 'utf8' });
  if (loaded.stdout.trim() !== 'fixture ok') throw new Error(`the installed package did not load: ${loaded.stderr}`);
  console.log('ok: the staged npm installed a package with only the staged Node on PATH');
} catch (error) {
  failure = error;
  console.error(`VERIFY FAILED: ${error.message}`);
  try {
    console.error('server.log tail:\n' + readFileSync(join(work, 'data', 'logs', 'server.log'), 'utf8').split('\n').slice(-25).join('\n'));
  } catch {
    // No log.
  }
} finally {
  try {
    launcher?.kill('SIGKILL');
  } catch {
    // Already gone.
  }
  if (serverPid !== undefined && alive(serverPid)) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(serverPid), '/T', '/F']);
      else process.kill(serverPid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(failure ? 1 : 0);
