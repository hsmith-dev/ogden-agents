// SPIKE 16.1 (TEMPORARY): shared helpers for the probes. Everything runs through the repo's own
// `terminal-pty` adapter (the real `node-pty` loader, retry and tree kill) and `child-env` allowlist.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseEnvironment } from '../../../packages/adapters/src/child-env.ts';
import { loadPty } from '../../../packages/adapters/src/terminal-pty/index.ts';
import { trimBacklog } from '../../../packages/core/src/chat/terminal-backlog.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const SPIKE_DIR = join(here, '..');
export const FAKE = join(SPIKE_DIR, 'fake-cli.mjs');
export const LEG = process.env.SPIKE_LEG ?? `${process.platform}-${process.arch}`;
export const OUT_DIR = process.env.SPIKE_OUT ?? join(SPIKE_DIR, 'out');
export const IS_WIN = process.platform === 'win32';
const require = createRequire(import.meta.url);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, fractional

export function stats(values) {
  if (values.length === 0) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const r = (x) => Math.round(x * 100) / 100;
  return { n: sorted.length, min: r(sorted[0]), p50: r(at(0.5)), p95: r(at(0.95)), max: r(sorted[sorted.length - 1]), mean: r(mean) };
}

/** Collects findings for one probe file and writes them (JSON and a markdown table) when flushed. */
export function createRecorder(name) {
  const data = { leg: LEG, probe: name, platform: process.platform, arch: process.arch, node: process.version, findings: {} };
  return {
    set(key, value) {
      data.findings[key] = value;
      console.log(`[finding ${LEG}/${name}] ${key} = ${JSON.stringify(value)}`);
    },
    flush() {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, `findings-${LEG}-${name}.json`), JSON.stringify(data, null, 2));
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (summary) {
        const lines = [`### ${LEG}: ${name}`, '', '| finding | value |', '|---|---|'];
        for (const [k, v] of Object.entries(data.findings)) lines.push(`| ${k} | \`${JSON.stringify(v).replace(/\|/g, '\\|').slice(0, 400)}\` |`);
        appendFileSync(summary, `${lines.join('\n')}\n\n`);
      }
    },
  };
}

/** The environment a pane child gets: the AD-16 base allowlist, plus `extra` (a test names each addition). */
export function paneEnv(extra = {}, source = process.env) {
  return { ...baseEnvironment(source), ...extra };
}

/** `[file, args]` that run the fake CLI in `mode` with this Node. */
export const fakeCommand = (mode, ...args) => [process.execPath, [FAKE, mode, ...args.map(String)]];

let ptyLoad;
export async function pty() {
  ptyLoad ??= await loadPty();
  if (!ptyLoad.ok) throw new Error(`node-pty did not load: ${ptyLoad.reason}`);
  return ptyLoad;
}

/** Opens one pane (a real PTY through terminal-pty) and collects what it prints. */
export async function openPane({ file, args, cols = 100, rows = 30, env = paneEnv(), cwd = process.cwd() }) {
  const loaded = await pty();
  const startedAt = now();
  const handle = loaded.spawnHidden(file, args, { env, cwd, cols, rows });
  const spawnMs = now() - startedAt;
  const pane = {
    handle,
    pid: handle.pid,
    spawnMs,
    text: '',
    bytes: 0,
    firstDataMs: undefined,
    exit: undefined,
    listeners: new Set(),
    write: (data) => handle.write(data),
    resize: (c, r) => handle.resize?.(c, r),
    kill: () => handle.kill(),
    waitFor(pattern, timeoutMs = 15_000, from = 0) {
      // Event driven (no polling floor), so latency numbers are the real round trip.
      const matches = () => (typeof pattern === 'string' ? pane.text.indexOf(pattern, from) !== -1 : pattern.test(pane.text.slice(from)));
      const t0 = now();
      return new Promise((resolve, reject) => {
        if (matches()) return resolve(now() - t0);
        const timer = setTimeout(() => {
          pane.listeners.delete(check);
          reject(new Error(`timed out after ${timeoutMs} ms waiting for ${pattern}; got ${JSON.stringify(pane.text.slice(-300))}`));
        }, timeoutMs);
        const check = () => {
          if (!matches()) return;
          clearTimeout(timer);
          pane.listeners.delete(check);
          resolve(now() - t0);
        };
        pane.listeners.add(check);
      });
    },
    exited: undefined,
  };
  pane.exited = new Promise((resolve) => {
    handle.onExit((exit) => {
      pane.exit = { ...exit, atMs: now() };
      resolve(pane.exit);
    });
  });
  handle.onData((data) => {
    pane.firstDataMs ??= now() - startedAt;
    pane.text += data;
    pane.bytes += Buffer.byteLength(data);
    for (const listener of pane.listeners) listener(data);
  });
  return pane;
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function waitDead(pid, timeoutMs = 8000) {
  const t0 = now();
  while (alive(pid)) {
    if (now() - t0 > timeoutMs) return false;
    await sleep(25);
  }
  return true;
}

/** Resident memory (MB) of the given pids, or undefined where it can't be read. */
export function rssMb(pids) {
  const list = pids.filter((p) => Number.isInteger(p));
  if (list.length === 0) return 0;
  try {
    if (IS_WIN) {
      const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${list.join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`], { encoding: 'utf8', env: baseEnvironment() });
      return Math.round((Number(ps.stdout.trim()) / 1048576) * 10) / 10;
    }
    const ps = spawnSync('ps', ['-o', 'rss=', '-p', list.join(',')], { encoding: 'utf8' });
    const kb = ps.stdout.split(/\s+/).filter(Boolean).reduce((a, b) => a + Number(b), 0);
    return Math.round((kb / 1024) * 10) / 10;
  } catch {
    return undefined;
  }
}

/** Counts processes by image name (Windows: how many ConPTY hosts a pane costs). */
export function countProcesses(names) {
  if (!IS_WIN) return undefined;
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Name ${names.join(',')} -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`], { encoding: 'utf8', env: baseEnvironment() });
  return Number(ps.stdout.trim() || 0);
}

/** A process Ogden did NOT start: detached, no pty, its own group. The kill probes must never touch it. */
export function startBystander(args = ['-e', 'setInterval(()=>{},1000)'], extra = {}) {
  const child = spawn(process.execPath, args, { stdio: 'ignore', detached: true, windowsHide: true, ...extra });
  child.unref();
  return child;
}

export const ESC_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;
export const stripAnsi = (text) => text.replace(ESC_RE, '');

/** xterm-headless and its serialize addon (a server-side mirror of a pane's screen). */
export function headless(cols, rows, scrollback = 10_000) {
  const { Terminal } = require('@xterm/headless');
  const { SerializeAddon } = require('@xterm/addon-serialize');
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  const flush = () => new Promise((resolve) => term.write('', resolve));
  const lines = (from = 0) => {
    const out = [];
    const buf = term.buffer.active;
    for (let i = from; i < buf.length; i += 1) out.push(buf.getLine(i)?.translateToString(true) ?? '');
    return out;
  };
  return { term, serializer, flush, lines, serialize: (opts) => serializer.serialize(opts) };
}

/**
 * The server-side half of a pane as epic 16 would build it: the pty (through `terminal-pty`), a raw backlog
 * trimmed like epic 3's (`trimBacklog`, 64 KiB), an optional headless mirror, and the set of pids this host
 * started (the only ones it may ever kill).
 */
export class PaneHost {
  constructor({ mirror = true, rawChars = 64 * 1024, scrollback = 10_000 } = {}) {
    this.panes = new Map();
    this.mirror = mirror;
    this.rawChars = rawChars;
    this.scrollback = scrollback;
  }

  async open(id, { file, args, cols = 100, rows = 30, env = paneEnv(), cwd = process.cwd(), trimText = false }) {
    const pane = await openPane({ file, args, cols, rows, env, cwd });
    const entry = { id, pane, raw: '', viewers: new Set(), cols, rows, mirror: this.mirror ? headless(cols, rows, this.scrollback) : undefined, mirrorWork: 0 };
    if (trimText) pane.listeners.add(() => { if (pane.text.length > 200_000) pane.text = pane.text.slice(-100_000); });
    pane.listeners.add((data) => {
      entry.raw += data;
      if (entry.raw.length > this.rawChars * 2) entry.raw = trimBacklog(entry.raw, this.rawChars);
      if (entry.mirror) {
        const t0 = now();
        entry.mirror.term.write(data);
        entry.mirrorWork += now() - t0;
      }
      for (const viewer of entry.viewers) viewer(data);
    });
    this.panes.set(id, entry);
    return entry;
  }

  resize(id, cols, rows) {
    const entry = this.panes.get(id);
    if (!entry) return;
    entry.cols = cols;
    entry.rows = rows;
    entry.pane.resize(cols, rows);
    entry.mirror?.term.resize(cols, rows);
  }

  get pids() {
    return [...this.panes.values()].map((e) => e.pane.pid);
  }

  /** Stops only what this host started. */
  closeAll() {
    for (const entry of this.panes.values()) entry.pane.kill();
  }
}
