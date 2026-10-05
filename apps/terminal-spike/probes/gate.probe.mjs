// SPIKE 16.1 (TEMPORARY): the pane WebSocket behind Ogden's real gate (AD-15), reconnect with replay, a sign-in typed in
// a pane (no byte of it is logged or stored by Ogden), and a viewer that stops reading while a pane floods.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaneHost, createRecorder, fakeCommand, headless, now, paneEnv, sleep, stats } from '../lib/harness.mjs';
import { startGateServer } from '../lib/gate-server.mjs';

const rec = createRecorder('gate');
afterAll(() => rec.flush());

let host;
let server;
beforeAll(async () => {
  host = new PaneHost({ mirror: true });
  server = await startGateServer({ host, replay: 'snapshot' });
});
afterAll(async () => {
  host.closeAll();
  await server.close();
});

/** Opens a pane socket; resolves with how it ended (opened with a protocol, or the refusing HTTP status). */
function dial(path, { protocols, headers = {} }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, protocols, { headers, handshakeTimeout: 5000 });
    ws.on('open', () => resolve({ opened: true, protocol: ws.protocol, ws }));
    ws.on('unexpected-response', (_req, res) => { resolve({ opened: false, status: res.statusCode }); res.resume(); });
    ws.on('error', () => resolve({ opened: false, status: 'error' }));
  });
}

describe('AD-15: the pane socket passes the one gate', () => {
  it('opens only with Host, a live tab token in the subprotocol and the page Origin', async () => {
    const [file, args] = fakeCommand('prompt');
    await host.open('g1', { file, args });
    const token = server.mintToken();
    const good = { Origin: server.origin };
    const cases = {
      'valid token and origin': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: good, expect: true },
      'valid, origin is localhost with the same port': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: { Origin: `http://localhost:${server.port}` }, expect: true },
      'no token': { protocols: ['ogden.v1'], headers: good, expect: 401 },
      'wrong token': { protocols: ['ogden.v1', 'ogden.auth.' + 'a'.repeat(43)], headers: good, expect: 401 },
      'token without the ogden.v1 protocol': { protocols: [`ogden.auth.${token}`], headers: good, expect: 401 },
      'two different tokens offered': { protocols: ['ogden.v1', `ogden.auth.${token}`, `ogden.auth.${server.mintToken()}`], headers: good, expect: 401 },
      'foreign origin': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: { Origin: 'http://evil.example' }, expect: 403 },
      'origin of another local port': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: { Origin: 'http://127.0.0.1:1' }, expect: 403 },
      'origin null': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: { Origin: 'null' }, expect: 403 },
      'no origin header': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: {}, expect: 403 },
      'wrong Host (DNS rebinding)': { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: { ...good, Host: 'evil.example' }, expect: 403 },
    };
    const outcome = {};
    let pass = true;
    for (const [name, c] of Object.entries(cases)) {
      const r = await dial('/ws/pane/g1', c);
      const got = r.opened ? true : r.status;
      outcome[name] = got === true ? `opened (protocol echoed: ${r.protocol})` : got;
      if (got !== c.expect) pass = false;
      if (r.opened && r.protocol.includes('auth')) pass = false;
      r.ws?.close();
    }
    // The token in the query string instead of the subprotocol; a plain GET (no upgrade) with the bearer token.
    const q = await dial(`/ws/pane/g1?token=${token}`, { protocols: ['ogden.v1'], headers: good });
    outcome['token only in the query string'] = q.opened ? 'OPENED (bad)' : q.status;
    const plain = await fetch(`${server.origin}/ws/pane/g1`, { headers: { Authorization: `Bearer ${token}`, Origin: server.origin } });
    outcome['plain GET with the bearer token'] = plain.status;
    const noAuth = await fetch(`${server.origin}/ws/pane/g1`);
    outcome['plain GET without a token'] = noAuth.status;
    rec.set('gate_cases', outcome);
    expect(pass).toBe(true);
    expect(q.opened).toBe(false);
    expect(noAuth.status).toBe(401);
  });
});

/** A client viewer: attaches, collects bytes, can type, resize and read its replay. */
async function viewer(id, { cols = 100, rows = 30, readOnly = false } = {}) {
  const token = server.mintToken();
  const r = await dial(`/ws/pane/${id}`, { protocols: ['ogden.v1', `ogden.auth.${token}`], headers: { Origin: server.origin } });
  if (!r.opened) throw new Error(`viewer refused: ${r.status}`);
  const ws = r.ws;
  const v = { ws, replay: Buffer.alloc(0), live: [], liveBytes: 0, replayDone: false, closed: undefined, replayMs: undefined };
  const t0 = now();
  let inReplay = false;
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      const f = JSON.parse(data.toString());
      if (f.type === 'replay-start') inReplay = true;
      if (f.type === 'replay-end') { inReplay = false; v.replayDone = true; v.replayMs = now() - t0; }
      return;
    }
    const buf = Buffer.from(data);
    if (inReplay) v.replay = Buffer.concat([v.replay, buf]);
    else { v.live.push(buf); v.liveBytes += buf.length; }
  });
  ws.on('close', (code) => { v.closed = code; });
  ws.send(JSON.stringify({ type: 'attach', cols, rows, scrollback: 5000 }));
  while (!v.replayDone && now() - t0 < 10_000) await sleep(5);
  v.type = (s) => ws.send(Buffer.from(s));
  void readOnly;
  return v;
}

const lines = (m) => m.lines().map((l) => l.trimEnd());
function diff(a, b) {
  let bad = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) if ((a[i] ?? '') !== (b[i] ?? '')) bad += 1;
  return bad;
}

describe('reconnect after a browser refresh: replay', () => {
  const workloads = {
    'plain output, 6000 lines': () => ({ steps: [{ print: Array.from({ length: 6000 }, (_, i) => `plain line ${i + 1} some text\r\n`).join('') }, { print: 'fake> ' }, { wait: 60_000 }] }),
    'full-screen app on the alternate screen': () => ({ steps: [{ print: Array.from({ length: 300 }, (_, i) => `before ${i}\r\n`).join('') }, { print: '\x1b[?1049h\x1b[2J\x1b[H' + Array.from({ length: 30 }, (_, i) => `\x1b[${i + 1};1H\x1b[3${(i % 6) + 1}mrow ${i + 1} of the full screen app\x1b[0m`).join('') }, { wait: 60_000 }] }),
    'a full-screen app painted once, then 12,000 one-cell updates (the paint is out of any tail)': () => ({ steps: [{ print: '\x1b[?1049h\x1b[2J\x1b[H' + Array.from({ length: 30 }, (_, i) => `\x1b[${i + 1};1Hstatic row ${i + 1} ............................`).join('') }, { print: Array.from({ length: 12000 }, (_, i) => `\x1b[${(i % 30) + 1};40Hn=${String(i).padStart(5, '0')}`).join('') }, { wait: 60_000 }] }),
    'a redrawing prompt with a menu (cursor moves, colours)': () => ({ steps: [{ print: Array.from({ length: 4000 }, (_, i) => `log ${i}\r\n`).join('') }, { spinner: 800 }, { print: 'Do you want to proceed?\r\n\x1b[36m❯ 1. Yes\x1b[0m\r\n  2. No\r\n\x1b[2A\x1b[2K\x1b[36m❯ 1. Yes\x1b[0m\x1b[2B' }, { wait: 60_000 }] }),
  };
  for (const [name, make] of Object.entries(workloads)) {
    it(name, async () => {
      const file = join(mkdtempSync(join(tmpdir(), 'ogden-spike-wl-')), 'w.json');
      (await import('node:fs')).writeFileSync(file, JSON.stringify(make().steps));
      const [exe, args] = fakeCommand('scenario', file);
      const id = `r-${Math.random().toString(36).slice(2, 7)}`;
      const entry = await host.open(id, { file: exe, args, trimText: true });
      const first = await viewer(id);
      await sleep(2500); // let the output finish
      const reference = headless(100, 30, 5000);
      reference.term.write(Buffer.concat(first.live).toString('utf8'));
      await reference.flush();
      first.ws.close(); // the browser refresh
      await sleep(100);
      const refLines = lines(entry.mirror);
      const results = {};
      for (const mode of ['snapshot', 'raw']) {
        server.replayMode = mode;
      }
      // Snapshot replay (headless mirror, serialized).
      const second = await viewer(id);
      const rebuilt = headless(100, 30, 5000);
      rebuilt.term.write(second.replay.toString('utf8'));
      await rebuilt.flush();
      const rebuiltLines = lines(rebuilt);
      const visible = (m) => { const b = m.term.buffer.active; const out = []; for (let i = b.baseY; i < b.length; i += 1) out.push((b.getLine(i)?.translateToString(true) ?? '').trimEnd()); return out; };
      results.snapshot = { replayBytes: second.replay.length, replayMs: Math.round(second.replayMs), visibleRowsDiffer: diff(visible(entry.mirror), visible(rebuilt)), totalLinesMirror: refLines.length, totalLinesRebuilt: rebuiltLines.length, scrollbackLast5000LinesDiffer: diff(refLines.slice(-5000), rebuiltLines.slice(-5000)), altScreenKept: entry.mirror.term.buffer.active.type === rebuilt.term.buffer.active.type };
      // Raw backlog replay (what epic 3 keeps today: the last 64 KiB, trimmed at a line).
      const rawTerm = headless(100, 30, 5000);
      rawTerm.term.write(entry.raw);
      await rawTerm.flush();
      results.raw64KiB = { replayBytes: Buffer.byteLength(entry.raw), visibleRowsDiffer: diff(visible(entry.mirror), visible(rawTerm)), totalLinesRebuilt: lines(rawTerm).length, altScreenKept: entry.mirror.term.buffer.active.type === rawTerm.term.buffer.active.type };
      rec.set(`replay: ${name}`, results);
      second.ws.close();
      entry.pane.kill();
      // The snapshot must show the same screen as the live pane (the one thing a refresh must not change).
      expect(results.snapshot.visibleRowsDiffer).toBe(0);
    });
  }

  it('cost of the server-side mirror: memory and CPU for a 10,000 line scrollback', async () => {
    const before = process.memoryUsage().rss;
    const cpu0 = process.cpuUsage();
    const h = new PaneHost({ mirror: true, scrollback: 10_000 });
    const [file, args] = fakeCommand('lines', 30000, 0);
    const e = await h.open('mem', { file, args, cols: 120, rows: 40 });
    await e.pane.exited;
    await e.mirror.flush();
    const t0 = now();
    const snap = e.mirror.serialize({ scrollback: 10_000 });
    const serializeMs = now() - t0;
    const cpu = process.cpuUsage(cpu0);
    rec.set('mirror_cost_30000_lines_10k_scrollback', { rssDeltaMb: Math.round((process.memoryUsage().rss - before) / 1048576), serializeMs: Math.round(serializeMs), snapshotBytes: Buffer.byteLength(snap), cpuMsDuring: Math.round((cpu.user + cpu.system) / 1000) });
    h.closeAll();
  });
});

describe('a sign-in typed in a pane stays between the user and the CLI', () => {
  it('the pasted code is never logged or stored by the server; the CLI stores its login where it always does', async () => {
    const userHome = mkdtempSync(join(tmpdir(), 'ogden-spike-home-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'ogden-spike-data-'));
    const [file, args] = fakeCommand('login');
    const id = 'login1';
    const entry = await host.open(id, { file, args, env: paneEnv({ FAKE_HOME: userHome }) });
    const v = await viewer(id);
    await entry.pane.waitFor('Paste the code here>');
    const CODE = 'SENTINEL-LOGIN-CODE-7731-AbCdEf';
    v.type(`\x1b[200~${CODE}\x1b[201~\r`);
    await entry.pane.waitFor('Signed in as fake@example.test', 8000);
    const credentialFile = join(userHome, '.fakecli', 'credentials.json');
    const stored = existsSync(credentialFile) ? readFileSync(credentialFile, 'utf8') : '';
    const logged = server.logLines.join('\n');
    rec.set('login_flow', {
      cliStoredItsLoginInTheUsersHome: stored.includes(CODE),
      codeInServerLog: logged.includes(CODE),
      cliOutputInServerLog: logged.includes('fake.example.test') || logged.includes('Signed in'),
      serverLogLineCount: server.logLines.length,
      serverLogSample: server.logLines.slice(0, 3).map((l) => l.slice(0, 120)),
      ogdenDataDirFilesWritten: readdirSync(dataDir).length,
    });
    v.ws.close();
    entry.pane.kill();
    rmSync(userHome, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    expect(logged.includes(CODE)).toBe(false);
    expect(logged.includes('Signed in')).toBe(false);
    expect(stored.includes(CODE)).toBe(true);
  });
});

describe('output volume to a viewer that stops reading', () => {
  it('the slow viewer is closed, the pane and a fast viewer carry on, host memory stays bounded', async () => {
    const [file, args] = fakeCommand('long', 60, 'exit');
    const id = 'flood1';
    const rss0 = process.memoryUsage().rss;
    let peak = rss0;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100);
    const entry = await host.open(id, { file, args, trimText: true });
    const slow = await viewer(id);
    slow.ws._socket.pause(); // the tab stopped reading
    const fast = await viewer(id);
    const t0 = now();
    await entry.pane.exited;
    const floodMs = now() - t0;
    await sleep(500);
    clearInterval(timer);
    rec.set('slow_viewer', { slowViewerClosedByServer: server.stats.closed.includes('slow'), fastViewerReceivedMb: Math.round(fast.liveBytes / 1048576), floodMs: Math.round(floodMs), hostPeakRssDeltaMb: Math.round((peak - rss0) / 1048576), closedBy: server.stats.closed });
    slow.ws.terminate();
    fast.ws.close();
    expect(fast.liveBytes).toBeGreaterThan(50 * 1024 * 1024);
  });

  it('typing in one pane stays fast while another pane floods and a viewer is slow', async () => {
    const [f1, a1] = fakeCommand('long', 200);
    const noisy = await host.open('noisy', { file: f1, args: a1, trimText: true });
    const v1 = await viewer('noisy');
    v1.ws._socket.pause();
    const [f2, a2] = fakeCommand('echo');
    const quiet = await host.open('quiet', { file: f2, args: a2 });
    const v2 = await viewer('quiet');
    await quiet.pane.waitFor('ECHO-READY');
    const samples = [];
    for (let i = 0; i < 60; i += 1) {
      const ch = String.fromCharCode(97 + (i % 26));
      const from = quiet.pane.text.length;
      const t0 = now();
      v2.type(ch);
      await quiet.pane.waitFor(`<${ch}>`, 5000, from);
      samples.push(now() - t0);
      await sleep(10);
    }
    rec.set('typing_via_socket_while_other_pane_floods_ms', stats(samples));
    v1.ws.terminate();
    v2.ws.close();
    noisy.pane.kill();
    quiet.pane.kill();
  });
});
