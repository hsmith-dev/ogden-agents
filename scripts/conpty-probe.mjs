#!/usr/bin/env node
// TEMPORARY (story 3.8): a ConPTY probe for the windows-latest CI runner, run by
// the `conpty-probe` job in ci.yml. It prints facts only: versions, sizes,
// exit codes, pids and the hex of its own test strings, never other terminal
// bytes. Removed before the story's review.
//
//   node scripts/conpty-probe.mjs            every section
//   node scripts/conpty-probe.mjs claude     only the real `claude` section
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { release, tmpdir, version as osVersion } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pty = require('node-pty');
const ptyVersion = JSON.parse(readFileSync(require.resolve('node-pty/package.json'), 'utf8')).version;
const dir = mkdtempSync(join(tmpdir(), 'conpty-probe-'));
const STEP_MS = 10_000;

const log = (...parts) => console.log('[probe]', ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const strip = (text) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b[()][A-Za-z0-9]/g, '');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const taskkill = (pid) => spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
const skipConsoleList = (term) => {
  if (term._agent && typeof term._agent._getConsoleProcessList === 'function') term._agent._getConsoleProcessList = () => Promise.resolve([]);
};

/** Writes a child script and returns its path. */
function script(name, source) {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, source);
  return file;
}

/** Spawns `node <file>` in a pseudo-terminal and collects its output; resolves `{ term, out(), exited }`. */
function start(file, { dll = false, cols = 80, rows = 24, env = {} } = {}) {
  const term = pty.spawn(process.execPath, [file], { name: 'xterm-256color', cols, rows, cwd: dir, env: { ...process.env, ...env }, useConptyDll: dll });
  let output = '';
  let exit;
  const exited = new Promise((resolve) => {
    term.onExit((e) => {
      exit = e;
      resolve(e);
    });
  });
  term.onData((data) => (output += data));
  return { term, out: () => output, exited, exitInfo: () => exit };
}

async function waitFor(predicate, ms = STEP_MS) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await sleep(50);
  }
  return false;
}

async function cap(name, fn) {
  log(`--- ${name} ---`);
  try {
    await Promise.race([fn(), sleep(STEP_MS * 3).then(() => log(`${name}: TIMED OUT (step cap)`))]);
  } catch (error) {
    log(`${name}: ERROR ${error?.message ?? error}`);
  }
}

// ---------------------------------------------------------------- versions
async function versions() {
  log('os.release', release(), '| os.version', osVersion(), '| node', process.version, '| node-pty', ptyVersion, '| arch', process.arch);
  for (const dll of [false, true]) {
    try {
      const { term, exited } = start(script('noop', 'setTimeout(() => {}, 300);'), { dll });
      log(`useConptyDll option=${dll}: _agent._useConpty=${term._agent?._useConpty} _agent._useConptyDll=${term._agent?._useConptyDll}`);
      await Promise.race([exited, sleep(3000)]);
      try {
        term.kill();
      } catch {}
    } catch (error) {
      log(`useConptyDll option=${dll}: spawn ERROR ${error?.message}`);
    }
  }
}

// ---------------------------------------------------------------- resize
const lineChild = script(
  'resize-line',
  `import { createInterface } from 'node:readline';
const ws = () => process.stdout.getWindowSize?.() ?? [process.stdout.columns, process.stdout.rows];
createInterface({ input: process.stdin }).on('line', () => {});
let n = 0;
process.stdout.write('ready\\r\\n');
setInterval(() => { const [c, r] = ws(); process.stdout.write('L' + (n++) + '=' + c + 'x' + r + ' C=' + process.stdout.columns + 'x' + process.stdout.rows + '\\r\\n'); }, 250);
`,
);
const rawChild = script(
  'resize-raw',
  `const ws = () => process.stdout.getWindowSize?.() ?? [process.stdout.columns, process.stdout.rows];
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdout.on('resize', () => { const [c, r] = ws(); process.stdout.write('EV=' + c + 'x' + r + '\\r\\n'); });
let n = 0;
process.stdout.write('ready\\r\\n');
setInterval(() => { const [c, r] = ws(); process.stdout.write('R' + (n++) + '=' + c + 'x' + r + '\\r\\n'); }, 250);
`,
);
const modeChild = script(
  'resize-mode',
  `import { spawnSync } from 'node:child_process';
process.stdout.write('ready\\r\\n');
let n = 0;
const tick = () => { process.stdout.write('M' + (n++) + '\\r\\n'); spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'mode con'], { stdio: 'inherit', windowsHide: true }); };
setInterval(tick, 250);
`,
);

async function resizeCase(mode, file, dll) {
  const run = start(file, { dll });
  if (!(await waitFor(() => strip(run.out()).includes('ready')))) {
    log(`resize ${mode} dll=${dll}: no ready; exit=${JSON.stringify(run.exitInfo())}`);
    return;
  }
  await sleep(600);
  const before = strip(run.out());
  run.term.resize(100, 30);
  const resizedAt = before.length;
  await sleep(5000);
  const after = strip(run.out()).slice(resizedAt);
  const summarize = (text) => {
    if (mode === 'mode-con') {
      const cols = [...text.matchAll(/Columns:\s*(\d+)/g)].map((m) => m[1]);
      const lines = [...text.matchAll(/Lines:\s*(\d+)/g)].map((m) => m[1]);
      return `Columns=[${[...new Set(cols)]}] Lines=[${[...new Set(lines)]}] (samples ${cols.length})`;
    }
    const sizes = [...text.matchAll(/[LR]\d+=(\d+x\d+)/g)].map((m) => m[1]);
    const cols = [...text.matchAll(/C=(\S+x\S+)/g)].map((m) => m[1]);
    const events = [...text.matchAll(/EV=(\d+x\d+)/g)].map((m) => m[1]);
    const firstNew = sizes.findIndex((s) => s === '100x30');
    return `getWindowSize distinct=[${[...new Set(sizes)]}] samples=${sizes.length} first100x30AtSample=${firstNew}` + (mode === 'line' ? ` columns/rows distinct=[${[...new Set(cols)]}]` : '') + (mode === 'raw' ? ` resizeEvents=[${events}]` : '');
  };
  log(`resize ${mode} dll=${dll}: BEFORE ${summarize(before)}`);
  log(`resize ${mode} dll=${dll}: AFTER resize(100,30): ${summarize(after)}`);
  taskkill(run.term.pid);
  skipConsoleList(run.term);
  try {
    run.term.kill();
  } catch {}
  await Promise.race([run.exited, sleep(2000)]);
}

async function resize() {
  for (const dll of [false, true]) {
    for (const [mode, file] of [
      ['line', lineChild],
      ['raw', rawChild],
      ['mode-con', modeChild],
    ]) {
      await cap(`resize ${mode} dll=${dll}`, () => resizeCase(mode, file, dll));
    }
  }
}

// ---------------------------------------------------------------- exit
const exitChild = script(
  'exit-parent',
  `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const stdio = process.env.GC_STDIO === 'pipe' ? ['ignore', 'pipe', 'ignore'] : 'ignore';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio, windowsHide: true });
writeFileSync(process.env.GC_FILE, String(child.pid));
process.stdout.write('gc=' + child.pid + '\\r\\n');
setTimeout(() => process.exit(0), 500);
`,
);

async function exitCase(dll, gcStdio, killVariant) {
  const label = `exit dll=${dll} gcStdio=${gcStdio} kill=${killVariant}`;
  const gcFile = join(dir, `gc-${dll}-${gcStdio}-${killVariant}.txt`);
  const t0 = Date.now();
  const run = start(exitChild, { dll, env: { GC_FILE: gcFile, GC_STDIO: gcStdio } });
  const cliPid = run.term.pid;
  const exitedInTime = await Promise.race([run.exited.then(() => true), sleep(8000).then(() => false)]);
  const gc = existsSync(gcFile) ? Number(readFileSync(gcFile, 'utf8')) : undefined;
  log(`${label}: onExit fired=${exitedInTime} after ${Date.now() - t0}ms exit=${JSON.stringify(run.exitInfo())} cliAlive=${alive(cliPid)} grandchild=${gc}`);
  await sleep(2000);
  log(`${label}: 2s after the CLI exit, grandchild alive=${gc ? alive(gc) : 'n/a'}`);
  console.error(`[probe-stderr] ${label}: before kill()`);
  if (killVariant === 'skipList') skipConsoleList(run.term);
  try {
    run.term.kill();
    log(`${label}: kill() returned`);
  } catch (error) {
    log(`${label}: kill() threw ${error?.message}`);
  }
  await sleep(3000);
  console.error(`[probe-stderr] ${label}: 3s after kill()`);
  log(`${label}: 3s after kill(), grandchild alive=${gc ? alive(gc) : 'n/a'}`);
  if (gc && alive(gc)) {
    taskkill(gc);
    await sleep(500);
    log(`${label}: cleanup taskkill grandchild, alive=${alive(gc)}`);
  }
}

async function exitSection() {
  for (const dll of [false, true]) {
    for (const gcStdio of ['ignore', 'pipe']) {
      for (const killVariant of ['skipList', 'default']) {
        await cap(`exit dll=${dll} gcStdio=${gcStdio} kill=${killVariant}`, () => exitCase(dll, gcStdio, killVariant));
      }
    }
  }
}

// ---------------------------------------------------------------- input
const inputChild = script(
  'input',
  `process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\\x1b[?2004h');
process.on('SIGINT', () => process.stdout.write('SIGINT\\r\\n'));
process.stdin.on('data', (d) => process.stdout.write('HEX=' + Buffer.from(d).toString('hex') + '\\r\\n'));
process.stdout.write('ready\\r\\n');
process.stdout.write('\\x1b[38;2;12;34;56mTC\\x1b[0m\\r\\n');
setTimeout(() => process.exit(0), 8000);
`,
);

async function inputCase(dll) {
  const run = start(inputChild, { dll });
  if (!(await waitFor(() => strip(run.out()).includes('ready')))) {
    log(`input dll=${dll}: no ready`);
    return;
  }
  await sleep(500);
  const raw = run.out();
  const sgr = raw.match(/\x1b\[[0-9;]*m(?=TC)/)?.[0];
  log(`input dll=${dll}: truecolour SGR before "TC" = ${sgr ? Buffer.from(sgr).toString('hex') : 'none'} (sent 1b5b33383b323b31323b33343b35366d) unchanged=${sgr === '\x1b[38;2;12;34;56m'}; output contains ?2004h=${raw.includes('\x1b[?2004h')}`);
  const mark = strip(run.out()).length;
  run.term.write('\x1b[200~pa ste\x1b[201~');
  await sleep(1000);
  log(`input dll=${dll}: after bracketed paste (sent 1b5b3230307e7061207374651b5b3230317e): ${[...strip(run.out()).slice(mark).matchAll(/HEX=([0-9a-f]+)/g)].map((m) => m[1]).join(' | ') || 'nothing'}`);
  const mark2 = strip(run.out()).length;
  run.term.write('\x03');
  await sleep(1000);
  const tail = strip(run.out()).slice(mark2);
  log(`input dll=${dll}: after Ctrl+C (sent 03): hex=[${[...tail.matchAll(/HEX=([0-9a-f]+)/g)].map((m) => m[1])}] SIGINT=${tail.includes('SIGINT')} childExited=${run.exitInfo() !== undefined} exit=${JSON.stringify(run.exitInfo())}`);
  taskkill(run.term.pid);
  skipConsoleList(run.term);
  try {
    run.term.kill();
  } catch {}
  await Promise.race([run.exited, sleep(2000)]);
}

// ---------------------------------------------------------------- real claude
async function claudeSection() {
  let where = '';
  try {
    where = execFileSync('where', ['claude'], { encoding: 'utf8' });
  } catch (error) {
    where = `where failed: ${error?.message}`;
  }
  log(`where claude:\n${where}`);
  const prefix = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm prefix -g'], { encoding: 'utf8' }).trim();
  log(`npm prefix -g = ${prefix}`);
  for (const name of ['claude', 'claude.cmd', 'claude.ps1', 'claude.exe']) log(`${name} in prefix: ${existsSync(join(prefix, name))}`);
  const shim = join(prefix, 'claude.cmd');
  if (existsSync(shim)) {
    const text = readFileSync(shim, 'utf8');
    const targets = [...text.matchAll(/"%(?:~dp0|dp0%)%?\\([^"]+)"/g)].map((m) => m[1]);
    log(`claude.cmd targets: ${JSON.stringify(targets)}`);
    log(`claude.cmd body:\n${text}`);
  }
  const pkg = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code');
  try {
    log(`package version ${JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version}; bin field ${JSON.stringify(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).bin)}`);
    log(`bin/: ${readdirSync(join(pkg, 'bin')).join(', ')}`);
  } catch (error) {
    log(`package read ERROR ${error?.message}`);
  }
  const exe = join(pkg, 'bin', 'claude.exe');
  log(`claude.exe beside the shim at node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe: ${existsSync(exe)} (shim dir ${dirname(shim)})`);
  if (existsSync(exe)) {
    const term = pty.spawn(exe, ['--version'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: dir, env: process.env });
    let out = '';
    term.onData((d) => (out += d));
    const exit = await Promise.race([new Promise((r) => term.onExit(r)), sleep(STEP_MS).then(() => 'timeout')]);
    log(`claude.exe --version through node-pty: exit=${JSON.stringify(exit)} version=${JSON.stringify(strip(out).match(/\d+\.\d+\.\d+[^\s]*/)?.[0] ?? null)}`);
    if (exit === 'timeout') {
      taskkill(term.pid);
    }
  }
}

const only = process.argv[2];
if (only === 'claude') {
  await cap('real claude', claudeSection);
} else {
  await cap('versions', versions);
  await resize();
  await exitSection();
  for (const dll of [false, true]) await cap(`input dll=${dll}`, () => inputCase(dll));
}
log('done');
process.exit(0);
