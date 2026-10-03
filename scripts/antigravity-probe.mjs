#!/usr/bin/env node
// TEMPORARY (spike 6.1): facts about Google's agy_acp_server (registry
// `antigravity-acp`) on this OS. No secrets, no accounts, no real sign-in.
// Prints facts only and always exits 0. Removed before the spike's final commit.
//
//   node scripts/antigravity-probe.mjs [--archive <zip already downloaded>]
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '1.3.0';
const REGISTRY = 'https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json';
const BASE = 'https://dl.google.com/agy-extensions/releases';
const TARGETS = {
  'darwin-arm64': { url: `${BASE}/macos/agy-acp-server-${VERSION}-darwin-arm64.zip`, cmd: 'agy_acp_server.par', args: [] },
  'darwin-x64': { url: `${BASE}/macos/agy-acp-server-${VERSION}-darwin-x86_64.zip`, cmd: 'agy_acp_server.par', args: [] },
  'linux-x64': { url: `${BASE}/linux/agy-acp-server-${VERSION}-linux-x86_64.zip`, cmd: 'agy_acp_server.par', args: ['--uid='] },
  'linux-arm64': { url: `${BASE}/linux/agy-acp-server-${VERSION}-linux-arm64.zip`, cmd: 'agy_acp_server.par', args: ['--uid='] },
  'win32-x64': { url: `${BASE}/windows/agy-acp-server-${VERSION}-windows-x86_64.zip`, cmd: 'agy_acp_server.exe', args: [] },
  'win32-arm64': { url: `${BASE}/windows/agy-acp-server-${VERSION}-windows-arm64.zip`, cmd: 'agy_acp_server.exe', args: [] },
};
const isWin = process.platform === 'win32';
const report = { probe: 'antigravity-acp', os: `${process.platform}-${process.arch}`, node: process.version, pinned: VERSION };
const log = (...a) => console.log('[probe]', ...a);
const ms = (t0) => Math.round(performance.now() - t0);

const root = mkdtempSync(join(tmpdir(), 'ogden-agy-'));
const dataDir = join(root, 'data');
const installDir = join(dataDir, 'agents', 'antigravity');
const home = join(root, 'home');
const project = join(root, 'project');
for (const d of [installDir, home, project]) mkdirSync(d, { recursive: true });
writeFileSync(join(project, 'README.md'), '# probe\n');

// A profile of its own, so nothing reaches the runner's real home.
const childEnv = (extra = {}) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_CACHE_HOME: join(home, '.cache'), ...extra };
  if (isWin) Object.assign(env, { APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local') });
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT']) if (!(k in extra)) delete env[k];
  return env;
};

async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

function listTree(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).replaceAll('\\', '/'), bytes: statSync(p).size });
    }
  };
  walk(dir);
  return out;
}

/** Child processes of `pid` (one level and below), by OS tools. */
function descendants(pid) {
  if (isWin) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8' });
    let all = [];
    try { all = JSON.parse(r.stdout); } catch { return { error: r.stderr?.slice(0, 300) }; }
    const kids = [];
    const walk = (p) => { for (const x of all) if (x.ParentProcessId === p) { kids.push({ pid: x.ProcessId, name: x.Name }); walk(x.ProcessId); } };
    walk(pid);
    return kids;
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  const all = r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/)).map(([p, pp, ...c]) => ({ pid: +p, ppid: +pp, name: c.join(' ') }));
  const kids = [];
  const walk = (p) => { for (const x of all) if (x.ppid === p) { kids.push({ pid: x.pid, name: x.name }); walk(x.pid); } };
  walk(pid);
  return kids;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killTree(child) {
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
}

/** Model lists are long; keep only their ids. */
function compact(result) {
  if (!result || typeof result !== 'object') return result;
  const r = { ...result };
  if (Array.isArray(r.configOptions)) r.configOptions = r.configOptions.map((o) => ({ id: o.id, category: o.category, type: o.type, currentValue: o.currentValue, values: (o.options ?? []).map((v) => v.value) }));
  if (r.models) r.models = { currentModelId: r.models.currentModelId, ids: (r.models.availableModels ?? []).map((m) => m.modelId) };
  return r;
}

/** A raw newline-delimited JSON-RPC client: records every message as the server sends it. */
function startServer(bin, args, env, label) {
  const t0 = performance.now();
  const child = spawn(bin, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], detached: !isWin, windowsHide: true });
  const run = { label, notifications: [], serverRequests: [], stderr: '', stdoutJunk: [], exit: null, spawnError: null };
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  child.on('error', (e) => { run.spawnError = String(e); for (const p of pending.values()) p.resolve({ error: { spawn: String(e) } }); });
  child.on('exit', (code, signal) => { run.exit = { code, signal, afterMs: ms(t0) }; for (const p of pending.values()) p.resolve({ error: { exited: run.exit } }); pending.clear(); });
  child.stderr.on('data', (d) => { run.stderr += d.toString(); if (run.stderr.length > 20000) run.stderr = run.stderr.slice(-20000); });
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { run.stdoutJunk.push(line.slice(0, 300)); continue; }
      if (msg.id !== undefined && msg.method === undefined) {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.resolve({ ms: ms(p.t), ...(msg.error ? { error: msg.error } : { result: compact(msg.result) }) }); }
      } else if (msg.method && msg.id !== undefined) {
        run.serverRequests.push(msg);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'probe: not supported' } }) + '\n');
      } else if (msg.method) {
        run.notifications.push(msg);
      }
    }
  });
  const request = (method, params, timeoutMs = 30000) => new Promise((resolve) => {
    if (run.exit || run.spawnError) return resolve({ error: { notRunning: run.exit ?? run.spawnError } });
    const id = nextId++;
    const t = performance.now();
    pending.set(id, { resolve, t });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: timeoutMs }); } }, timeoutMs);
  });
  return { child, run, request, t0 };
}

const CLIENT_CAPS = { fs: { readTextFile: true, writeTextFile: true }, terminal: true, auth: { terminal: true } };
const init = (s, caps = CLIENT_CAPS) => s.request('initialize', { protocolVersion: 1, clientCapabilities: caps, clientInfo: { name: 'ogden-agents-probe', version: '0' } }, 60000);
const wait = (n) => new Promise((r) => setTimeout(r, n));

async function finish(s, label) {
  const kids = s.child.pid ? descendants(s.child.pid) : [];
  const t = performance.now();
  killTree(s.child);
  await wait(1500);
  const left = kids.filter((k) => alive(k.pid));
  return { ...s.run, stderr: s.run.stderr.slice(-4000), children: kids, killedTreeMs: ms(t), childrenLeftAfterKill: left, label };
}

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) { report.error = `no archive for ${key}`; return; }
  report.archiveUrl = target.url;

  try {
    const reg = await (await fetch(REGISTRY)).json();
    report.registryNow = { version: reg.version, license: reg.license, platforms: Object.keys(reg.distribution?.binary ?? {}) };
  } catch (e) { report.registryNow = { error: String(e) }; }

  // Download into the data folder, as Ogden's install would.
  const zip = join(installDir, `agy-acp-server-${VERSION}.zip`);
  const argAt = process.argv.indexOf('--archive');
  let t = performance.now();
  if (argAt > 0) writeFileSync(zip, readFileSync(process.argv[argAt + 1]));
  else {
    const res = await fetch(target.url);
    report.download = { status: res.status, headers: Object.fromEntries(['content-length', 'etag', 'last-modified', 'x-goog-hash', 'content-type'].map((h) => [h, res.headers.get(h)])) };
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }
  report.download = { ...report.download, ms: ms(t), zipBytes: statSync(zip).size, sha256: await sha256(zip) };

  t = performance.now();
  const ux = isWin
    ? spawnSync('tar', ['-xf', zip, '-C', installDir], { encoding: 'utf8' })
    : spawnSync('unzip', ['-o', '-q', zip, '-d', installDir], { encoding: 'utf8' });
  report.unzip = { ms: ms(t), status: ux.status, stderr: ux.stderr?.slice(0, 500) };
  const files = listTree(installDir).filter((f) => !f.path.endsWith('.zip'));
  report.files = files;
  report.unpackedBytes = files.reduce((a, f) => a + f.bytes, 0);
  const bin = join(installDir, target.cmd);
  if (!existsSync(bin)) { report.error = `no ${target.cmd} in the archive`; return; }
  if (!isWin) for (const f of files) try { chmodSync(join(installDir, f.path), 0o755); } catch {}
  report.binSha256 = await sha256(bin);
  if (process.platform === 'linux') report.ldd = spawnSync('ldd', [bin], { encoding: 'utf8' }).stdout?.slice(0, 1500);
  if (!isWin) report.fileType = spawnSync('file', [bin], { encoding: 'utf8' }).stdout?.trim();

  // How a version can be read from an existing copy.
  report.versionFlags = {};
  for (const flag of ['--version', '-version', 'version', '--help']) {
    const r = spawnSync(bin, [...target.args, flag], { encoding: 'utf8', timeout: 20000, env: childEnv(), cwd: project, input: '' });
    report.versionFlags[flag] = { status: r.status, signal: r.signal, error: r.error ? String(r.error) : undefined, stdout: r.stdout?.slice(0, 1500), stderr: r.stderr?.slice(0, 1500) };
  }

  // Strings in the binary that name ACP methods, modes, env vars (unauthenticated hints only).
  const needles = ['session/resume', 'session/load', 'session/list', 'session/set_mode', 'session/set_config_option', 'session/set_model', 'session/fork', 'session/close', 'unstable_', 'request_permission', 'allow_once', 'allow_always', 'reject_once', 'reject_always', 'auto-edit', 'yolo', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTIGRAVITY', 'antigravity-acp', '.agents/skills', 'trustedWorkspaces', 'terminal/create', 'fs/read_text_file', 'mcpCapabilities', 'oauth-personal', 'gemini-api-key', 'oauth-business', 'agent-platform', 'NO_BROWSER', 'BROWSER'];
  const buf = readFileSync(bin);
  report.binaryStrings = Object.fromEntries(needles.map((n) => [n, buf.indexOf(n) >= 0]));
  const around = (needle, width = 120, max = 6) => {
    const out = new Set();
    let i = -1;
    while ((i = buf.indexOf(needle, i + 1)) >= 0 && out.size < max) out.add(buf.subarray(Math.max(0, i - width), i + needle.length + width).toString('latin1').replace(/[^\x20-\x7e]+/g, '·'));
    return [...out];
  };
  report.binaryContext = Object.fromEntries(['yolo', 'auto-edit', 'GEMINI_API_KEY', 'allow_once', 'session/resume'].map((n) => [n, around(n)]));

  // Run A: initialize with Ogden's capabilities, then everything reachable without auth.
  const A = startServer(bin, target.args, childEnv(), 'A: full client caps, no auth');
  const initA = await init(A);
  report.startupToInitializeMs = initA.ms ?? null;
  report.initialize = initA;
  const auth = initA.result?.authMethods ?? [];
  report.sessionNewNoAuth = await A.request('session/new', { cwd: project, mcpServers: [] });
  report.sessionListNoAuth = await A.request('session/list', { cwd: project });
  report.sessionLoadUnknownNoAuth = await A.request('session/load', { sessionId: 'probe-unknown', cwd: project, mcpServers: [] });
  report.sessionResumeUnknownNoAuth = await A.request('session/resume', { sessionId: 'probe-unknown', cwd: project, mcpServers: [] });
  report.unstableResumeUnknownNoAuth = await A.request('unstable_resumeSession', { sessionId: 'probe-unknown', cwd: project, mcpServers: [] }, 10000);
  await wait(2000);
  report.runA = await finish(A);

  // Run B: initialize with no client capabilities (do the auth methods change?).
  const B = startServer(bin, target.args, childEnv(), 'B: no client caps');
  report.initializeNoCaps = await init(B, {});
  report.runB = await finish(B);

  // Run C: start Google sign-in and watch for 25 s: is a URL surfaced to the client, stderr, or a browser launch?
  const browserLog = join(root, 'browser-calls.txt');
  const fakeBrowser = isWin ? join(root, 'browser.cmd') : join(root, 'browser.sh');
  writeFileSync(fakeBrowser, isWin ? `@echo %* >> "${browserLog}"\r\n` : `#!/bin/sh\necho "$@" >> "${browserLog}"\n`);
  if (!isWin) chmodSync(fakeBrowser, 0o755);
  const oauth = auth.find((m) => m.id === 'oauth-personal');
  if (oauth) {
    const C = startServer(bin, target.args, childEnv({ BROWSER: fakeBrowser }), 'C: authenticate oauth-personal (watched 25 s, never completed)');
    await init(C);
    report.authOauthPersonal = await C.request('authenticate', { methodId: 'oauth-personal' }, 25000);
    report.runC = await finish(C);
    report.runC.browserCalls = existsSync(browserLog) ? readFileSync(browserLog, 'utf8').replace(/(state|code_challenge)=[^&\s]+/g, '$1=…').slice(0, 1500) : null;
  }

  // Run D: a fake Gemini API key in the environment: is it read, and how does authenticate report it?
  if (auth.find((m) => m.id === 'gemini-api-key')) {
    const D = startServer(bin, target.args, childEnv({ GEMINI_API_KEY: 'probe-not-a-real-key' }), 'D: GEMINI_API_KEY=fake in env');
    await init(D);
    report.authApiKeyEnv = await D.request('authenticate', { methodId: 'gemini-api-key' }, 30000);
    report.sessionNewAfterApiKeyEnv = await D.request('session/new', { cwd: project, mcpServers: [] }, 30000);
    const sid = report.sessionNewAfterApiKeyEnv.result?.sessionId;
    if (sid) {
      report.promptWithFakeKey = await D.request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: 'Run the shell command `echo probe` and tell me the output.' }] }, 45000);
      report.setModeYolo = await D.request('session/set_mode', { sessionId: sid, modeId: 'yolo' });
      report.setModeDefault = await D.request('session/set_mode', { sessionId: sid, modeId: 'default' });
    }
    report.runD = await finish(D);

    // Run F: a new process (a "server restart"): list, resume and load the session D made.
    if (sid) {
      const F = startServer(bin, target.args, childEnv({ GEMINI_API_KEY: 'probe-not-a-real-key' }), 'F: restart, then list, resume and load D\'s session');
      await init(F);
      report.restart = {
        authenticate: await F.request('authenticate', { methodId: 'gemini-api-key' }),
        list: await F.request('session/list', { cwd: project }),
        resume: await F.request('session/resume', { sessionId: sid, cwd: project, mcpServers: [] }, 30000),
      };
      const before = F.run.notifications.length;
      report.restart.load = await F.request('session/load', { sessionId: sid, cwd: project, mcpServers: [] }, 30000);
      report.restart.loadReplayedUpdates = F.run.notifications.slice(before).map((n) => n.params?.update?.sessionUpdate);
      report.runF = await finish(F);
    }

    // Run G: GEMINI_HOME pointed into Ogden's data folder: does all state follow it?
    const geminiHome = join(dataDir, 'agents', 'antigravity', 'gemini-home');
    const G = startServer(bin, target.args, childEnv({ GEMINI_API_KEY: 'probe-not-a-real-key', GEMINI_HOME: geminiHome }), 'G: GEMINI_HOME in the data folder');
    await init(G);
    report.geminiHomeRun = {
      authenticate: await G.request('authenticate', { methodId: 'gemini-api-key' }),
      sessionNew: await G.request('session/new', { cwd: project, mcpServers: [] }, 30000),
    };
    report.runG = await finish(G);
    report.geminiHomeRun.files = listTree(geminiHome).map((f) => f.path).slice(0, 40);
    const E = startServer(bin, target.args, childEnv(), 'E: no key in env, authenticate gemini-api-key');
    await init(E);
    report.authApiKeyNoEnv = await E.request('authenticate', { methodId: 'gemini-api-key' }, 30000);
    report.runE = await finish(E);
  }

  // What the server wrote into the temp profile and the project.
  report.homeAfter = listTree(home).map((f) => f.path).slice(0, 80);
  const settings = join(home, '.gemini', 'antigravity-acp', 'settings.json');
  report.settingsWrittenByServer = existsSync(settings) ? readFileSync(settings, 'utf8') : null;
  report.projectAfter = listTree(project).map((f) => f.path);
}

try { await main(); } catch (e) { report.fatal = String(e?.stack ?? e); }
const text = JSON.stringify(report, null, 2);
console.log('===== ANTIGRAVITY PROBE REPORT BEGIN =====');
console.log(text);
console.log('===== ANTIGRAVITY PROBE REPORT END =====');
try { writeFileSync(process.env.PROBE_OUT ?? join(tmpdir(), 'antigravity-probe.json'), text); } catch {}
process.exit(0);
