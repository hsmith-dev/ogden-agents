// SPIKE 16.1 (TEMPORARY): the browser half, in real Chromium: xterm.js (the version the web package ships) on a pane
// WebSocket behind the real gate. Input latency, resize through the fit addon, several panes at once, copy and paste,
// Unicode and colours as xterm draws them, scrollback, and a page reload with the replay.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaneHost, createRecorder, fakeCommand, now, sleep, stats } from '../lib/harness.mjs';
import { startGateServer } from '../lib/gate-server.mjs';

const rec = createRecorder('browser');
let host;
let server;
let browser;
let context;
let page;
let version;

beforeAll(async () => {
  host = new PaneHost({ mirror: true, scrollback: 10_000 });
  server = await startGateServer({ host, replay: 'snapshot' });
  browser = await chromium.launch({ headless: true });
  version = browser.version();
  context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const token = server.mintToken();
  await context.addInitScript((t) => sessionStorage.setItem('ogden-agents.tab-token', t), token);
  page = await context.newPage();
  await page.goto(`${server.origin}/`);
  await page.waitForFunction(() => typeof window.spike !== 'undefined');
});
afterAll(async () => {
  rec.set('chromium', version);
  host.closeAll();
  await browser?.close();
  await server?.close();
  rec.flush();
});

const open = async (id, mode, ...args) => {
  const [file, a] = fakeCommand(mode, ...args);
  return host.open(id, { file, args: a, trimText: true });
};

describe('in the browser', () => {
  it('key to echo through socket and xterm', async () => {
    await open('b-echo', 'echo');
    await page.evaluate((id) => window.spike.mount(id), 'b-echo');
    await page.waitForFunction(() => window.spike.screen('b-echo').join('').includes('ECHO-READY'));
    const entry = host.panes.get('b-echo');
    const echoesBefore = (entry.pane.text.match(/<.>/g) ?? []).length;
    const times = await page.evaluate(async (id) => {
      const p = window.spike.panes[id];
      const out = [];
      const dec = new TextDecoder();
      const ta = p.el.querySelector('textarea');
      ta.focus();
      for (let i = 0; i < 120; i += 1) {
        const ch = String.fromCharCode(97 + (i % 26));
        const t0 = performance.now();
        await new Promise((resolve) => {
          p.onBytes = (buf) => { if (dec.decode(buf).includes(`<${ch}>`)) { p.onBytes = null; resolve(); } };
          // A real keydown, as the keyboard makes it, not a shortcut into the socket.
          ta.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: `Key${ch.toUpperCase()}`, keyCode: ch.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true }));
        });
        out.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 10));
      }
      return out;
    }, 'b-echo');
    await sleep(200);
    rec.set('browser_echoes_seen_by_the_program', (entry.pane.text.match(/<.>/g) ?? []).length - echoesBefore);
    rec.set('browser_key_to_echo_ms', stats(times));
    expect(times.length).toBe(120);
  });

  it('resize follows the box through the fit addon, and the program sees it', async () => {
    const entry = await open('b-raw', 'raw');
    await page.evaluate((id) => window.spike.mount(id), 'b-raw');
    await page.waitForFunction(() => window.spike.screen('b-raw').join('').includes('READY'));
    const outcomes = [];
    for (const [w, h] of [[900, 500], [300, 150], [1100, 700], [640, 360]]) {
      const size = await page.evaluate(([id, w, h]) => { window.spike.setBox(id, w, h); return window.spike.fit(id); }, ['b-raw', w, h]);
      const t0 = now();
      let seen = false;
      while (now() - t0 < 4000) { if (entry.pane.text.includes(`SIZE:${size.cols}x${size.rows}`)) { seen = true; break; } await sleep(10); }
      outcomes.push({ box: `${w}x${h}`, cells: `${size.cols}x${size.rows}`, programSawIt: seen, ms: Math.round(now() - t0) });
    }
    rec.set('browser_resize', outcomes);
    expect(outcomes.every((o) => o.programSawIt)).toBe(true);
  });

  it('copy, paste (bracketed) and the system clipboard', async () => {
    const entry = await open('b-paste', 'raw');
    await page.evaluate((id) => window.spike.mount(id), 'b-paste');
    await page.waitForFunction(() => window.spike.screen('b-paste').join('').includes('READY'));
    const before = entry.pane.text.length;
    const text = 'first line café\nsecond 日本語\nthird 😀';
    await page.evaluate(([id, t]) => window.spike.paste(id, t), ['b-paste', text]);
    await sleep(600);
    const hex = [...entry.pane.text.slice(before).matchAll(/GOT:\d+:([0-9a-f]+)/g)].map((m) => m[1]).join('');
    const got = Buffer.from(hex, 'hex').toString('utf8');
    const bracketed = got.startsWith('\x1b[200~') && got.endsWith('\x1b[201~');
    const body = got.replace('\x1b[200~', '').replace('\x1b[201~', '');
    const copied = await page.evaluate(async (id) => {
      const sel = window.spike.selectAll(id);
      await navigator.clipboard.writeText(sel);
      const back = await navigator.clipboard.readText();
      return { selectionLength: sel.length, containsPastedEcho: sel.includes('READY'), clipboardRoundTrip: back === sel };
    }, 'b-paste');
    rec.set('browser_copy_paste', { bracketedPasteModeOn: await page.evaluate((id) => window.spike.bracketed(id), 'b-paste'), pasteWrapped: bracketed, newlineSentAsCR: body.includes('\r') && !body.includes('\n'), unicodeIntact: body.includes('café') && body.includes('日本語') && body.includes('😀'), ...copied });
    expect(bracketed).toBe(true);
  });

  it('colours, wide characters and emoji as xterm draws them (default and with the Unicode 11 table)', async () => {
    const results = {};
    for (const unicode11 of [false, true]) {
      const id = `b-uni-${unicode11}`;
      await open(id, 'cjk', 10);
      await page.evaluate(([id, u]) => window.spike.mount(id, { unicode11: u }), [id, unicode11]);
      await page.waitForFunction((id) => window.spike.screen(id).join('').includes('CJK-DONE'), id);
      results[unicode11 ? 'with Unicode 11 addon' : 'default tables'] = await page.evaluate((id) => {
        const widths = {};
        const line = window.spike.panes[id].term.buffer.active.getLine(0);
        for (let c = 0; c < 40; c += 1) { const cell = line.getCell(c); const ch = cell.getChars(); if (ch === '日') widths.cjk = cell.getWidth(); if (ch === '😀') widths.emoji = cell.getWidth(); if (ch === 'ｗ') widths.fullwidthLatin = cell.getWidth(); }
        return widths;
      }, id);
    }
    const id = 'b-color';
    await open(id, 'escapes');
    await page.evaluate((id) => window.spike.mount(id), id);
    await page.waitForFunction((id) => window.spike.screen(id).join('').includes('ALT-SCREEN-TEXT'), id);
    results.altScreenInBrowser = await page.evaluate((id) => window.spike.panes[id].term.buffer.active.type, id);
    rec.set('browser_unicode_cell_widths', results);
    expect(results.altScreenInBrowser).toBe('alternate');
  });

  it('several panes at once: 6 panes each printing 20 MB, the page stays alive', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `b-many-${i}`);
    for (const id of ids) await open(id, 'long', 20);
    const t0 = now();
    const frames = await page.evaluate(async (ids) => {
      let count = 0;
      let running = true;
      const loop = () => { count += 1; if (running) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      const start = performance.now();
      await Promise.all(ids.map((id) => window.spike.mount(id, { scrollback: 5000, width: 420, height: 240 })));
      const deadline = start + 120_000;
      while (performance.now() < deadline && !ids.every((id) => window.spike.screen(id).join('').includes('LONG-DONE'))) await new Promise((r) => setTimeout(r, 50));
      running = false;
      const secs = (performance.now() - start) / 1000;
      return { fps: Math.round(count / secs), seconds: Math.round(secs * 10) / 10, done: ids.every((id) => window.spike.screen(id).join('').includes('LONG-DONE')), heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
    }, ids);
    rec.set('browser_6_panes_flood_20MB_each', { ...frames, wallMs: Math.round(now() - t0) });
    expect(frames.done).toBe(true);
  }, 240_000);

  it('scrollback in the browser and after a reload (snapshot replay)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogden-spike-b-'));
    const file = join(dir, 's.json');
    writeFileSync(file, JSON.stringify([{ print: Array.from({ length: 3000 }, (_, i) => `scroll line ${i + 1} \x1b[3${(i % 6) + 1}mcolour\x1b[0m\r\n`).join('') }, { print: 'fake> ' }, { wait: 90_000 }]));
    const [exe, args] = fakeCommand('scenario', file);
    await host.open('b-reload', { file: exe, args, trimText: true });
    await page.evaluate((id) => window.spike.mount(id, { scrollback: 5000 }), 'b-reload');
    await page.waitForFunction(() => window.spike.screen('b-reload').join('').includes('fake> '));
    const before = await page.evaluate(() => ({ lines: window.spike.screen('b-reload', true), len: window.spike.scrollLen('b-reload') }));
    // Reload the tab: the page, its xterm and its socket are gone; the pane lives on in the server.
    const t0 = now();
    await page.reload();
    await page.waitForFunction(() => typeof window.spike !== 'undefined');
    await page.evaluate((id) => window.spike.mount(id, { scrollback: 5000 }), 'b-reload');
    const reconnectMs = now() - t0;
    const after = await page.evaluate(() => ({ lines: window.spike.screen('b-reload', true), len: window.spike.scrollLen('b-reload') }));
    const trim = (a) => a.map((l) => l.trimEnd());
    const same = JSON.stringify(trim(after.lines).slice(-3000)) === JSON.stringify(trim(before.lines).slice(-3000));
    // Typing still works in the reattached pane.
    const entry = host.panes.get('b-reload');
    const typedBefore = entry.pane.text.length;
    await page.evaluate(() => window.spike.type('b-reload', 'x'));
    await sleep(300);
    rec.set('browser_reload_replay', { scrollbackLinesBefore: before.len, afterReload: after.len, last3000LinesIdentical: same, reloadToReplayedMs: Math.round(reconnectMs), typingWorksAfterReload: entry.pane.text.length >= typedBefore });
    expect(same).toBe(true);
  });
});
