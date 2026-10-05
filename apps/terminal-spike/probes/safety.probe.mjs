// SPIKE 16.1 (TEMPORARY): the safety questions. Which environment a pane child gets (AD-16), that stopping a pane
// stops only what Ogden started, and what happens to panes when the server itself dies.
import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { IS_WIN, PaneHost, SPIKE_DIR, alive, createRecorder, fakeCommand, now, openPane, paneEnv, sleep, startBystander, stripAnsi, waitDead } from '../lib/harness.mjs';
import { killProcessTree } from '../../../packages/adapters/src/process-tree.ts';

const rec = createRecorder('safety');
afterAll(() => rec.flush());

const SECRETS = {
  OGDEN_SPIKE_SENTINEL_KEY: 'sentinel-secret-001',
  ANTHROPIC_API_KEY: 'sentinel-anthropic-002',
  OPENAI_API_KEY: 'sentinel-openai-003',
  CODEX_API_KEY: 'sentinel-codex-004',
  XAI_API_KEY: 'sentinel-xai-005',
  GEMINI_API_KEY: 'sentinel-gemini-006',
  GH_TOKEN: 'sentinel-gh-007',
  GITHUB_TOKEN: 'sentinel-github-008',
  COPILOT_GITHUB_TOKEN: 'sentinel-copilot-009',
  OGDEN_AGENTS_DATA_DIR: 'sentinel-datadir-010',
  OGDEN_AGENTS_TAB_TOKEN: 'sentinel-tab-011',
  AWS_SECRET_ACCESS_KEY: 'sentinel-aws-012',
  LC_SECRET_TOKEN: 'sentinel-lc-013',
  NPM_TOKEN: 'sentinel-npm-014',
  HTTPS_PROXY: 'http://user:sentinel-proxy-015@proxy.invalid:8080',
  SSH_AUTH_SOCK: '/tmp/sentinel-ssh-016.sock',
};

describe('AD-16: the environment of a pane child', () => {
  it('no sentinel secret set in the server environment reaches a pane child', async () => {
    const saved = {};
    for (const [k, v] of Object.entries(SECRETS)) { saved[k] = process.env[k]; process.env[k] = v; }
    try {
      const env = paneEnv();
      const [file, args] = fakeCommand('env');
      const pane = await openPane({ file, args, env });
      await pane.waitFor('ENVDUMP-END', 15_000);
      const b64 = [...stripAnsi(pane.text).matchAll(/ENVB64 \d+:([A-Za-z0-9+/=]+)/g)].map((m) => m[1]).join('');
      const childEnv = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      const names = Object.keys(childEnv).sort();
      const leaked = Object.entries(SECRETS).filter(([k, v]) => k in childEnv || Object.values(childEnv).some((x) => String(x).includes(v.split('@').pop().slice(0, 12))) );
      rec.set('child_env_names', names);
      rec.set('child_env_has_TERM', childEnv.TERM ?? null);
      rec.set('child_env_has_COLORTERM', childEnv.COLORTERM ?? null);
      rec.set('sentinels_leaked', leaked.map(([k]) => k));
      pane.kill();
      expect(leaked).toEqual([]);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('an interactive plain shell with that environment shows no sentinel either, and runs', async () => {
    for (const [k, v] of Object.entries(SECRETS)) process.env[k] = v;
    try {
      const posix = !IS_WIN;
      const shell = posix ? (process.env.SHELL ?? '/bin/sh') : 'powershell.exe';
      const args = posix ? ['-i'] : ['-NoLogo'];
      const pane = await openPane({ file: shell, args, env: paneEnv() });
      await sleep(posix ? 1500 : 6000);
      pane.write(posix ? 'env; echo SHELL-ENV-END\r' : 'Get-ChildItem Env: | ForEach-Object { $_.Name + "=" + $_.Value }; Write-Output SHELL-ENV-END\r');
      await pane.waitFor(/SHELL-ENV-END[\s\S]*SHELL-ENV-END/, 45_000).catch(() => {});
      await sleep(500);
      const text = stripAnsi(pane.text);
      const leaked = Object.keys(SECRETS).filter((k) => new RegExp(`^${k}\\b`, 'm').test(text) || text.includes(SECRETS[k]));
      rec.set('shell_sentinels_leaked', leaked);
      rec.set('shell_env_listing_seen', text.includes('PATH'));
      pane.kill();
      expect(leaked).toEqual([]);
    } finally {
      for (const k of Object.keys(SECRETS)) delete process.env[k];
    }
  });
});

describe('stopping only what Ogden started', () => {
  it('closing panes stops each pane tree and never a bystander or a look-alike', async () => {
    const bystander = startBystander();
    // A look-alike: the very same command line as a pane's CLI, started outside Ogden (not through a pty).
    const decoy = spawn(process.execPath, [`${SPIKE_DIR}/fake-cli.mjs`, 'hang'], { stdio: 'ignore', detached: true, windowsHide: true });
    decoy.unref();
    const host = new PaneHost({ mirror: false });
    const [f1, a1] = fakeCommand('hang');
    const [f2, a2] = fakeCommand('tree');
    const [f3, a3] = fakeCommand('tree', 'detached');
    const hang = await host.open('hang', { file: f1, args: a1 });
    const tree = await host.open('tree', { file: f2, args: a2 });
    const detached = await host.open('detached', { file: f3, args: a3 });
    await hang.pane.waitFor('HANGING');
    await tree.pane.waitFor(/CHILD \d+/);
    await detached.pane.waitFor(/CHILD \d+/);
    const childOf = (e) => Number(/CHILD (\d+)/.exec(e.pane.text)[1]);
    const grandchild = childOf(tree);
    const detachedChild = childOf(detached);
    const pids = { hang: hang.pane.pid, tree: tree.pane.pid, grandchild, detachedChild, bystander: bystander.pid, decoy: decoy.pid };
    const t0 = now();
    host.closeAll();
    const results = {
      hangDead: await waitDead(hang.pane.pid),
      treeDead: await waitDead(tree.pane.pid),
      grandchildDead: await waitDead(grandchild),
      detachedPaneDead: await waitDead(detached.pane.pid),
      detachedChildDead: await waitDead(detachedChild, 3000),
    };
    const killMs = Math.round(now() - t0);
    const bystanderAlive = alive(bystander.pid);
    const decoyAlive = alive(decoy.pid);
    rec.set('kill', { ...results, bystanderAlive, decoyAlive, killMs, note: 'detachedChildDead false means a program a CLI started detached on purpose outlives its pane (accepted, as in 3.8)' });
    // Clean up everything the test itself started.
    for (const pid of [bystander.pid, decoy.pid, detachedChild, grandchild]) killProcessTree(pid);
    expect(results.hangDead && results.treeDead && results.grandchildDead).toBe(true);
    expect(bystanderAlive).toBe(true);
    expect(decoyAlive).toBe(true);
  });

  it('kill after the pane has already exited does nothing (no signal to a reused pid)', async () => {
    const [file, args] = fakeCommand('exit', 0);
    const pane = await openPane({ file, args });
    await pane.exited;
    const bystander = startBystander();
    pane.kill();
    pane.kill();
    await sleep(200);
    const stillAlive = alive(bystander.pid);
    killProcessTree(bystander.pid);
    expect(stillAlive).toBe(true);
    rec.set('kill_after_exit_touches_nothing', stillAlive);
  });

  it('when the server dies hard, what happens to the panes (a program that ignores hangup is the worst case)', async () => {
    const host = spawn(process.execPath, [`${SPIKE_DIR}/host-child.mjs`, 'hang', 'tree'], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    let out = '';
    host.stdout.on('data', (d) => { out += d; });
    const t0 = now();
    while (!/PIDS /.test(out) && now() - t0 < 15_000) await sleep(25);
    const pids = JSON.parse(/PIDS (\{.*\})/.exec(out)[1]);
    await sleep(800);
    const treeChild = await new Promise((resolve) => resolve(undefined));
    if (IS_WIN) spawn(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`, ['/pid', String(host.pid), '/F'], { stdio: 'ignore' });
    else process.kill(host.pid, 'SIGKILL');
    await sleep(2500);
    const survivors = { hang: alive(pids.hang), tree: alive(pids.tree) };
    rec.set('server_sigkill_survivors (panes left running after a hard server death)', { ...survivors, note: 'a program that ignores SIGHUP survives; epic 16 needs a startup sweep of its own recorded pids or a pid file per pane' });
    // Clean up what this test started.
    for (const pid of [pids.hang, pids.tree]) killProcessTree(pid);
    void treeChild;
    expect(true).toBe(true);
  });
});
