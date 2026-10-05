// TEMPORARY (epic 14, spike 14.1): a minimal ACP client over newline-delimited JSON-RPC,
// and process helpers. Grown from the epic 12 probe.
import { spawn, spawnSync } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';

export function processTable() {
  if (IS_WIN) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    try { return JSON.parse(r.stdout).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name })); } catch { return []; }
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return m ? { pid: +m[1], ppid: +m[2], name: m[3].split('/').pop() } : null;
  }).filter(Boolean);
}
export function descendants(pid, table = processTable()) {
  const out = [];
  const walk = (p) => { for (const c of table) if (c.ppid === p) { out.push(c); walk(c.pid); } };
  walk(pid);
  return out;
}
export const alive = (pid) => processTable().some((p) => p.pid === pid);

export class Acp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.agentRequests = [];
    this.stderr = '';
    this.buf = '';
    this.permissionPolicy = () => ({ outcome: 'cancelled' });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => this.onData(d));
    child.stdout.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (this.stderr.length < 60000) this.stderr += d; });
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
      } else if (msg.method && msg.id !== undefined) this.onAgentRequest(msg);
      else if (msg.method) this.notifications.push({ at: Date.now(), ...msg });
    }
  }
  onAgentRequest(msg) {
    this.agentRequests.push({ at: Date.now(), method: msg.method, params: msg.params });
    if (msg.method === 'session/request_permission') {
      const choice = this.permissionPolicy(msg.params);
      this.write({ jsonrpc: '2.0', id: msg.id, result: { outcome: choice.outcome === 'cancelled' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: choice.optionId } } });
    } else this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'probe client does not implement this' } });
  }
  write(obj) { try { this.child.stdin.write(`${JSON.stringify(obj)}\n`); } catch {} }
  request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    const t = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ timeout: true, ms: Date.now() - t }); }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve({ ms: Date.now() - t, ...(msg.error ? { error: msg.error } : { result: msg.result }) }); });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }
  mark() { return { n: this.notifications.length, r: this.agentRequests.length }; }
  since(m) { return { notifications: this.notifications.slice(m.n), requests: this.agentRequests.slice(m.r) }; }
}

export function startAgent({ cmd, args, env, cwd, wrap = null }) {
  const full = wrap ? wrap(cmd, args) : { cmd, args };
  const child = spawn(full.cmd, full.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  return { child, acp: new Acp(child), spawnedAt: Date.now() };
}

export async function stopAgent(child, treeOf = child.pid) {
  const table = processTable();
  const tree = descendants(treeOf, table);
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  child.stdin.end();
  const graceful = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 5000))]);
  const stop = { exitedOnStdinClose: !!graceful };
  if (!graceful) {
    if (IS_WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); else child.kill();
    stop.afterKill = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 5000))]);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const orphans = tree.filter((p) => alive(p.pid));
  stop.orphans = orphans.map((p) => `${p.name}(${p.pid})`);
  for (const p of orphans) { if (IS_WIN) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']); else try { process.kill(p.pid, 'SIGKILL'); } catch {} }
  return { tree: tree.map((p) => p.name), stop };
}
