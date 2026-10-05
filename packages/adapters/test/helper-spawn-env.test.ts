/**
 * AD-16 (epic 6 entry 10) at the spawn sites that used to inherit the whole
 * environment: the kill helper (`taskkill`) and the Windows shortcut script
 * (PowerShell). `node:child_process` is replaced, so nothing runs; the test
 * reads the environment each call was given, with keys planted in this
 * process's own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<{ file: string; env: Record<string, string> | undefined }>);
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawnSync: (file: string, _args: unknown, options: { env?: Record<string, string> }) => {
    calls.push({ file, env: options.env });
    return { status: 0 };
  },
  execFile: (file: string, _args: unknown, options: { env?: Record<string, string> }, callback: (error: Error | null, stdout: string) => void) => {
    calls.push({ file, env: options.env });
    queueMicrotask(() => callback(null, ''));
    return { stdin: { on: () => {}, end: () => {} } };
  },
}));

const { nodeProcessTreeSystem } = await import('../src/process-tree.js');
const { runPowerShell } = await import('../src/shortcut-os/windows.js');

const PLANTED = { ANTHROPIC_API_KEY: 'sk-ant-planted', GEMINI_API_KEY: 'AIza-planted', GITHUB_TOKEN: 'ghp_planted', OGDEN_E2E_SECRET_PROBE: 'planted' };
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  calls.length = 0;
  saved = Object.fromEntries(Object.keys(PLANTED).map((name) => [name, process.env[name]]));
  Object.assign(process.env, PLANTED);
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const expectNoSecrets = (env: Record<string, string> | undefined) => {
  expect(env).toBeDefined();
  for (const name of Object.keys(PLANTED)) expect(env, name).not.toHaveProperty(name);
  expect(JSON.stringify(env)).not.toContain('planted');
};

describe('helper spawns get the allowlist, never a key (AD-16)', () => {
  it('the kill helper', () => {
    nodeProcessTreeSystem.run('taskkill.exe', ['/pid', '1']);
    expect(calls).toHaveLength(1);
    expectNoSecrets(calls[0]!.env);
    // `Path` on Windows.
    expect(Object.keys(calls[0]!.env ?? {}).map((name) => name.toUpperCase())).toContain('PATH');
  });

  it("the Windows shortcut script, with the script's own values", async () => {
    await runPowerShell('Write-Output 1', { OGDEN_LINK_PATH: 'C:\\link.lnk' });
    expect(calls).toHaveLength(1);
    expectNoSecrets(calls[0]!.env);
    expect(calls[0]!.env).toMatchObject({ OGDEN_LINK_PATH: 'C:\\link.lnk' });
  });
});
