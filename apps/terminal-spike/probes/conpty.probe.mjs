// SPIKE 16.1 (TEMPORARY): spawn storms and churn through terminal-pty's retry logic (story 3.8) with a counting wrapper
// around node-pty, to see how often "Invalid pty handle" / error 87 happens and whether three tries are enough with
// many panes. Windows is the point; macOS and Linux run it too as the control.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { release } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { hiddenPtySpawner, PTY_SPAWN_ATTEMPTS } from '../../../packages/adapters/src/terminal-pty/index.ts';
import { IS_WIN, SPIKE_DIR, countProcesses, createRecorder, fakeCommand, paneEnv, sleep } from '../lib/harness.mjs';

const rec = createRecorder('conpty');
afterAll(() => rec.flush());
const require = createRequire(`${SPIKE_DIR}/../../packages/adapters/package.json`);

function counting() {
  const real = require('node-pty');
  const stats = { calls: 0, errors: {} };
  const pty = {
    spawn(file, args, options) {
      stats.calls += 1;
      try {
        return real.spawn(file, args, options);
      } catch (error) {
        const key = String(error.message).slice(0, 80);
        stats.errors[key] = (stats.errors[key] ?? 0) + 1;
        throw error;
      }
    },
  };
  return { spawnHidden: hiddenPtySpawner(pty), stats };
}

describe('ConPTY and the retry logic', () => {
  it('facts about this pty layer', () => {
    const pkg = require('node-pty/package.json');
    const info = { nodePty: pkg.version, os: `${process.platform} ${release()}`, retryAttempts: PTY_SPAWN_ATTEMPTS };
    if (IS_WIN) {
      const ver = spawnSync('cmd.exe', ['/d', '/c', 'ver'], { encoding: 'utf8', env: paneEnv() });
      info.windowsVer = ver.stdout.trim();
    }
    rec.set('pty_layer', info);
  });

  for (const [name, { rounds, width, killers }] of Object.entries({
    'storm: 16 spawns at once, 6 rounds': { rounds: 6, width: 16, killers: false },
    'churn: 8 spawns while 8 other panes exit or are killed, 10 rounds': { rounds: 10, width: 8, killers: true },
  })) {
    it(name, async () => {
      const { spawnHidden, stats } = counting();
      const env = paneEnv();
      let started = 0;
      let failed = 0;
      const live = [];
      const t0 = Date.now();
      for (let r = 0; r < rounds; r += 1) {
        const batch = [];
        // Panes that exit at once (the race: an exit removes an entry while a spawn adds one).
        if (killers) {
          for (let i = 0; i < width; i += 1) {
            const [file, args] = fakeCommand('exit', 0, 0);
            try { batch.push(spawnHidden(file, args, { env, cwd: process.cwd(), cols: 80, rows: 24 })); started += 1; } catch { failed += 1; }
          }
        }
        // ...while the others are opened, and the previous round's are stopped.
        const opens = Array.from({ length: width }, async () => {
          const [file, args] = fakeCommand('prompt');
          try { const pane = spawnHidden(file, args, { env, cwd: process.cwd(), cols: 80, rows: 24 }); live.push(pane); started += 1; } catch { failed += 1; }
        });
        if (killers) for (const pane of live.splice(0, live.length - width)) pane.kill();
        await Promise.all(opens);
        if (!killers) { for (const pane of live.splice(0)) pane.kill(); }
        await sleep(100);
      }
      for (const pane of live.splice(0)) pane.kill();
      await sleep(500);
      const retries = stats.calls - started - failed;
      rec.set(`conpty: ${name}`, { spawnCalls: stats.calls, panesStarted: started, failedAfterRetries: failed, retriesUsed: retries, errorsSeen: stats.errors, seconds: Math.round((Date.now() - t0) / 100) / 10 });
      expect(failed).toBe(0);
    });
  }

  it('what a pane costs in helper processes (Windows: console hosts)', async () => {
    if (!IS_WIN) { rec.set('console_hosts', 'n/a off Windows'); return; }
    const before = { conhost: countProcesses(['conhost']), openConsole: countProcesses(['OpenConsole']) };
    const { spawnHidden } = counting();
    const panes = Array.from({ length: 8 }, () => { const [f, a] = fakeCommand('prompt'); return spawnHidden(f, a, { env: paneEnv(), cwd: process.cwd(), cols: 80, rows: 24 }); });
    await sleep(1500);
    const during = { conhost: countProcesses(['conhost']), openConsole: countProcesses(['OpenConsole']) };
    panes.forEach((p) => p.kill());
    await sleep(2000);
    const after = { conhost: countProcesses(['conhost']), openConsole: countProcesses(['OpenConsole']) };
    rec.set('console_hosts_for_8_panes', { before, during, after });
  });

  it('Windows shells: code page and the environment they need beyond the allowlist', async () => {
    if (!IS_WIN) { rec.set('windows_shells', 'n/a off Windows'); return; }
    const { spawnHidden } = counting();
    const out = {};
    for (const [label, file, args, cmd] of [
      ['powershell (allowlist env)', 'powershell.exe', ['-NoLogo'], '[Console]::OutputEncoding.CodePage; $env:APPDATA; $env:LOCALAPPDATA; $env:ProgramFiles; $env:PSModulePath; Get-Command node | Select -Expand Source; echo done-ps\r'],
      ['cmd (allowlist env)', process.env.ComSpec ?? 'cmd.exe', [], 'chcp & echo APPDATA=%APPDATA% & echo PROGRAMFILES=%ProgramFiles% & where node & echo done-cmd\r'],
    ]) {
      const chunks = [];
      const pane = spawnHidden(file, args, { env: paneEnv(), cwd: process.cwd(), cols: 120, rows: 30 });
      pane.onData((d) => chunks.push(d));
      await sleep(2500);
      pane.write(cmd.endsWith('\r') ? cmd : `${cmd}\r`);
      await sleep(4000);
      out[label] = chunks.join('').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\s+/g, ' ').slice(-420);
      pane.kill();
    }
    rec.set('windows_shells', out);
    expect(Object.keys(out).length).toBe(2);
  });
});
