// @ts-nocheck
// TEMPORARY (epic 14, spike 14.1): records every outbound connection attempt a process tree makes.
// Layers (each OS has the first two; extra layers are per OS, see probe.mjs):
//  1. a recording HTTP proxy on loopback (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY point at it; it
//     logs the destination and answers 502): names every host a proxy-aware client tried.
//  2. a socket poller: every 150-400 ms lists the sockets of the child's process tree
//     (lsof on macOS, ss on Linux, netstat on Windows) and keeps every non-loopback remote.
import http from 'node:http';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { IS_WIN, descendants } from './acp.mjs';

export const isLoopback = (a) => /^(127\.|::1$|\[::1\]|::ffff:127\.|localhost)/i.test(String(a).replace(/^\[|\]$/g, '').replace(/:\d+$/, '')) || /^\[?::1\]?(:\d+)?$/.test(String(a));

export function startProxy() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ kind: 'http', method: req.method, url: String(req.url).slice(0, 200), host: req.headers.host });
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('blocked by the probe');
  });
  server.on('connect', (req, socket) => {
    hits.push({ kind: 'connect', target: req.url });
    socket.on('error', () => {});
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  server.on('connection', (s) => s.on('error', () => {}));
  server.on('clientError', (_e, socket) => { try { socket.destroy(); } catch {} });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, hits,
    env: (() => { const u = `http://127.0.0.1:${server.address().port}`; return { HTTP_PROXY: u, HTTPS_PROXY: u, ALL_PROXY: u, http_proxy: u, https_proxy: u, all_proxy: u, NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1' }; })(),
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

function snapshot(pids) {
  const out = [];
  if (!pids.length) return out;
  if (IS_WIN) {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    for (const l of (r.stdout ?? '').split('\n')) {
      const m = l.trim().match(/^(TCP|UDP)\s+(\S+)\s+(\S+)\s+(?:(\S+)\s+)?(\d+)$/);
      if (!m || !pids.includes(Number(m[5]))) continue;
      out.push({ proto: m[1], local: m[2], remote: m[3], state: m[4] ?? '', pid: Number(m[5]) });
    }
  } else if (process.platform === 'darwin') {
    const r = spawnSync('lsof', ['-nP', '-i', '-a', '-p', pids.join(',')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    for (const l of (r.stdout ?? '').split('\n').slice(1)) {
      const m = l.match(/^(\S+)\s+(\d+)\s.*?(TCP|UDP)\s+(\S+?)->(\S+?)(?:\s+\((\w+)\))?\s*$/);
      if (m) out.push({ proto: m[3], local: m[4], remote: m[5], state: m[6] ?? '', pid: Number(m[2]), comm: m[1] });
    }
  } else {
    const r = spawnSync('ss', ['-H', '-tunap'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    for (const l of (r.stdout ?? '').split('\n')) {
      const f = l.trim().split(/\s+/);
      if (f.length < 6) continue;
      const pm = l.match(/pid=(\d+)/);
      if (!pm || !pids.includes(Number(pm[1]))) continue;
      out.push({ proto: f[0], state: f[1], local: f[4], remote: f[5], pid: Number(pm[1]) });
    }
  }
  return out;
}

export function startWatcher(rootPid, intervalMs = IS_WIN ? 500 : 150) {
  const seen = new Map();
  let stopped = false;
  let pids = [rootPid];
  let pidsAt = 0;
  const tick = () => {
    if (stopped) return;
    // listing the process table is slow on Windows (PowerShell): refresh it every 3 s there
    if (!IS_WIN || Date.now() - pidsAt > 3000) { pids = [rootPid, ...descendants(rootPid).map((p) => p.pid)]; pidsAt = Date.now(); }
    for (const s of snapshot(pids)) {
      if (!s.remote || /^(\*|0\.0\.0\.0|\[::\]|::):?(\*|0)$/.test(s.remote) || s.remote === '*:*') continue;
      const key = `${s.proto} ${s.remote}`;
      if (!seen.has(key)) seen.set(key, { ...s, loopback: isLoopback(s.remote), first: Date.now() });
    }
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, 0);
  return { stop: () => { stopped = true; return [...seen.values()]; } };
}

export function tcpPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => { const s = net.connect(port, host); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
}
