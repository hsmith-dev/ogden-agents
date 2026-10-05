// SPIKE 13.1 (temporary, reference for 13.2/13.5/13.8/13.10): installs the built spike app,
// launches it several ways and records what the ticket asks. Never fails the job: every
// question gets an answer or the error that stopped it.
//
//   node harness.mjs --leg <name> --target <triple> --bundle <dir of version N bundles>
//                    --bundle-next <dir of version N+1 bundles> --stage <stage dir> --out <findings.json>
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    leg: { type: 'string' },
    target: { type: 'string' },
    bundle: { type: 'string' },
    'bundle-next': { type: 'string' },
    stage: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});
const here = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(here, 'spawn-grandchild.mjs');
const OS = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
const target = args.target ?? '';
const work = process.env.SPIKE_WORK ? (mkdirSync(process.env.SPIKE_WORK, { recursive: true }), process.env.SPIKE_WORK) : mkdtempSync(join(tmpdir(), 'ogden-spike-'));
const findings = { leg: args.leg, target, os: OS, runner: { platform: process.platform, arch: process.arch }, answers: {}, runs: {}, errors: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[harness]', ...a);
const MB = (b) => Math.round((b / 1048576) * 10) / 10;

function du(path) {
  let bytes = 0;
  const walk = (p) => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isSymbolicLink?.()) return;
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else bytes += st.size;
  };
  walk(path);
  return bytes;
}

function walkFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.endsWith('.app')) out.push({ path: p, bytes: du(p), dir: true });
        else walk(p);
      } else out.push({ path: p, bytes: statSync(p).size });
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Processes.
// ---------------------------------------------------------------------------

/** @returns {{pid:number, ppid:number, rssKB:number, name:string}[]} */
function listProcs() {
  if (OS === 'win') {
    const errors = [];
    for (const shell of ['pwsh', 'powershell']) {
      const r = spawnSync(
        shell,
        ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name | ConvertTo-Json -Compress'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      );
      try {
        const list = JSON.parse(r.stdout).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, rssKB: Math.round(Number(p.WorkingSetSize) / 1024), name: p.Name }));
        if (list.length > 0) return list;
      } catch {
        errors.push(`${shell}: ${r.error ?? ''} ${String(r.stderr).slice(0, 200)}`);
      }
    }
    // No ppid here, but enough for "is it alive".
    const t = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const list = t.stdout
      .split('\n')
      .map((l) => l.match(/^"([^"]*)","(\d+)"/))
      .filter(Boolean)
      .map((m) => ({ pid: Number(m[2]), ppid: -1, rssKB: 0, name: m[1] }));
    if (!findings.processListFallback) findings.processListFallback = { used: 'tasklist', errors };
    return list;
  }
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.stdout
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rssKB: Number(m[3]), name: m[4] }));
}

function descendants(procs, root) {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift();
    for (const c of procs) if (c.ppid === p && !out.some((o) => o.pid === c.pid)) (out.push(c), queue.push(c.pid));
  }
  return out;
}

const alive = (pid) => pid !== undefined && listProcs().some((p) => p.pid === pid);

function hardKill(pid, tree) {
  if (pid === undefined) return;
  if (OS === 'win') spawnSync('taskkill', ['/pid', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore' });
  else
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
}

function memorySample(shellPid, serverPid) {
  const procs = listProcs();
  const sum = (list) => Math.round(list.reduce((a, p) => a + p.rssKB, 0) / 1024);
  const shell = procs.filter((p) => p.pid === shellPid);
  const shellKids = descendants(procs, shellPid);
  const server = procs.filter((p) => p.pid === serverPid).concat(descendants(procs, serverPid));
  let webview = shellKids.filter((p) => p.pid !== serverPid && !server.some((s) => s.pid === p.pid));
  if (OS === 'mac') webview = procs.filter((p) => /com\.apple\.WebKit/.test(p.name));
  return {
    shellMB: sum(shell),
    serverTreeMB: sum(server),
    webviewMB: sum(webview),
    webviewProcesses: webview.map((p) => basename(p.name)).slice(0, 20),
    totalMB: sum(shell) + sum(server) + sum(webview),
    note: OS === 'mac' ? 'webview = all com.apple.WebKit.* processes (XPC services, not children)' : 'webview = shell descendants other than the server',
  };
}

// ---------------------------------------------------------------------------
// Running the app.
// ---------------------------------------------------------------------------

function readEvents(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

async function waitFor(file, pred, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ev = readEvents(file).find(pred);
    if (ev) return ev;
    await sleep(250);
  }
  return undefined;
}

function grandchildInfo(file) {
  return readEvents(file).find((e) => e.grandchildPid !== undefined);
}

/**
 * The bundled npm, as the server would use it for agent installs: findNpmCli's rule 2
 * (`npm_execpath`, absolute `npm-cli.js` that exists), run with the bundled Node.
 */
function npmCheck(paths, dir) {
  if (!paths) return 'no paths event';
  const out = { npmCli: paths.npmCli, rule2Ok: /npm-cli\.js$/.test(paths.npmCli ?? '') && existsSync(paths.npmCli ?? '') };
  const env = { ...process.env, PATH: dirname(paths.node) };
  const v = spawnSync(paths.node, [paths.npmCli, '--version'], { encoding: 'utf8', env });
  out.version = v.status === 0 ? v.stdout.trim() : `FAIL ${v.status} ${String(v.stderr).slice(0, 300)}`;
  const prefix = join(dir, 'npm-install-check');
  mkdirSync(prefix, { recursive: true });
  const started = Date.now();
  const i = spawnSync(paths.node, [paths.npmCli, 'install', '--prefix', prefix, '--no-audit', '--no-fund', 'is-number@7.0.0'], { encoding: 'utf8', env, timeout: 120_000 });
  out.installSmallPackage = i.status === 0 && existsSync(join(prefix, 'node_modules', 'is-number')) ? `ok in ${Date.now() - started} ms` : `FAIL ${i.status} ${String(i.stderr).slice(-400)}`;
  return out;
}

/**
 * One launch. mode: 'tree' | 'direct' | 'crash' | 'crash-nojob' | 'update'.
 * @returns the run's record.
 */
async function launch(name, exe, { mode = 'tree', prefix = [], updateUrl, timeoutMs = 150_000 } = {}) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const reportFile = join(dir, 'report.jsonl');
  const gcFile = join(dir, 'grandchild.jsonl');
  const env = {
    ...process.env,
    OGDEN_SPIKE_REPORT: reportFile,
    OGDEN_AGENTS_DATA_DIR: join(dir, 'data'),
    OGDEN_SPIKE_AUTOQUIT_MS: '6000',
    OGDEN_SPIKE_KILL: mode === 'direct' ? 'direct' : 'tree',
    OGDEN_SPIKE_GRANDCHILD_FILE: gcFile,
  };
  if (mode !== 'update') env.OGDEN_SPIKE_PRELOAD = PRELOAD;
  if (mode === 'direct' || mode === 'crash-nojob') env.OGDEN_SPIKE_NOJOB = '1';
  if (updateUrl) env.OGDEN_SPIKE_UPDATE_URL = updateUrl;
  const rec = { mode, exe };
  const out = join(dir, 'stdio.log');
  const [cmd, cmdArgs] = prefix.length ? [prefix[0], [...prefix.slice(1), exe]] : [exe, []];
  let t0 = Date.now();
  let child;
  for (let attempt = 1; ; attempt++) {
    t0 = Date.now();
    child = spawn(cmd, cmdArgs, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: OS !== 'win' });
    const spawnError = await new Promise((r) => {
      child.once('spawn', () => r(undefined));
      child.once('error', (e) => r(e));
    });
    if (!spawnError) break;
    rec.spawnErrors = [...(rec.spawnErrors ?? []), `${spawnError.code ?? spawnError} (exists: ${existsSync(exe)})`];
    if (attempt >= 3) {
      rec.error = `could not start ${exe}`;
      return rec;
    }
    await sleep(5000);
  }
  child.stdout.on('data', (d) => appendFileSync(out, d));
  child.stderr.on('data', (d) => appendFileSync(out, d));
  let exited;
  child.on('exit', (code, signal) => (exited = { code, signal, at: Date.now() }));
  rec.launcherPid = child.pid;
  try {
    const ready = await waitFor(reportFile, (e) => e.ev === 'page_finished' || e.ev === 'server_error', 90_000);
    const evs = readEvents(reportFile);
    const at = (ev) => evs.find((e) => e.ev === ev);
    const shellPid = at('shell_start')?.pid ?? child.pid;
    const serverPid = at('server_spawned')?.data?.serverPid;
    rec.shellPid = shellPid;
    rec.serverPid = serverPid;
    rec.appInfo = at('app_info')?.data;
    rec.paths = at('paths')?.data;
    rec.job = at('server_spawned')?.data?.job;
    if (!ready || ready.ev === 'server_error') {
      rec.error = ready ? ready.data : 'no page_finished within 90 s';
      return rec;
    }
    rec.timingsMs = {
      launchToShellStart: at('shell_start') ? at('shell_start').t - t0 : null,
      launchToServerReady: at('server_ready') ? at('server_ready').t - t0 : null,
      serverSpawnToReady: at('server_ready')?.data?.ms ?? null,
      launchToWindowCreated: at('window_created') ? at('window_created').t - t0 : null,
      launchToFirstPage: ready.t - t0,
    };
    rec.firstPageUrlHasCode = /#c=/.test(ready.data.url);
    const gc = await (async () => {
      for (let i = 0; i < 40; i++) {
        const g = grandchildInfo(gcFile);
        if (g) return g;
        await sleep(250);
      }
      return undefined;
    })();
    rec.grandchild = gc;

    if (mode === 'update') {
      const done = await waitFor(reportFile, (e) => ['update_installed', 'update_error', 'update_none'].includes(e.ev), timeoutMs);
      rec.update = done ?? 'no updater event';
      if (done?.ev === 'update_installed') {
        const relaunched = await waitFor(reportFile, (e) => e.ev === 'app_info' && e.pid !== shellPid, 120_000);
        rec.relaunched = relaunched ? { version: relaunched.data.version, pid: relaunched.pid } : 'no relaunch within 120 s';
        const after = await waitFor(reportFile, (e) => (e.ev === 'update_none' || e.ev === 'update_error') && e.pid !== shellPid, 120_000);
        rec.afterRelaunch = after ?? null;
      }
    } else if (mode === 'crash' || mode === 'crash-nojob') {
      await sleep(3000);
      rec.memory = memorySample(shellPid, serverPid);
      hardKill(shellPid, false);
      rec.crashedShell = true;
    } else {
      rec.probe = (await waitFor(reportFile, (e) => e.ev === 'probe' && e.data.stage === 'checks', 30_000))?.data?.result ?? 'no probe';
      const fin = await waitFor(reportFile, (e) => e.ev === 'probe' && e.data.stage === 'final', 30_000);
      rec.probeFinal = fin?.data?.result ?? 'no final probe';
      rec.navigationBlocked = readEvents(reportFile)
        .filter((e) => e.ev === 'navigation_blocked' || e.ev === 'new_window_denied')
        .map((e) => `${e.ev}: ${e.data.url}`);
      await sleep(2000);
      rec.memory = memorySample(shellPid, serverPid);
      if (name === 'A-tree') rec.npm = npmCheck(rec.paths, dir);
    }

    // Wait for the shell to go, then look for anything it left.
    const end = Date.now() + 40_000;
    while (alive(shellPid) && Date.now() < end) await sleep(250);
    rec.shellExited = !alive(shellPid);
    await sleep(3000);
    const evsAfter = readEvents(reportFile);
    rec.grandchildEvents = readEvents(gcFile).filter((e) => e.grandchildExit);
    rec.serverStopped = evsAfter.filter((e) => e.ev === 'server_stopped').map((e) => e.data);
    const pids = { server: serverPid, grandchild: gc?.grandchildPid };
    rec.survivors = Object.fromEntries(Object.entries(pids).map(([k, pid]) => [k, pid === undefined ? 'unknown' : alive(pid) ? 'ALIVE' : 'gone']));
    if (mode === 'update') {
      const later = evsAfter.filter((e) => e.pid !== shellPid && e.ev === 'server_spawned').map((e) => e.data.serverPid);
      for (const pid of later) if (alive(pid)) rec.survivors[`server(${pid})`] = 'ALIVE';
    }
  } catch (error) {
    rec.error = String(error?.stack ?? error);
  } finally {
    rec.exit = exited ?? null;
    // Clean up whatever is left so later runs start clean.
    for (const pid of [rec.serverPid, rec.grandchild?.grandchildPid, rec.shellPid, rec.relaunched?.pid, child.pid]) if (pid && alive(pid)) hardKill(pid, true);
    rec.tail = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter((l) => !l.startsWith('{')).slice(-15).join('\n') : '';
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Installing.
// ---------------------------------------------------------------------------

function findOne(files, re) {
  return files.find((f) => re.test(f.path));
}

function installMac(bundleDir, into) {
  const files = walkFiles(bundleDir);
  const app = files.find((f) => f.dir && f.path.endsWith('.app'));
  if (!app) throw new Error(`no .app in ${bundleDir}`);
  mkdirSync(into, { recursive: true });
  const dest = join(into, basename(app.path));
  rmSync(dest, { recursive: true, force: true });
  spawnSync('ditto', [app.path, dest], { stdio: 'inherit' });
  const macos = join(dest, 'Contents', 'MacOS');
  const exe = readdirSync(macos).find((n) => !n.startsWith('ogden-node'));
  return { exe: join(macos, exe), installedBytes: du(dest), appPath: dest };
}

function installWin(bundleDir) {
  const files = walkFiles(bundleDir);
  const nsis = findOne(files, /-setup\.exe$/);
  if (!nsis) throw new Error('no NSIS installer');
  const r = spawnSync(nsis.path, ['/S'], { stdio: 'inherit' });
  const dir = join(process.env.LOCALAPPDATA ?? '', 'Ogden Agents Spike');
  // The installer may hand off to a second copy of itself; wait until no setup process is left.
  for (let i = 0; i < 60 && listProcs().some((p) => /setup/i.test(p.name) && /Ogden/i.test(p.name)); i++) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  findings.nsisInstall = { exit: r.status, files: existsSync(dir) ? readdirSync(dir).map((n) => `${n} ${statSync(join(dir, n)).size}`) : [] };
  const exe = existsSync(dir) ? readdirSync(dir).find((n) => n.endsWith('.exe') && !n.startsWith('ogden-node') && !/uninstall/i.test(n)) : undefined;
  if (!exe) throw new Error(`NSIS install (exit ${r.status}) left no app exe in ${dir}`);
  return { exe: join(dir, exe), installedBytes: du(dir), dir };
}

function tryMsi(bundleDir) {
  const msi = findOne(walkFiles(bundleDir), /\.msi$/);
  if (!msi) return { built: false };
  const logFile = join(work, 'msi.log');
  const i = spawnSync('msiexec', ['/i', msi.path, '/qn', '/l*v', logFile], { stdio: 'inherit' });
  const dir = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Ogden Agents Spike');
  const logText = existsSync(logFile) ? readFileSync(logFile, 'utf16le') : '';
  const installDir = logText.match(/Property\(S\): (?:INSTALLDIR|APPLICATIONFOLDER) = (.*)/)?.[1]?.trim();
  const where = installDir && existsSync(installDir) ? installDir : dir;
  const res = { built: true, bytes: msi.bytes, installExit: i.status, installDir: where, installedBytes: existsSync(where) ? du(where) : null };
  const u = spawnSync('msiexec', ['/x', msi.path, '/qn'], { stdio: 'inherit' });
  res.uninstallExit = u.status;
  return res;
}

function installLinux(bundleDir, into) {
  const files = walkFiles(bundleDir);
  const appimage = findOne(files, /\.AppImage$/);
  if (!appimage) throw new Error('no AppImage');
  mkdirSync(into, { recursive: true });
  const dest = join(into, 'Ogden-Agents-Spike.AppImage');
  cpSync(appimage.path, dest);
  chmodSync(dest, 0o755);
  return { exe: dest, installedBytes: statSync(dest).size };
}

function installDeb(bundleDir) {
  const deb = findOne(walkFiles(bundleDir), /\.deb$/);
  if (!deb) return { built: false };
  const r = spawnSync('sudo', ['dpkg', '-i', deb.path], { encoding: 'utf8' });
  const name = spawnSync('dpkg-deb', ['-f', deb.path, 'Package'], { encoding: 'utf8' }).stdout.trim();
  const size = spawnSync('dpkg-query', ['-W', '-f=${Installed-Size}', name], { encoding: 'utf8' }).stdout.trim();
  const listed = spawnSync('dpkg', ['-L', name], { encoding: 'utf8' }).stdout.split('\n');
  const exe = listed.find((l) => l.startsWith('/usr/bin/') && !l.includes('ogden-node'));
  return { built: true, bytes: deb.bytes, installExit: r.status, installErr: r.stderr.slice(-400), package: name, installedKB: Number(size) || null, exe };
}

// ---------------------------------------------------------------------------
// Updater dry run.
// ---------------------------------------------------------------------------

const PLATFORM_KEYS = {
  'aarch64-apple-darwin': ['darwin-aarch64'],
  'x86_64-apple-darwin': ['darwin-x86_64'],
  'universal-apple-darwin': ['darwin-aarch64', 'darwin-x86_64'],
  'x86_64-unknown-linux-gnu': ['linux-x86_64'],
  'aarch64-unknown-linux-gnu': ['linux-aarch64'],
  'x86_64-pc-windows-msvc': ['windows-x86_64'],
  'aarch64-pc-windows-msvc': ['windows-aarch64'],
};

function updaterArtifact(dir) {
  const files = walkFiles(dir);
  const re = OS === 'mac' ? /\.app\.tar\.gz$/ : OS === 'win' ? /-setup\.exe$/ : /\.AppImage$/;
  const art = findOne(files, re);
  const sig = art && files.find((f) => f.path === `${art.path}.sig`);
  return art && sig ? { file: art.path, sig: readFileSync(sig.path, 'utf8').trim(), bytes: art.bytes } : undefined;
}

function serveDir(files, port) {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1));
    const body = files[name];
    if (body === undefined) return res.writeHead(404).end();
    if (typeof body === 'string' && !existsSync(body)) return res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    res.writeHead(200, { 'content-length': statSync(body).size });
    createReadStream(body).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

async function updaterDryRun(install, prefix) {
  const next = updaterArtifact(args['bundle-next']);
  const prev = updaterArtifact(args.bundle);
  if (!next || !prev) return { error: `updater artifacts missing (next: ${!!next}, current: ${!!prev})` };
  const manifest = (signature) =>
    JSON.stringify({
      version: '0.0.2',
      notes: 'spike N+1',
      pub_date: new Date().toISOString(),
      platforms: Object.fromEntries((PLATFORM_KEYS[target] ?? []).map((k) => [k, { signature, url: `http://127.0.0.1:8765/${basename(next.file)}` }])),
    });
  const server = await serveDir(
    { [basename(next.file)]: next.file, 'latest.json': manifest(next.sig), 'tampered.json': manifest(prev.sig) },
    8765,
  );
  const result = { artifactBytes: next.bytes };
  try {
    result.tampered = await launch('update-tampered', install.exe, { mode: 'update', prefix, updateUrl: 'http://127.0.0.1:8765/tampered.json' });
    result.good = await launch('update-good', install.exe, { mode: 'update', prefix, updateUrl: 'http://127.0.0.1:8765/latest.json', timeoutMs: 240_000 });
    if (OS === 'mac') {
      const plist = join(install.appPath, 'Contents', 'Info.plist');
      result.installedVersionAfter = spawnSync('defaults', ['read', plist, 'CFBundleShortVersionString'], { encoding: 'utf8' }).stdout.trim();
      result.quarantineAfter = spawnSync('xattr', ['-l', install.appPath], { encoding: 'utf8' }).stdout.trim() || '(no xattrs)';
      result.codesignAfter = spawnSync('codesign', ['-dv', install.appPath], { encoding: 'utf8' }).stderr.split('\n').filter((l) => /Signature|TeamIdentifier|flags/.test(l));
    } else if (OS === 'win') {
      result.installedVersionAfter = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${install.exe}').VersionInfo.ProductVersion`], {
        encoding: 'utf8',
      }).stdout.trim();
    }
  } finally {
    server.close();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Webview runtime versions.
// ---------------------------------------------------------------------------

function webviewInfo() {
  if (OS === 'win') {
    const key = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-ItemProperty -Path '${key}' -ErrorAction SilentlyContinue).pv`], { encoding: 'utf8' });
    return { webview2RegistryVersion: r.stdout.trim() || 'not found' };
  }
  if (OS === 'linux') {
    const pc = spawnSync('pkg-config', ['--modversion', 'webkit2gtk-4.1'], { encoding: 'utf8' });
    const dq = spawnSync('dpkg-query', ['-W', '-f=${Version}', 'libwebkit2gtk-4.1-0'], { encoding: 'utf8' });
    const os = existsSync('/etc/os-release') ? (readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="(.*)"/)?.[1] ?? '') : '';
    return { webkit2gtk41: pc.stdout.trim() || 'not found', libwebkit2gtkPackage: dq.stdout.trim() || 'not found', os };
  }
  return { macos: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim() };
}

// ---------------------------------------------------------------------------

async function main() {
  findings.answers.webviewRuntime = webviewInfo();
  try {
    findings.stage = JSON.parse(readFileSync(join(args.stage, 'stage-report.json'), 'utf8'));
  } catch (e) {
    findings.errors.push(`stage report: ${e}`);
  }
  findings.bundles = walkFiles(args.bundle).map((f) => ({ file: basename(f.path), MB: MB(f.bytes) }));

  let install;
  const prefix = [];
  try {
    if (OS === 'mac') install = installMac(args.bundle, join(work, 'Applications'));
    else if (OS === 'win') install = installWin(args.bundle);
    else install = installLinux(args.bundle, join(work, 'apps'));
    findings.installedMB = MB(install.installedBytes);
    findings.installedExe = install.exe;
  } catch (e) {
    findings.errors.push(`install: ${e}`);
  }

  if (install) {
    findings.runs.A_tree = await launch('A-tree', install.exe, { mode: 'tree', prefix });
    findings.runs.B_direct = await launch('B-direct', install.exe, { mode: 'direct', prefix });
    findings.runs.C_crash = await launch('C-crash', install.exe, { mode: 'crash', prefix });
    if (OS === 'win') findings.runs.C_crash_nojob = await launch('C-crash-nojob', install.exe, { mode: 'crash-nojob', prefix });
    if (target === 'universal-apple-darwin') {
      findings.runs.D_x64_slice = await launch('D-x64-slice', install.exe, { mode: 'tree', prefix: ['arch', '-x86_64'] });
    }
  }
  if (OS === 'linux') {
    try {
      findings.deb = installDeb(args.bundle);
      if (findings.deb.exe) findings.runs.D_deb = await launch('D-deb', findings.deb.exe, { mode: 'tree' });
    } catch (e) {
      findings.deb = { error: String(e) };
    }
  }
  if (install) {
    try {
      findings.updater = await updaterDryRun(install, prefix);
    } catch (e) {
      findings.updater = { error: String(e?.stack ?? e) };
    }
  }

  // Last: the MSI's install and uninstall also remove the NSIS install.
  if (OS === 'win') {
    try {
      findings.msi = tryMsi(args.bundle);
    } catch (e) {
      findings.msi = { error: String(e) };
    }
  }

  writeFileSync(args.out, JSON.stringify(findings, null, 2));
  const summary = summarize(findings);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

function summarize(f) {
  const a = f.runs.A_tree ?? {};
  const lines = [
    `## ${f.leg} (${f.target})`,
    '',
    `- bundles: ${f.bundles.map((b) => `${b.file} ${b.MB} MB`).join(', ') || 'none'}`,
    `- installed: ${f.installedMB ?? '?'} MB; webview: ${JSON.stringify(a.appInfo?.webview ?? null)} ${JSON.stringify(f.answers.webviewRuntime)}`,
    `- natives: ${JSON.stringify(f.stage?.checks?.[Object.keys(f.stage?.checks ?? {}).find((k) => k.startsWith('natives-')) ?? ''] ?? null)}`,
    `- cold start (A): ${JSON.stringify(a.timingsMs ?? a.error ?? null)}; warm (B): ${JSON.stringify(f.runs.B_direct?.timingsMs?.launchToFirstPage ?? null)} ms`,
    `- memory (A): ${JSON.stringify(a.memory ?? null)}`,
    `- probe (A): ${JSON.stringify(a.probe ?? null)}`,
    `- blocked (A): ${JSON.stringify(a.navigationBlocked ?? null)}; final href: ${JSON.stringify(a.probeFinal ?? null)}`,
    ...Object.entries(f.runs).map(([k, r]) => `- ${k}: job=${JSON.stringify(r.job ?? null)} survivors=${JSON.stringify(r.survivors ?? null)} error=${JSON.stringify(r.error ?? null)}`),
    `- msi: ${JSON.stringify(f.msi ?? null)}; deb: ${JSON.stringify(f.deb ? { ...f.deb, installErr: undefined } : null)}`,
    `- updater tampered: ${JSON.stringify(f.updater?.tampered?.update ?? f.updater?.error ?? null)}`,
    `- updater good: ${JSON.stringify(f.updater?.good?.update ?? null)} relaunched=${JSON.stringify(f.updater?.good?.relaunched ?? null)} after=${JSON.stringify(f.updater?.installedVersionAfter ?? null)}`,
    `- errors: ${JSON.stringify(f.errors)}`,
    '',
  ];
  return lines.join('\n');
}

main().catch((e) => {
  findings.errors.push(String(e?.stack ?? e));
  writeFileSync(args.out ?? join(work, 'findings.json'), JSON.stringify(findings, null, 2));
  console.error(e);
});
