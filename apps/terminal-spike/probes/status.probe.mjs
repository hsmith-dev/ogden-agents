// SPIKE 16.1 (TEMPORARY): status per pane (working, needs attention, idle, exited) from output recency and prompt
// patterns, scored against the fake CLI's own ground truth. Three detectors run side by side on the same bytes:
// 'screen' (a server-side terminal mirror, last lines only), 'tail' (stripped recent bytes), 'recency' (no patterns).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StatusTracker, parseTruth } from '../lib/status.mjs';
import { createRecorder, fakeCommand, openPane, paneEnv, sleep } from '../lib/harness.mjs';

const rec = createRecorder('status');
afterAll(() => rec.flush());
const dir = mkdtempSync(join(tmpdir(), 'ogden-spike-status-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const GRACE_MS = 1500;
const MODES = ['screen', 'tail', 'recency'];

const SCENARIOS = {
  'permission question (y/n)': { command: ['permission', 1500, 'yn'], answer: 'y\r' },
  'permission menu (1. Yes / 2 / 3)': { command: ['permission', 1500, 'menu'], answer: '\r' },
  'press enter to continue': { command: ['permission', 1500, 'proceed'], answer: '\r' },
  'working text that merely contains (y/n)': {
    steps: [{ label: 'working', print: 'The docs say to pass the flag (y/n) when asked.\r\n' }, { spinner: 2500, text: 'Reading files (y/n)...' }, { label: 'idle', print: 'fake> ' }, { wait: 2500 }],
  },
  'a (y/n) line in the output, then silent work': {
    steps: [{ label: 'working', print: 'Pass the flag when asked (y/n)' }, { wait: 2200 }, { spinner: 1200 }, { label: 'idle', print: '\r\nfake> ' }, { wait: 2500 }],
  },
  'a prompt in words the patterns do not know': {
    steps: [{ label: 'working', spinner: 1500 }, { label: 'attention', print: 'Shall I go ahead and apply it? [Enter to confirm]\r\n' }, { wait: 3000 }, { label: 'idle', print: 'fake> ' }, { wait: 2500 }],
  },
  'silent thinking for 4 s (no output)': {
    steps: [{ label: 'working', print: 'Thinking started\r\n' }, { wait: 4000 }, { label: 'idle', print: 'Answer ready\r\nfake> ' }, { wait: 2500 }],
  },
  'finishes and the CLI exits': {
    steps: [{ label: 'working', spinner: 1500 }, { print: 'bye\r\n', exit: 0 }],
  },
};

function truthAt(truth, t) {
  let state = 'idle';
  for (const e of truth) if (e.t <= t) state = e.state;
  return state;
}

async function runScenario(name, scenario) {
  const labels = join(dir, `${Math.random().toString(36).slice(2)}.labels`);
  writeFileSync(labels, '');
  let command;
  if (scenario.steps) {
    const file = join(dir, `${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(scenario.steps));
    command = fakeCommand('scenario', file);
  } else command = fakeCommand(...scenario.command);
  const [file, args] = command;
  const pane = await openPane({ file, args, env: paneEnv({ FAKE_LABELS: labels }), cols: 100, rows: 30 });
  const trackers = Object.fromEntries(MODES.map((mode) => [mode, new StatusTracker({ mode })]));
  pane.listeners.add((d) => { for (const t of Object.values(trackers)) t.feed(d); });
  pane.exited.then(() => { for (const t of Object.values(trackers)) t.exit(); });
  const samples = [];
  const started = Date.now();
  let answered = false;
  while (Date.now() - started < 12_000) {
    const wall = Date.now();
    const row = { t: wall };
    for (const [mode, tracker] of Object.entries(trackers)) row[mode] = tracker.state();
    samples.push(row);
    const truth = parseTruth(readFileSync(labels, 'utf8'));
    const last = truth[truth.length - 1];
    if (scenario.answer && !answered && last?.state === 'attention' && wall - last.t > 2000) {
      answered = true;
      for (const t of Object.values(trackers)) t.input();
      pane.write(scenario.answer);
    }
    if (pane.exit && wall - pane.exit.atMs > 0 && samples.length > 4 && truth.at(-1)?.state === 'exited') break;
    if (last?.state === 'idle' && wall - last.t > 2400 && (answered || !scenario.answer)) break;
    await sleep(50);
  }
  const truth = parseTruth(readFileSync(labels, 'utf8'));
  pane.kill();
  // Score: per detector, samples outside the grace window after a truth change, and latency of each truth change.
  const result = {};
  for (const mode of MODES) {
    let scored = 0;
    let right = 0;
    for (const s of samples) {
      const last = [...truth].reverse().find((e) => e.t <= s.t);
      if (!last || s.t - last.t < GRACE_MS) continue;
      scored += 1;
      if (s[mode] === truthAt(truth, s.t)) right += 1;
    }
    const latencies = {};
    for (const [i, e] of truth.entries()) {
      if (i > 0 && truth[i - 1].state === e.state) continue;
      const hit = samples.find((s) => s.t >= e.t && s[mode] === e.state);
      latencies[`${e.state}@${i}`] = hit ? hit.t - e.t : null;
    }
    result[mode] = { scoredSamples: scored, agree: scored ? Math.round((right / scored) * 100) : null, latencyMsByTransition: latencies };
  }
  return { truthStates: truth.map((e) => e.state).join('>'), result, cpuMs: Object.fromEntries(Object.entries(trackers).map(([k, t]) => [k, Math.round(t.cpuMs * 10) / 10])) };
}

describe('status detection on fake CLIs', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(name, async () => {
      const outcome = await runScenario(name, scenario);
      rec.set(`status: ${name}`, outcome);
      expect(outcome.truthStates.length).toBeGreaterThan(0);
    });
  }

  it('exit is reported by the exit event, never by guessing', async () => {
    const [file, args] = fakeCommand('exit', 4, 200);
    const pane = await openPane({ file, args });
    const tracker = new StatusTracker({ mode: 'screen' });
    pane.exited.then(() => tracker.exit());
    await pane.exited;
    await sleep(20);
    expect(tracker.state()).toBe('exited');
  });
});
