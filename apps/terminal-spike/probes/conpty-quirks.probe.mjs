// SPIKE 16.1 (TEMPORARY): two Windows ConPTY quirks seen in the first CI runs, measured on every OS.
// 1. A pane whose first output is held back (a pane that "never prints its prompt"), and what un-sticks it.
// 2. A big paste: does the program get all the input, and does its output come back?
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { IS_WIN, createRecorder, fakeCommand, now, openPane, paneEnv, sleep } from '../lib/harness.mjs';

const rec = createRecorder('conpty-quirks');
afterAll(() => rec.flush());
const open = (mode, ...args) => openPane({ file: fakeCommand(mode)[0], args: fakeCommand(mode, ...args)[1] });

describe('held-back first output', () => {
  it('how often, and which nudge ends it', async () => {
    const remedies = [
      ['just waiting 2.5 s more', () => {}],
      ['a resize of one column', (p) => p.resize(101, 30)],
      ['a carriage return typed', (p) => p.write('\r')],
      ['a cursor position reply (ESC[1;1R)', (p) => p.write('\x1b[1;1R')],
    ];
    const tally = { stormPanes: 0, stalledAfter4s: 0, firstOutputThatWasHeld: [], recoveredBy: {}, neverRecovered: 0 };
    for (let round = 0; round < 5; round += 1) {
      const panes = await Promise.all(Array.from({ length: 16 }, () => open('prompt')));
      tally.stormPanes += panes.length;
      await sleep(4000);
      for (const p of panes.filter((x) => !x.text.includes('fake>'))) {
        tally.stalledAfter4s += 1;
        if (tally.firstOutputThatWasHeld.length < 3) tally.firstOutputThatWasHeld.push(JSON.stringify(p.text.slice(-60)));
        let fixed = false;
        for (const [name, act] of remedies) {
          act(p);
          await sleep(2500);
          if (p.text.includes('fake>')) { tally.recoveredBy[name] = (tally.recoveredBy[name] ?? 0) + 1; fixed = true; break; }
        }
        if (!fixed) tally.neverRecovered += 1;
      }
      panes.forEach((p) => p.kill());
      await sleep(500);
    }
    rec.set('storm_16_x5_first_output', tally);
    // One pane at a time, 40 times (no storm): does it still happen?
    let stalled = 0;
    for (let i = 0; i < 40; i += 1) {
      const p = await open('prompt');
      const ok = await p.waitFor('fake>', 4000).then(() => true, () => false);
      if (!ok) stalled += 1;
      p.kill();
    }
    rec.set('single_pane_x40_first_output_stalled', stalled);
  }, 400_000);
});

describe('a big paste', () => {
  it('input delivered (side channel) versus output seen, whole and chunked, with the output kept quiet or not', async () => {
    const payload = `\x1b[200~${'0123456789abcdef'.repeat(6400)}\x1b[201~`; // ~100 KB
    const dir = mkdtempSync(join(tmpdir(), 'ogden-spike-count-'));
    const outcomes = {};
    for (const quiet of [true, false]) {
      for (const [label, size, gap] of [['one write', payload.length, 0], ['4 KB chunks', 4096, 0], ['1 KB chunks, 1 ms gap', 1024, 1]]) {
        const count = join(dir, `${Math.random().toString(36).slice(2)}.n`);
        const env = paneEnv({ FAKE_COUNT: count, ...(quiet ? { FAKE_QUIET: '1' } : {}) });
        const pane = await openPane({ file: fakeCommand('raw')[0], args: fakeCommand('raw')[1], env });
        await pane.waitFor('READY', 15_000);
        const t0 = now();
        for (let i = 0; i < payload.length; i += size) {
          pane.write(payload.slice(i, i + size));
          if (gap) await sleep(gap); else if ((i / size) % 8 === 7) await sleep(0);
        }
        let delivered = 0;
        const timeline = [];
        while (now() - t0 < 10_000 && delivered < Buffer.byteLength(payload)) {
          await sleep(250);
          delivered = existsSync(count) ? Number(readFileSync(count, 'utf8') || 0) : 0;
          timeline.push(delivered);
        }
        const before = delivered;
        pane.resize(111, 33); // a nudge
        await sleep(1500);
        const after = existsSync(count) ? Number(readFileSync(count, 'utf8') || 0) : 0;
        outcomes[`${quiet ? 'quiet output' : 'echoing output'} / ${label}`] = { sentBytes: Buffer.byteLength(payload), inputDelivered: before, afterResizeNudge: after, secondsToDeliver: Math.round((now() - t0) / 100) / 10, timeline: timeline.filter((_, i) => i % 4 === 0).slice(0, 8) };
        pane.kill();
      }
    }
    rmSync(dir, { recursive: true, force: true });
    rec.set('paste_100KB_input_vs_output', outcomes);
  }, 300_000);
});
void IS_WIN;
