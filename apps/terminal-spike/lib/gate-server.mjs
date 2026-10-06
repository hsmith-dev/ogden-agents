// SPIKE 16.1 (TEMPORARY): a minimal server that puts a pane WebSocket behind Ogden's REAL gate (gate.ts, auth.ts):
// Host, tab token in the subprotocol, Origin. The pane socket sits under /ws so the gate's WebSocket rules apply
// exactly as they do to the event socket and the chat terminal socket. It also serves a tiny page with xterm.js
// for the browser probe. It logs through Ogden's own logger into a capture buffer so the probes can prove no
// terminal bytes are ever logged.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer, upgradeWebSocket } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { chooseWebSocketProtocol, createLaunchCodes, createTabTokens } from '../../../packages/server/src/auth.ts';
import { createGate } from '../../../packages/server/src/gate.ts';
import { createLogger } from '../../../packages/server/src/log.ts';
import { headless } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../packages/web/package.json'));
const xtermDir = dirname(require.resolve('@xterm/xterm/package.json'));
const fitDir = dirname(require.resolve('@xterm/addon-fit/package.json'));
const u11 = createRequire(join(here, '../package.json'));
const u11Dir = dirname(u11.resolve('@xterm/addon-unicode11/package.json'));
const FILES = {
  '/vendor/addon-unicode11.js': [join(u11Dir, 'lib/addon-unicode11.js'), 'text/javascript'],
  '/vendor/xterm.js': [join(xtermDir, 'lib/xterm.js'), 'text/javascript'],
  '/vendor/xterm.css': [join(xtermDir, 'css/xterm.css'), 'text/css'],
  '/vendor/addon-fit.js': [join(fitDir, 'lib/addon-fit.js'), 'text/javascript'],
  '/page.js': [join(here, 'page.js'), 'text/javascript'],
};
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/vendor/xterm.css"></head><body style="margin:0"><div id="panes"></div><script src="/vendor/xterm.js"></script><script src="/vendor/addon-fit.js"></script><script src="/vendor/addon-unicode11.js"></script><script src="/page.js"></script></body></html>`;

export const MAX_VIEWER_BUFFERED = 1024 * 1024;

/**
 * `host` is a PaneHost. `replay`: 'snapshot' (the headless mirror's serialization) or 'raw' (the trimmed backlog, as
 * epic 3 keeps). Returns the server, its capture of log lines, and helpers.
 */
export async function startGateServer({ host, replay = 'snapshot' }) {
  const logLines = [];
  const log = createLogger((line) => void logLines.push(line));
  const codes = createLaunchCodes();
  const tabs = createTabTokens();
  let port;
  const app = new Hono();
  app.use('*', createGate({ port: () => port, codes, tabs, log }));
  for (const [path, [file, type]] of Object.entries(FILES)) app.get(path, (c) => c.body(readFileSync(file), 200, { 'Content-Type': type }));
  app.get('/', (c) => c.html(PAGE));
  const stats = { attached: 0, replayBytes: [], closed: [] };
  app.get(
    '/ws/pane/:id',
    upgradeWebSocket((c) => {
      const entry = host.panes.get(c.req.param('id'));
      let viewer;
      let attached = false;
      return {
        onOpen(_event, ws) {
          if (!entry) ws.close(4404, 'no_pane');
        },
        onMessage(event, ws) {
          if (!entry) return;
          const data = event.data;
          if (typeof data === 'string') {
            let frame;
            try { frame = JSON.parse(data); } catch { return; }
            if (frame.type === 'attach' && !attached) {
              attached = true;
              host.resize(entry.id, frame.cols, frame.rows);
              (async () => {
                let snapshot = '';
                if (replay === 'snapshot' && entry.mirror) {
                  await entry.mirror.flush();
                  snapshot = entry.mirror.serialize({ scrollback: frame.scrollback ?? 5000 });
                } else snapshot = entry.raw;
                stats.replayBytes.push(Buffer.byteLength(snapshot));
                ws.send(JSON.stringify({ type: 'replay-start' }));
                if (snapshot) ws.send(Buffer.from(snapshot));
                ws.send(JSON.stringify({ type: 'replay-end' }));
                viewer = (chunk) => {
                  if (ws.raw && ws.raw.bufferedAmount > MAX_VIEWER_BUFFERED) { stats.closed.push('slow'); ws.close(4408, 'slow_viewer'); entry.viewers.delete(viewer); return; }
                  ws.send(Buffer.from(chunk));
                };
                entry.viewers.add(viewer);
                stats.attached += 1;
              })();
            } else if (frame.type === 'resize' && attached) host.resize(entry.id, frame.cols, frame.rows);
            return;
          }
          if (!attached) return;
          const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer ?? data);
          entry.pane.write(bytes.toString('utf8'));
          entry.onInput?.(bytes);
        },
        onClose() {
          if (viewer) entry?.viewers.delete(viewer);
        },
      };
    }),
  );
  const wss = new WebSocketServer({ noServer: true, handleProtocols: chooseWebSocketProtocol, maxPayload: 2 * 1024 * 1024 });
  const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    tabs,
    codes,
    logLines,
    stats,
    mintToken: () => tabs.mint(),
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
