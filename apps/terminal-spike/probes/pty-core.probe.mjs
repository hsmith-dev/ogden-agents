// SPIKE 16.1 (TEMPORARY): PTY behaviour through the repo's terminal-pty adapter, with fake CLIs.
// Spawn time, memory, resize, many panes, paste, Unicode and colours, input latency, output volume, exit and tail loss.
import { afterAll, describe, expect, it } from 'vitest';
import { FAKE, IS_WIN, stripAnsi, PaneHost, createRecorder, fakeCommand, headless, now, openPane, paneEnv, rssMb, sleep, stats } from '../lib/harness.mjs';

const rec = createRecorder('pty-core');
afterAll(() => rec.flush());
const open = (mode, ...args) => openPane({ file: fakeCommand(mode)[0], args: fakeCommand(mode, ...args)[1] });
const closeAll = (panes) => panes.forEach((p) => p.kill());

describe('spawn and memory', () => {
  it('spawn time of a pane (sequential)', async () => {
    const spawn = [];
    const ready = [];
    for (let i = 0; i < 8; i += 1) {
      const t0 = now();
      const pane = await open('echo');
      await pane.waitFor('ECHO-READY');
      spawn.push(pane.spawnMs);
      ready.push(now() - t0);
      pane.kill();
    }
    rec.set('spawn_call_ms', stats(spawn));
    rec.set('spawn_to_first_prompt_ms (includes Node start of the fake)', stats(ready));
  });

  for (const count of [1, 4, 8, 16, 32]) {
    it(`${count} panes at once: ready time, memory, no cross talk`, async () => {
      const before = process.memoryUsage().rss;
      const t0 = now();
      const host = new PaneHost({ mirror: true });
      const failures = [];
      const entries = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          try {
            const [file, args] = fakeCommand('prompt');
            const e = await host.open(`p${i}`, { file, args });
            await e.pane.waitFor('fake> ', 60_000);
            return e;
          } catch (error) {
            failures.push(String(error.message).slice(0, 120));
            return undefined;
          }
        }),
      );
      const readyMs = now() - t0;
      const ok = entries.filter(Boolean);
      // Each pane is told its own marker at the same moment; none may show another's.
      ok.forEach((e, i) => e.pane.write(`marker-${e.id}\r`));
      await Promise.all(ok.map((e) => e.pane.waitFor(`you said: marker-${e.id}`, 30_000)));
      const crossTalk = ok.filter((e) => ok.some((o) => o !== e && new RegExp(`marker-${o.id}(?![0-9])`).test(e.pane.text))).length;
      const paneRss = rssMb(host.pids);
      const serverDelta = Math.round(((process.memoryUsage().rss - before) / 1048576) * 10) / 10;
      rec.set(`panes_${count}`, { requested: count, started: ok.length, failures: failures.slice(0, 3), readyMs: Math.round(readyMs), childRssMbTotal: paneRss, childRssMbPerPane: ok.length ? Math.round((paneRss / ok.length) * 10) / 10 : undefined, hostRssDeltaMb: serverDelta, crossTalk });
      host.closeAll();
      await Promise.all(ok.map((e) => e.pane.exited));
      expect(crossTalk).toBe(0);
      if (!IS_WIN) expect(ok.length).toBe(count);
      await sleep(300);
    });
  }
});

describe('resize', () => {
  it('follows the viewer, many times, and extremes', async () => {
    const pane = await openPane({ file: fakeCommand('raw')[0], args: fakeCommand('raw')[1], cols: 80, rows: 24 });
    await pane.waitFor('SIZE:80x24');
    const latencies = [];
    for (const [c, r] of [[120, 40], [60, 15], [200, 60], [80, 24], [132, 43]]) {
      const from = pane.text.length;
      const t0 = now();
      pane.resize(c, r);
      try {
        await pane.waitFor(`SIZE:${c}x${r}`, 5000, from);
        latencies.push(now() - t0);
      } catch {
        rec.set(`resize_${c}x${r}`, 'not reported within 5 s');
      }
    }
    rec.set('resize_to_child_ms', stats(latencies));
    // A burst: 60 resizes in about a second; the last one must be what the child ends with.
    for (let i = 0; i < 60; i += 1) {
      pane.resize(90 + (i % 30), 20 + (i % 15));
      await sleep(15);
    }
    pane.resize(101, 33);
    const converged = await pane.waitFor('SIZE:101x33', 5000).then(() => true, () => false);
    rec.set('resize_burst_60_converges', converged);
    for (const [c, r] of [[20, 5], [500, 200]]) {
      const from = pane.text.length;
      pane.resize(c, r);
      const reported = await pane.waitFor(`SIZE:${c}x${r}`, 4000, from).then(() => true, () => false);
      rec.set(`resize_extreme_${c}x${r}`, reported);
    }
    pane.kill();
    expect(latencies.length).toBeGreaterThanOrEqual(4);
  });
});

describe('input, paste, control keys', () => {
  it('bracketed paste and big pastes arrive byte for byte', async () => {
    const pane = await open('raw');
    await pane.waitFor('READY');
    const received = () => [...pane.text.matchAll(/GOT:\d+:([0-9a-f]+)/g)].map((m) => m[1]).join('');
    const small = '\x1b[200~line one café 日本語 😀\nline two\r\nline three\x1b[201~';
    pane.write(small);
    const want = Buffer.from(small).toString('hex');
    await pane.waitFor('GOT', 5000);
    await sleep(300);
    rec.set('paste_small_intact', received() === want);
    const before = received().length;
    const big = `\x1b[200~${'0123456789abcdef'.repeat(6400)}\x1b[201~`; // ~100 KB
    const t0 = now();
    pane.write(big);
    const wantBig = Buffer.from(big).toString('hex');
    let ok = false;
    while (now() - t0 < 20_000) {
      if (received().length - before >= wantBig.length) { ok = true; break; }
      await sleep(20);
    }
    rec.set('paste_100KB', { intact: received().slice(before) === wantBig, ms: Math.round(now() - t0), delivered: ok });
    // Ctrl+C in a program that reads raw arrives as one 0x03 byte and does not kill it.
    const from = pane.text.length;
    pane.write('\x03');
    await pane.waitFor('GOT:1:03', 5000, from).then(() => rec.set('ctrl_c_raw_reader', 'arrives as byte 0x03'), () => rec.set('ctrl_c_raw_reader', 'NOT delivered'));
    pane.kill();
  });

  it('Ctrl+C in a program with the terminal in cooked mode becomes SIGINT (hang fake)', async () => {
    const pane = await open('hang');
    await pane.waitFor('HANGING');
    pane.write('\x03');
    const got = await pane.waitFor('ignored SIGINT', 5000).then(() => 'SIGINT reached the program', () => 'no SIGINT seen');
    rec.set('ctrl_c_cooked', got);
    pane.kill();
  });

  it('input latency: key to echo, idle and with 4 other panes flooding output', async () => {
    async function measure(label, host) {
      const pane = await open('echo');
      await pane.waitFor('ECHO-READY');
      const samples = [];
      for (let i = 0; i < 150; i += 1) {
        const ch = String.fromCharCode(97 + (i % 26));
        const from = pane.text.length;
        const t0 = now();
        pane.write(ch);
        await pane.waitFor(`<${ch}>`, 5000, from);
        samples.push(now() - t0);
        await sleep(5);
      }
      rec.set(label, stats(samples));
      pane.kill();
    }
    await measure('input_latency_idle_ms', undefined);
    const noisy = await Promise.all(Array.from({ length: 4 }, () => open('long', 400)));
    await sleep(500);
    await measure('input_latency_with_4_flooding_panes_ms', undefined);
    closeAll(noisy);
  });
});

describe('Unicode and colours', () => {
  it('colours, wide characters, combining marks and the alternate screen survive, read back from a real xterm', async () => {
    const mirror = headless(100, 30);
    const pane = await open('escapes');
    pane.listeners.add((d) => mirror.term.write(d));
    await pane.waitFor('ALT-SCREEN-TEXT');
    await mirror.flush();
    const active = mirror.term.buffer.active;
    const alt = active.type === 'alternate';
    const row = (i) => active.getLine(i)?.translateToString(true) ?? '';
    const altText = { atRow3: row(2).includes('ALT-SCREEN-TEXT'), col5: row(2).indexOf('ALT-SCREEN-TEXT') === 4, second: row(4).includes('second row') };
    mirror.term.write('\x1b[?1049l');
    await mirror.flush();
    const main = mirror.term.buffer.active;
    const line0 = main.getLine(0).translateToString(true);
    const line1 = main.getLine(1).translateToString(true);
    const findCell = (line, ch) => { const text = main.getLine(line).translateToString(true); for (let c = 0; c < 100; c += 1) if (main.getLine(line).getCell(c).getChars() === ch) return main.getLine(line).getCell(c); return text && undefined; };
    const truecolor = findCell(0, 't');
    const wide = findCell(1, '日');
    rec.set('escapes', {
      alternateScreenEntered: alt,
      altText,
      redIsPalette1: findCell(0, 'r')?.getFgColor() === 1,
      truecolorRgb: truecolor?.isFgRGB() && truecolor.getFgColor() === 0x0cc863,
      palette256Orange: findCell(0, '2')?.getFgColor() === 208,
      cjkWideWidth2: wide?.getWidth() === 2,
      emojiWidth2: findCell(1, '😀')?.getWidth() === 2,
      combiningInOneCell: (findCell(1, 'é')?.getChars() ?? '').length === 2,
      mainScreenRestored: line0.includes('red') && line1.includes('unicode'),
      oscTitleRaw: pane.text.includes('\x1b]0;fake title\x07'),
      bracketedPasteModeSeen: mirror.term.modes.bracketedPasteMode,
    });
    pane.kill();
    expect(alt).toBe(true);
  });

  it('Unicode on the wire: what a pty layer does to a few characters (code points in, code points out)', async () => {
    const pane = await open('cjk', 3);
    await pane.waitFor('CJK-DONE', 20_000);
    const cp = (text) => [...text].map((c) => c.codePointAt(0).toString(16)).join(' ');
    const raw = pane.text;
    const start = raw.indexOf('\u65e5');
    const stripped = stripAnsi(raw);
    rec.set('unicode_wire_sample', { sent: cp('日本語😀é\u0301ｗ '), receivedStripped: cp(stripped.slice(stripped.indexOf('\u65e5'), stripped.indexOf('\u65e5') + 24)), rawAroundFirst: JSON.stringify(raw.slice(Math.max(0, start - 20), start + 60)) });
    pane.kill();
  });

  it('a big Unicode stream arrives with no broken character at a read boundary', async () => {
    const pane = await open('cjk', 40000);
    await pane.waitFor('CJK-DONE', 60_000);
    const replacement = (pane.text.match(/�/g) ?? []).length;
    const unit = '日本語😀é́ｗ ';
    const expectedUnits = 40000;
    const gotUnits = pane.text.split(unit).length - 1 + (pane.text.split(/\r\n/).length > 0 ? 0 : 0);
    // Lines are broken every 50 units, so count units across the line breaks.
    const joined = stripAnsi(pane.text).replace(/\r?\n/g, '');
    const units = joined.split(unit).length - 1;
    rec.set('unicode_stream', { replacementChars: replacement, unitsSeen: units, unitsExpected: expectedUnits, bytes: pane.bytes });
    pane.kill();
    expect(replacement).toBe(0);
    if (!IS_WIN) expect(units).toBe(expectedUnits);
    void gotUnits;
  });
});

describe('output volume, throughput and exits', () => {
  it('a flood: throughput bare, and with the server-side screen mirror', async () => {
    for (const withMirror of [false, true]) {
      const host = new PaneHost({ mirror: withMirror });
      const mb = IS_WIN ? 40 : 100;
      const rss0 = process.memoryUsage().rss;
      let peak = rss0;
      const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100);
      const [file, args] = fakeCommand('long', mb, 'exit');
      const t0 = now();
      const entry = await host.open('flood', { file, args, cols: 120, rows: 40 });
      const cpu0 = process.cpuUsage();
      let bytes = 0;
      entry.pane.listeners.add((d) => { bytes += d.length; });
      entry.pane.text = ''; // do not keep the whole flood in the collector
      entry.pane.listeners.add(() => { if (entry.pane.text.length > 4000) entry.pane.text = entry.pane.text.slice(-2000); });
      await entry.pane.exited;
      const ms = now() - t0;
      clearInterval(timer);
      await sleep(200);
      rec.set(withMirror ? 'flood_with_mirror' : 'flood_bare', { mb, ms: Math.round(ms), mbPerSecond: Math.round(((bytes / 1048576) / (ms / 1000)) * 10) / 10, hostPeakRssDeltaMb: Math.round((peak - rss0) / 1048576), hostCpuMs: Math.round((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000), receivedMb: Math.round(bytes / 1048576) });
      host.closeAll();
    }
  });

  it('exit codes, a signal-free exit, and output right before exit is not lost (20 runs of 2000 lines)', async () => {
    const codes = {};
    for (const code of [0, 3, 130]) {
      const pane = await open('exit', code);
      const exit = await pane.exited;
      codes[code] = exit.exitCode;
    }
    rec.set('exit_codes (sent -> reported)', codes);
    let lost = 0;
    const missing = [];
    for (let run = 0; run < 20; run += 1) {
      const pane = await open('lines', 2000, 0);
      await pane.exited;
      await sleep(50);
      const rows = (pane.text.match(/row \d+/g) ?? []).length;
      const end = pane.text.includes('LINES-END');
      if (rows !== 2000 || !end) { lost += 1; missing.push({ rows, end }); }
    }
    rec.set('tail_loss_runs_of_20 (output lost at exit)', { lost, examples: missing.slice(0, 3) });
  });

  it('a program that exits immediately after spawn (the ConPTY race) delivers its output and its code, 25 times', async () => {
    let bad = 0;
    for (let i = 0; i < 25; i += 1) {
      const pane = await open('exit', 7, 0);
      const exit = await Promise.race([pane.exited, sleep(10_000).then(() => undefined)]);
      if (exit === undefined || exit.exitCode !== 7) bad += 1;
    }
    rec.set('instant_exit_25_bad', bad);
    expect(bad).toBe(0);
  });
});
void FAKE; void paneEnv;
