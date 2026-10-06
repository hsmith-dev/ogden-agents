/**
 * Pane launchers and install detection (epic 16, story 16.5; E16-R5, R9): the
 * list as data, detection by lookup and `--version` (no install, no shell,
 * allowlisted environment), and the command a pane starts. A fake computer
 * stands in for the real one; the real fake programs run in the server tests.
 */
import { PaneLauncher } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createPaneLaunchers, detectLauncher, PANE_LAUNCHERS, SHELL_LAUNCHER, type DetectSystem } from '../src/index.js';

const SENTINELS = { ANTHROPIC_API_KEY: 'sk-ant-planted', OPENAI_API_KEY: 'sk-planted', GH_TOKEN: 'ghp_planted', NPM_TOKEN: 'npm_planted' };
const byId = (id: string) => PANE_LAUNCHERS.find((launcher) => launcher.id === id)!;

function computer(files: string[], opts: { platform?: NodeJS.Platform; env?: Record<string, string>; failing?: string[]; probed?: Array<{ path: string; env: Record<string, string> }> } = {}): DetectSystem {
  const platform = opts.platform ?? 'darwin';
  return {
    platform,
    env: opts.env ?? { PATH: '/usr/bin:/opt/bin', HOME: '/home/u', ...SENTINELS },
    runnable: (path) => files.includes(path),
    async probe(path, env) {
      opts.probed?.push({ path, env });
      return opts.failing?.includes(path) ? { ok: false } : { ok: true, version: `${path.split(/[\\/]/).pop()} 9.9.9` };
    },
  };
}

describe('the launcher list is data (E16-R1, R5, R9)', () => {
  it('has the decided list in order: the shell, Claude Code, Codex, Grok, Antigravity, Copilot, and Gemini only if installed', () => {
    expect(PANE_LAUNCHERS.map((launcher) => launcher.id)).toEqual(['shell', 'claude-code', 'codex', 'grok', 'antigravity', 'copilot', 'gemini']);
    expect(PANE_LAUNCHERS[0]).toBe(SHELL_LAUNCHER);
    expect(byId('gemini').showWhenMissing).toBe(false);
    for (const launcher of PANE_LAUNCHERS.filter((one) => one.id !== 'gemini')) expect(launcher.showWhenMissing, launcher.id).toBe(true);
    for (const launcher of PANE_LAUNCHERS) expect(PaneLauncher.safeParse(launcher).success, launcher.id).toBe(true);
  });

  it('marks Copilot interactive only, and no launcher adds a flag of Ogden\'s own that skips a permission prompt', () => {
    expect(byId('copilot').termsNote).toBe('interactive_only');
    for (const launcher of PANE_LAUNCHERS.filter((one) => one.id !== 'copilot')) expect(launcher.termsNote).toBeUndefined();
    for (const launcher of PANE_LAUNCHERS) expect(launcher.defaultArgs, launcher.id).toEqual([]);
  });

  it('every CLI has the install page of its vendor, https, and conservative prompt patterns as data', () => {
    for (const launcher of PANE_LAUNCHERS.filter((one) => one.kind === 'cli')) {
      expect(launcher.installUrl, launcher.id).toMatch(/^https:\/\//);
      expect(launcher.promptPatterns.length, launcher.id).toBeGreaterThan(0);
    }
  });
});

describe('detection looks, and never installs (E16-R5)', () => {
  it('finds a program on PATH and answers with its version', async () => {
    const found = await detectLauncher(byId('claude-code'), computer(['/usr/bin/claude']));
    expect(found).toMatchObject({ launcherId: 'claude-code', state: 'found', path: '/usr/bin/claude', version: 'claude 9.9.9' });
  });

  it('finds it at a well known place when it is not on PATH, with ~ expanded', async () => {
    const found = await detectLauncher(byId('claude-code'), computer(['/home/u/.local/bin/claude']));
    expect(found).toMatchObject({ state: 'found', path: '/home/u/.local/bin/claude' });
  });

  it('says not found with a plain reason and the way to fix it, and found but failed when it does not answer', async () => {
    const missing = await detectLauncher(byId('codex'), computer([]));
    expect(missing).toMatchObject({ state: 'not_found' });
    expect(missing.reason).toBe('Codex was not found on this computer. Install it yourself, then press Detect.');
    const failed = await detectLauncher(byId('codex'), computer(['/usr/bin/codex'], { failing: ['/usr/bin/codex'] }));
    expect(failed).toMatchObject({ state: 'failed', path: '/usr/bin/codex' });
    expect(failed.reason).toContain('did not answer');
  });

  it('runs only the version request, under the allowlist: none of the server\'s secrets reaches it', async () => {
    const probed: Array<{ path: string; env: Record<string, string> }> = [];
    await detectLauncher(byId('grok'), computer(['/usr/bin/grok'], { probed }));
    expect(probed).toHaveLength(1);
    for (const name of Object.keys(SENTINELS)) expect(probed[0]!.env, name).not.toHaveProperty(name);
    expect(Object.values(probed[0]!.env).join('\n')).not.toContain('planted');
  });

  it('ignores a PATH folder that is not absolute, so nothing in the folder Ogden runs in stands in for a program', async () => {
    const system = computer(['./claude', 'bin/claude'], { env: { PATH: './:bin:', HOME: '/home/u' } });
    expect((await detectLauncher(byId('claude-code'), system)).state).toBe('not_found');
  });

  it('Windows: tries each PATHEXT, matches names without case, expands %VARS%, and finds an npm .cmd shim', async () => {
    const env = { Path: 'C:\\bin;C:\\Users\\u\\AppData\\Roaming\\npm', PATHEXT: '.EXE;.CMD', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\u' };
    const shim = await detectLauncher(byId('codex'), computer(['C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'], { platform: 'win32', env }));
    expect(shim).toMatchObject({ state: 'found', path: 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd' });
    const known = await detectLauncher(byId('claude-code'), computer(['C:\\Users\\u\\.local\\bin\\claude.exe'], { platform: 'win32', env }));
    expect(known).toMatchObject({ state: 'found', path: 'C:\\Users\\u\\.local\\bin\\claude.exe' });
  });

  it('the shell is always found without looking', async () => {
    expect(await detectLauncher(SHELL_LAUNCHER, computer([]))).toEqual({ launcherId: 'shell', state: 'found' });
  });
});

describe('the launchers port', () => {
  const launchers = (files: string[], extra = {}) => createPaneLaunchers({ launchers: PANE_LAUNCHERS, system: computer(files, extra) });

  it('lists every launcher with its detection, leaves a missing Gemini out and shows an installed one, and never gives out a path', async () => {
    const without = await launchers(['/usr/bin/claude']).list();
    expect(without.map((one) => [one.launcher.id, one.detection.state])).toEqual([
      ['shell', 'found'],
      ['claude-code', 'found'],
      ['codex', 'not_found'],
      ['grok', 'not_found'],
      ['antigravity', 'not_found'],
      ['copilot', 'not_found'],
    ]);
    expect(JSON.stringify(without)).not.toContain('/usr/bin');
    const withGemini = await launchers(['/usr/bin/gemini']).list();
    expect(withGemini.some((one) => one.launcher.id === 'gemini' && one.detection.state === 'found')).toBe(true);
  });

  it('looks once, and again only when asked (the Detect button)', async () => {
    let installed = false;
    const system: DetectSystem = { ...computer([]), runnable: (path) => installed && path === '/usr/bin/codex' };
    const port = createPaneLaunchers({ launchers: PANE_LAUNCHERS, system });
    expect((await port.list()).find((one) => one.launcher.id === 'codex')!.detection.state).toBe('not_found');
    installed = true;
    expect((await port.list()).find((one) => one.launcher.id === 'codex')!.detection.state).toBe('not_found');
    expect((await port.detect()).find((one) => one.launcher.id === 'codex')!.detection.state).toBe('found');
    expect((await port.list()).find((one) => one.launcher.id === 'codex')!.detection.state).toBe('found');
  });

  it('starts exactly the absolute path found, with only the launcher\'s own arguments then what the user typed', async () => {
    const port = launchers(['/usr/bin/claude']);
    expect(await port.command('claude-code', ['--model', 'x'])).toEqual({ ok: true, file: '/usr/bin/claude', args: ['--model', 'x'] });
  });

  it('refuses in plain words a program that is not found, one that did not answer, the shell and an unknown id', async () => {
    const port = launchers(['/usr/bin/grok'], { failing: ['/usr/bin/grok'] });
    expect(await port.command('codex', [])).toMatchObject({ ok: false, code: 'not_found', reason: 'Codex was not found on this computer. Install it yourself, then press Detect.' });
    expect(await port.command('grok', [])).toMatchObject({ ok: false, code: 'failed' });
    expect(await port.command('shell', [])).toMatchObject({ ok: false, code: 'unknown_launcher' });
    expect(await port.command('nope', [])).toMatchObject({ ok: false, code: 'unknown_launcher' });
  });
});
