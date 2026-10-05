// SPIKE 16.1 (TEMPORARY): finding an already installed CLI (never installing one) and starting it in a pane,
// with fake CLIs in the shapes real installs take (npm shims, native binaries, a folder outside PATH), plus plain shells.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAUNCHERS, detect } from '../lib/detect.mjs';
import { FAKE, IS_WIN, createRecorder, now, openPane, paneEnv, sleep, stripAnsi } from '../lib/harness.mjs';

const rec = createRecorder('launch');
afterAll(() => rec.flush());

let root;
let env;
const paths = {};

function writeShim(dir, name, { failVersion = false } = {}) {
  mkdirSync(dir, { recursive: true });
  if (IS_WIN) {
    const file = join(dir, `${name}.cmd`);
    const body = failVersion
      ? '@echo off\r\nif "%~1"=="--version" exit /b 1\r\n'
      : `@echo off\r\nif "%~1"=="--version" ("${process.execPath}" "${FAKE}" version) else ("${process.execPath}" "${FAKE}" prompt)\r\n`;
    writeFileSync(file, body);
    return file;
  }
  const file = join(dir, name);
  const body = failVersion ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\ncase "$1" in --version) exec "${process.execPath}" "${FAKE}" version;; *) exec "${process.execPath}" "${FAKE}" prompt;; esac\n`;
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ogden-spike-detect-'));
  const home = join(root, 'home');
  const pathDir = join(root, 'bin dir'); // a space, as in "C:\Program Files"
  mkdirSync(home, { recursive: true });
  paths.claude = writeShim(pathDir, 'claude');
  paths.codex = writeShim(pathDir, 'codex');
  if (IS_WIN) {
    // A native binary: a copy of node.exe answers --version like a CLI would.
    paths.grok = join(pathDir, 'grok.exe');
    copyFileSync(process.execPath, paths.grok);
    mkdirSync(join(home, 'AppData', 'Local', 'Programs'), { recursive: true });
    paths.agy = writeShim(join(home, 'AppData', 'Local', 'Programs'), 'agy');
  } else {
    paths.grok = writeShim(pathDir, 'grok');
    paths.agy = writeShim(join(home, '.local', 'bin'), 'agy'); // in a well-known folder, not on PATH
  }
  paths.copilot = writeShim(pathDir, 'copilot', { failVersion: true });
  env = {
    ...paneEnv(),
    PATH: pathDir + (IS_WIN ? ';' : ':') + (process.env.PATH ?? ''),
    ...(IS_WIN ? { USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData', 'Local'), APPDATA: join(home, 'AppData', 'Roaming') } : { HOME: home }),
  };
  // The real machine may have real CLIs on PATH; the probe must never run one. Cut PATH down to the fake dir plus the system's basics.
  env.PATH = pathDir + (IS_WIN ? `;${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` : ':/usr/bin:/bin');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('install detection', () => {
  it('reports found, not found, and found but failed; never runs anything else', async () => {
    const results = {};
    const t0 = now();
    for (const launcher of LAUNCHERS) results[launcher.id] = await detect(launcher, { env });
    const slim = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { state: v.state, via: v.via, version: v.version, code: v.code, installPage: v.install }]));
    rec.set('detect_all_ms', Math.round(now() - t0));
    rec.set('detect', slim);
    expect(results.claude.state).toBe('found');
    expect(results.codex.state).toBe('found');
    expect(results.grok.state).toBe('found');
    expect(results.copilot.state).toBe('found-but-failed');
    expect(results.gemini.state).toBe('not-found');
    expect(results.gemini.install).toMatch(/^https:/);
    expect(results.antigravity.state).toBe('found');
    expect(results.antigravity.via).toBe('well-known folder');
  });

  it('starts a detected CLI in a pane: by its absolute path, by shim, and with a space in the path', async () => {
    const outcomes = {};
    const tries = IS_WIN
      ? {
          'cmd shim, direct file': [paths.claude, []],
          'cmd shim, via cmd.exe /d /s /c': [env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${paths.claude}""`]],
          'native exe, direct file': [paths.grok, [FAKE, 'prompt']],
          'bare name on the pane PATH': ['claude', []],
          'bare name with extension on the pane PATH': ['claude.cmd', []],
        }
      : { 'shim script, absolute path': [paths.claude, []], 'bare name on the pane PATH': ['claude', []] };
    for (const [label, [file, args]] of Object.entries(tries)) {
      try {
        const pane = await openPane({ file, args, env });
        const t0 = now();
        const ok = await pane.waitFor('fake> ', 8000).then(() => true, () => false);
        outcomes[label] = ok ? `works (${Math.round(now() - t0)} ms to prompt)` : `spawned but no prompt: ${JSON.stringify(stripAnsi(pane.text).slice(0, 120))}`;
        pane.kill();
      } catch (error) {
        outcomes[label] = `spawn error: ${String(error.message).slice(0, 140)}`;
      }
    }
    // A path that does not exist: what the error looks like (the UI says "found but failed to start").
    try {
      const pane = await openPane({ file: join(root, 'nope', 'claude'), args: [], env });
      const exit = await Promise.race([pane.exited, sleep(5000).then(() => 'no exit')]);
      outcomes['missing file'] = `spawned, then ${JSON.stringify(exit)}`;
      pane.kill();
    } catch (error) {
      outcomes['missing file'] = `spawn error: ${String(error.message).slice(0, 140)}`;
    }
    rec.set('launch_outcomes', outcomes);
    expect(Object.values(outcomes).some((v) => v.startsWith('works'))).toBe(true);
  });
});

describe('plain shell', () => {
  it('the user default shell starts under the allowlist, takes a command, resizes and exits cleanly', async () => {
    const candidates = IS_WIN ? [['powershell.exe', ['-NoLogo']], [process.env.ComSpec ?? 'cmd.exe', []]] : [[process.env.SHELL ?? '/bin/sh', ['-i']]];
    const outcomes = {};
    for (const [file, args] of candidates) {
      const name = file.split(/[\\/]/).pop();
      const isCmd = name.toLowerCase().startsWith('cmd');
      const t0 = now();
      const pane = await openPane({ file, args, env: paneEnv(), cols: 90, rows: 28 });
      // A real terminal answers ConPTY's cursor position request; this one has to, or Windows shells wait.
      let dsr = 0;
      pane.listeners.add((d) => { const n = (d.match(/\x1b\[6n/g) ?? []).length; for (let i = 0; i < n; i += 1) { dsr += 1; pane.write('\x1b[1;1R'); } });
      let quietFor = 0;
      let last = 0;
      while ((quietFor < 1200 || pane.text.length === 0) && now() - t0 < 20_000) {
        await sleep(50);
        if (pane.text.length !== last) { last = pane.text.length; quietFor = 0; } else quietFor += 50;
      }
      const promptMs = Math.round(now() - t0 - 1200);
      const sizeCmd = IS_WIN ? (isCmd ? 'mode con' : '$Host.UI.RawUI.WindowSize.Width') : 'stty size';
      pane.write(IS_WIN ? (isCmd ? 'set /a 20+22\r' : 'Write-Output ("shell-" + (20+22))\r') : 'echo shell-$((20+22))\r');
      const ran = await pane.waitFor(IS_WIN ? (isCmd ? /\n42\r?\n/ : /shell-42/) : 'shell-42', 40_000, pane.text.length).then(() => true, () => false);
      pane.resize(120, 33);
      await sleep(400);
      const from = pane.text.length;
      pane.write(`${sizeCmd}\r`);
      await sleep(1500);
      const sizeText = stripAnsi(pane.text.slice(from)).replace(/\s+/g, ' ').slice(0, 160);
      pane.write('exit\r');
      const exit = await Promise.race([pane.exited, sleep(8000).then(() => undefined)]);
      outcomes[name] = { promptMs, cursorPositionRequestsAnswered: dsr, ranCommand: ran, afterResize120x33: sizeText, exitCode: exit?.exitCode ?? 'did not exit' };
      if (!exit) pane.kill();
    }
    rec.set('plain_shell', outcomes);
    expect(Object.values(outcomes).every((o) => o.ranCommand)).toBe(true);
  });
});
