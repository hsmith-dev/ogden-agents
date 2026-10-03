#!/usr/bin/env node
// TEMPORARY (epic 12, spikes 12.1 and 12.2): can Ogden drive Codex and Grok
// over ACP on this OS? Prints facts only, never signs in, uses no secrets.
// Removed before review.
//
//   node scripts/acp-agent-probe.mjs codex|grok
//
// 1. Installs the pinned copy (scripts/acp-probe-pins/<agent>/) into a temp
//    data folder with `npm ci --ignore-scripts`, the way story 9.3 installs
//    Claude Code, and checks the top package's integrity against the lock.
// 2. Starts the agent over stdio with an allowlisted environment and an
//    empty home, then: initialize, session/new without auth, session/list,
//    session/load and session/resume of an unknown id, and the stop check.
// 3. Again with a dummy API key in the environment (not a secret: it is
//    refused by the vendor), to see whether an API key reaches the agent
//    over ACP, and, if a session opens, its modes, commands and skills.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = process.argv[2];
if (AGENT !== 'codex' && AGENT !== 'grok') {
  console.error('usage: acp-agent-probe.mjs codex|grok');
  process.exit(2);
}
const IS_WIN = process.platform === 'win32';
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), `ogden-probe-${AGENT}-`));
const dataDir = join(root, 'data');
const installDir = join(dataDir, 'agents', AGENT, 'adapter');
const home = join(root, 'home');
const project = join(root, 'project');
for (const d of [installDir, home, project]) mkdirSync(d, { recursive: true });

const results = { agent: AGENT, os: process.platform, arch: process.arch, node: process.version };
const log = (title, value) => {
  console.log(`\n=== ${title}`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

// ---------- 1. install ----------
function npmCli() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const dir of (process.env.PATH ?? '').split(IS_WIN ? ';' : ':')) {
    const shim = join(dir, 'npm');
    if (!existsSync(shim)) continue;
    try {
      const real = realpathSync(shim); // .../npm/bin/npm-cli.js on Unix installs
      candidates.push(real, join(dirname(real), 'npm-cli.js'), join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    } catch {}
  }
  return candidates.find((p) => existsSync(p) && p.endsWith('npm-cli.js'));
}

function duBytes(p) {
  let total = 0;
  const st = lstatSync(p);
  if (st.isSymbolicLink()) return 0;
  if (st.isFile()) return st.size;
  if (st.isDirectory()) for (const e of readdirSync(p)) total += duBytes(join(p, e));
  return total;
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const pins = join(here, 'acp-probe-pins', AGENT);
cpSync(join(pins, 'package.json'), join(installDir, 'package.json'));
cpSync(join(pins, 'package-lock.json'), join(installDir, 'package-lock.json'));
const lock = JSON.parse(readFileSync(join(pins, 'package-lock.json'), 'utf8'));
const topName = AGENT === 'codex' ? '@agentclientprotocol/codex-acp' : '@xai-official/grok';
const topLock = lock.packages[`node_modules/${topName}`];
// The integrity npm publishes for the pinned version (checked by hand
// 2026-10-02 with `npm view <pkg>@<version> dist.integrity`).
const EXPECTED = {
  codex: 'sha512-dppZxW3f8kNbTDbR25+lBLtNst5DIC/Sm7GtRF69PI1Ilqv12tDSsIb0hJQW0iNzkx+JdDvX76HOyv5Uibu1qQ==',
  grok: 'sha512-vvrgCWsAPlDwl5MdkbC8fjwOOPje32wdbvV10tclIByYqHmvR0iPweNcd3/jCJBhi+BftL7N8fBeC2WfpoV8uA==',
};
results.pinned = { package: topName, version: topLock.version, integrity: topLock.integrity, matchesExpected: EXPECTED[AGENT] ? EXPECTED[AGENT] === topLock.integrity : 'n/a' };

const npm = npmCli();
const t0 = Date.now();
let install;
for (let attempt = 1; attempt <= 2; attempt++) {
  install = spawnSync(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(root, 'npm-cache')], {
    cwd: installDir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), TEMP: process.env.TEMP, TMP: process.env.TMP },
    timeout: 300_000,
  });
  if (install.status === 0) break;
  console.log(`npm ci attempt ${attempt} failed: ${install.stderr?.slice(-800)}`);
}
results.install = { ok: install.status === 0, seconds: (Date.now() - t0) / 1000, size: install.status === 0 ? mb(duBytes(installDir)) : null };
log('install', results.install);
if (install.status !== 0) process.exit(1);
const installedPkgs = readdirSync(join(installDir, 'node_modules', topName.split('/')[0]));
results.install.platformPackages = installedPkgs;

// ---------- the agent's command line ----------
const codexHome = join(home, '.codex');
const grokHome = join(home, '.grok');
mkdirSync(codexHome, { recursive: true });
mkdirSync(grokHome, { recursive: true });

function baseEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: join(root, 'tmp'),
    TEMP: join(root, 'tmp'),
    TMP: join(root, 'tmp'),
    CODEX_HOME: codexHome,
    GROK_HOME: grokHome,
    NO_BROWSER: '1',
    GROK_DISABLE_AUTOUPDATER: '1',
    ...extra,
  };
  if (IS_WIN) {
    for (const k of ['SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'SystemDrive', 'ProgramFiles', 'ProgramData']) if (process.env[k]) env[k] = process.env[k];
    env.APPDATA = join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = join(home, 'AppData', 'Local');
  }
  mkdirSync(env.TMPDIR, { recursive: true });
  return env;
}

let grokNative = null;
function grokBinary() {
  // The npm launcher (bin/grok) prefers $GROK_HOME/bin/grok over its own
  // copy and decompresses the platform package's grok.br there on first run.
  // Ogden would decompress it itself into the data folder; do that here.
  if (grokNative) return grokNative;
  const plat = join(installDir, 'node_modules', '@xai-official', `grok-${process.platform}-${process.arch}`, 'bin');
  const exe = IS_WIN ? 'grok.exe' : 'grok';
  const br = join(plat, `${exe}.br`);
  const out = join(dataDir, 'agents', 'grok', `grok-${topLock.version}${IS_WIN ? '.exe' : ''}`);
  const t = Date.now();
  return import('node:zlib').then(({ brotliDecompressSync }) => {
    const raw = existsSync(br) ? brotliDecompressSync(readFileSync(br)) : readFileSync(join(plat, exe));
    writeFileSync(out, raw, { mode: 0o755 });
    results.grokBinary = {
      compressed: existsSync(br) ? mb(statSync(br).size) : 'not compressed',
      size: mb(raw.length),
      sha256: createHash('sha256').update(raw).digest('hex'),
      decompressSeconds: (Date.now() - t) / 1000,
    };
    log('grok binary', results.grokBinary);
    grokNative = out;
    return out;
  });
}

async function agentCommand() {
  if (AGENT === 'codex') {
    return { cmd: process.execPath, args: [join(installDir, 'node_modules', '@agentclientprotocol', 'codex-acp', 'dist', 'index.js')] };
  }
  return { cmd: await grokBinary(), args: ['agent', 'stdio'] };
}

function runCli(args, env = baseEnv()) {
  return (async () => {
    let cmd, full;
    if (AGENT === 'codex') {
      cmd = process.execPath;
      full = [join(installDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), ...args];
    } else {
      cmd = await grokBinary();
      full = args;
    }
    const r = spawnSync(cmd, full, { env, encoding: 'utf8', timeout: 30_000, cwd: project });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(0, 3000), error: r.error?.message };
  })();
}

// ---------- process tree ----------
function processTable() {
  if (IS_WIN) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    try {
      return JSON.parse(r.stdout).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name }));
    } catch {
      return [];
    }
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return m ? { pid: +m[1], ppid: +m[2], name: m[3].split('/').pop() } : null;
  }).filter(Boolean);
}
function descendants(pid, table = processTable()) {
  const out = [];
  const walk = (p) => {
    for (const c of table) if (c.ppid === p) { out.push(c); walk(c.pid); }
  };
  walk(pid);
  return out;
}
const alive = (pid) => processTable().some((p) => p.pid === pid);

// ---------- a minimal ACP client over newline-delimited JSON-RPC ----------
class Acp {
  constructor(child, label) {
    this.child = child;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.agentRequests = [];
    this.stderr = '';
    this.buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => this.onData(d));
    child.stdout.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (this.stderr.length < 20000) this.stderr += d; });
    child.on('error', (e) => { this.stderr += `\n[spawn error] ${e.message}`; });
  }
  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.stderr += `\n[non-json stdout] ${line.slice(0, 300)}`; continue; }
      if (msg.id !== undefined && msg.method === undefined) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p(msg); }
      } else if (msg.method && msg.id !== undefined) {
        this.onAgentRequest(msg);
      } else if (msg.method) {
        this.notifications.push(msg);
      }
    }
  }
  onAgentRequest(msg) {
    this.agentRequests.push({ method: msg.method, params: msg.params });
    let result;
    if (msg.method === 'session/request_permission') result = { outcome: { outcome: 'cancelled' } };
    if (result) this.write({ jsonrpc: '2.0', id: msg.id, result });
    else this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'probe client does not implement this' } });
  }
  write(obj) {
    try { this.child.stdin.write(`${JSON.stringify(obj)}\n`); } catch {}
  }
  request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    const t = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ timeout: true, ms: Date.now() - t }); }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve({ ms: Date.now() - t, ...(msg.error ? { error: msg.error } : { result: msg.result }) });
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
}

const UNKNOWN_ID = randomUUID();
const trim = (v, n = 6000) => {
  const s = JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…(${s.length} chars)` : v;
};

async function session(label, env, { prompt = false, authMethod = null, initOnly = false, reopen = null } = {}) {
  const { cmd, args } = await agentCommand();
  const spawnedAt = Date.now();
  const child = spawn(cmd, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const acp = new Acp(child, label);
  const out = { label };
  out.initialize = await acp.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    clientInfo: { name: 'ogden-agents-probe', version: '0.0.0' },
  }, 60_000);
  out.startupMs = Date.now() - spawnedAt;
  if (initOnly) {
    child.kill();
    log(`ACP: ${label}`, trim({ label, startupMs: out.startupMs, initialize: out.initialize, stderrTail: acp.stderr.slice(-1500) }, 20_000));
    return out;
  }
  if (authMethod) out.authenticate = await acp.request('authenticate', { methodId: authMethod }, 30_000);
  if (reopen) {
    // a session created by an earlier process: does it come back?
    out.reopenResume = await acp.request('session/resume', { sessionId: reopen, cwd: project, mcpServers: [] }, 30_000);
    out.reopenLoad = await acp.request('session/load', { sessionId: reopen, cwd: project, mcpServers: [] }, 30_000);
  }
  out.sessionNew = await acp.request('session/new', { cwd: project, mcpServers: [] }, 60_000);
  const sid = out.sessionNew.result?.sessionId;
  await new Promise((r) => setTimeout(r, 3000));
  out.sessionList = await acp.request('session/list', { cwd: project }, 15_000);
  out.sessionLoadUnknown = await acp.request('session/load', { sessionId: UNKNOWN_ID, cwd: project, mcpServers: [] }, 15_000);
  out.sessionResumeUnknown = await acp.request('session/resume', { sessionId: UNKNOWN_ID, cwd: project, mcpServers: [] }, 15_000);
  if (sid) {
    const modes = out.sessionNew.result?.modes?.availableModes ?? [];
    out.setMode = {};
    for (const m of modes) out.setMode[m.id] = await acp.request('session/set_mode', { sessionId: sid, modeId: m.id }, 15_000);
    if (AGENT === 'grok') {
      // Grok has no ACP session modes; its docs give _meta.autoMode and _meta.yoloMode on session/new.
      out.metaModes = {};
      for (const meta of [{ autoMode: true }, { yoloMode: true }]) {
        const r = await acp.request('session/new', { cwd: project, mcpServers: [], _meta: meta }, 60_000);
        await new Promise((res) => setTimeout(res, 1000));
        const id = r.result?.sessionId;
        const changed = acp.notifications.filter((n) => n.method === '_x.ai/sessions/changed').flatMap((n) => n.params.upserted ?? []).filter((u) => u.sessionId === id).pop();
        out.metaModes[Object.keys(meta)[0]] = r.error ?? { ok: !!id, yolo: changed?.yolo, autoMode: changed?.autoMode, permissionMode: changed?.permissionMode };
      }
    }
    if (prompt) {
      out.prompt = await acp.request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: 'Run the shell command `echo ogden-probe` and tell me its output.' }] }, 90_000);
    }
  }
  out.agentText = acp.notifications.filter((n) => n.params?.update?.sessionUpdate === 'agent_message_chunk').map((n) => n.params.update.content?.text ?? '').join('').slice(0, 1500);
  out.notifications = acp.notifications.map((n) => ({ method: n.method, update: n.params?.update?.sessionUpdate, params: n.params }));
  out.agentRequests = acp.agentRequests;

  // stop check: the tree before, close stdin, wait, then kill, and look for orphans
  const tree = descendants(child.pid);
  out.processTree = tree.map((p) => p.name);
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  child.stdin.end();
  const graceful = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 5000))]);
  out.stop = { exitedOnStdinClose: !!graceful };
  if (!graceful) {
    child.kill();
    out.stop.afterKill = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 5000))]);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const orphans = tree.filter((p) => alive(p.pid));
  out.stop.orphans = orphans.map((p) => `${p.name}(${p.pid})`);
  for (const p of orphans) {
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']);
    else try { process.kill(p.pid, 'SIGKILL'); } catch {}
  }
  out.stderrTail = acp.stderr.slice(-2500);
  log(`ACP: ${label}`, trim(out, 40_000));
  return out;
}

// ---------- 2. versions and help ----------
const versions = {};
if (AGENT === 'codex') {
  versions.codexAcp = topLock.version;
  versions.codexCli = lock.packages['node_modules/@openai/codex']?.version;
  versions.codexVersion = await runCli(['--version']);
  versions.sandboxHelp = await runCli(['sandbox', '--help']);
  if (IS_WIN) versions.windowsSandboxHelp = await runCli(['sandbox', 'windows', '--help']);
  versions.resumeHelp = await runCli(['resume', '--help']);
  versions.features = await runCli(['features', 'list']);
} else {
  versions.grokVersion = await runCli(['--version']);
  versions.help = await runCli(['--help']);
  versions.agentHelp = await runCli(['agent', '--help']);
  versions.loginHelp = await runCli(['login', '--help']);
}
log('versions and help', versions);

// a project with skills in each folder an agent might read
for (const [folder, name] of [['.claude/skills', 'probe-claude-skill'], ['.agents/skills', 'probe-agents-skill'], ['.grok/skills', 'probe-grok-skill'], ['.codex/skills', 'probe-codex-skill']]) {
  const d = join(project, ...folder.split('/'), name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: Ogden probe skill in ${folder}. Use when the user says ${name}.\n---\n\nSay "${name} ran".\n`);
}

// ---------- 3. ACP ----------
results.initWithBrowser = await session('initialize only, NO_BROWSER unset', (({ NO_BROWSER, ...e }) => e)(baseEnv()), { initOnly: true });
results.noAuth = await session('no credentials, empty home', baseEnv());
if (AGENT === 'codex') {
  results.dummyKey = await session('dummy CODEX_API_KEY, authenticate api-key', baseEnv({ CODEX_API_KEY: 'sk-ogden-probe-not-a-real-key' }), { prompt: true, authMethod: 'api-key' });
  results.initialModeAsk = await session('INITIAL_AGENT_MODE=read-only, dummy key, reopen the earlier session', baseEnv({ CODEX_API_KEY: 'sk-ogden-probe-not-a-real-key', INITIAL_AGENT_MODE: 'read-only' }), { authMethod: 'api-key', reopen: results.dummyKey.sessionNew.result?.sessionId });
} else {
  // xai.api_key is not advertised in authMethods (only grok.com is), but the
  // binary accepts it: found 2026-10-02 in the 1.0.49 binary's strings.
  results.keyNoAuth = await session('dummy XAI_API_KEY in env, no authenticate', baseEnv({ XAI_API_KEY: 'xai-ogden-probe-not-a-real-key' }));
  results.dummyKey = await session('dummy XAI_API_KEY, authenticate xai.api_key', baseEnv({ XAI_API_KEY: 'xai-ogden-probe-not-a-real-key' }), { prompt: true, authMethod: 'xai.api_key' });
  results.reopen = await session('dummy XAI_API_KEY, reopen the earlier session', baseEnv({ XAI_API_KEY: 'xai-ogden-probe-not-a-real-key' }), { authMethod: 'xai.api_key', reopen: results.dummyKey.sessionNew.result?.sessionId });
}

// what the agent wrote into its home (names only)
const listTree = (d, depth = 0) => (existsSync(d) && depth < 3 ? readdirSync(d).flatMap((e) => {
  const p = join(d, e);
  return statSync(p).isDirectory() ? [`${e}/`, ...listTree(p, depth + 1).map((x) => `${e}/${x}`)] : [e];
}) : []);
log('files in the agent home after the runs', listTree(AGENT === 'codex' ? codexHome : grokHome));
log('files in HOME after the runs', listTree(home).slice(0, 80));

// ---------- summary ----------
const s = (r) => ({
  startupMs: r.startupMs,
  initMs: r.initialize.ms,
  protocolVersion: r.initialize.result?.protocolVersion,
  agentInfo: r.initialize.result?.agentInfo,
  authMethods: r.initialize.result?.authMethods?.map((m) => m.id),
  agentCapabilities: r.initialize.result?.agentCapabilities,
  sessionNew: r.sessionNew.error ?? (r.sessionNew.timeout ? 'timeout' : { sessionId: !!r.sessionNew.result?.sessionId, modes: r.sessionNew.result?.modes, configOptions: r.sessionNew.result?.configOptions?.map((o) => ({ id: o.id, options: o.options?.map?.((x) => x.value ?? x.id) })) }),
  commands: r.notifications.filter((n) => n.update === 'available_commands_update').flatMap((n) => n.params.update.availableCommands.map((c) => c.name)),
  sessionList: r.sessionList.error ?? r.sessionList.result ?? 'timeout',
  loadUnknown: r.sessionLoadUnknown.error ?? r.sessionLoadUnknown.result ?? 'timeout',
  resumeUnknown: r.sessionResumeUnknown.error ?? r.sessionResumeUnknown.result ?? 'timeout',
  reopenResume: r.reopenResume && (r.reopenResume.error ?? (r.reopenResume.timeout ? 'timeout' : 'ok')),
  reopenLoad: r.reopenLoad && (r.reopenLoad.error ?? (r.reopenLoad.timeout ? 'timeout' : 'ok')),
  setMode: r.setMode && Object.fromEntries(Object.entries(r.setMode).map(([k, v]) => [k, v.error ? v.error.message : v.timeout ? 'timeout' : 'ok'])),
  metaModes: r.metaModes,
  authenticate: r.authenticate && (r.authenticate.error ?? (r.authenticate.timeout ? 'timeout' : 'ok')),
  prompt: r.prompt ? (r.prompt.error ?? r.prompt.result ?? 'timeout') : undefined,
  promptMs: r.prompt?.ms,
  xaiNotifications: [...new Set(r.notifications.filter((n) => n.method.startsWith('_')).map((n) => n.method))],
  turnResult: r.notifications.filter((n) => n.params?.update?.sessionUpdate === 'turn_completed' || n.params?.update?.sessionUpdate === 'retry_state').map((n) => n.params.update),
  agentText: r.agentText || undefined,
  agentRequests: r.agentRequests.map((q) => q.method),
  stop: r.stop,
  processTree: r.processTree,
});
log('SUMMARY', { agent: AGENT, os: `${process.platform}-${process.arch}`, pinned: results.pinned, install: results.install, grokBinary: results.grokBinary, authMethodsWithBrowser: results.initWithBrowser.initialize.result?.authMethods, noAuth: s(results.noAuth), dummyKey: s(results.dummyKey), initialModeAsk: results.initialModeAsk && s(results.initialModeAsk), reopen: results.reopen && s(results.reopen), keyNoAuth: results.keyNoAuth && s(results.keyNoAuth) });

try { rmSync(root, { recursive: true, force: true }); } catch (e) { console.log(`cleanup: ${e.code}`); }
