/**
 * Generic developer CLI tools (CAP-25, story: generic developer CLI tools
 * detect, install, and sandbox-gate): the catalog (seed + custom), a
 * confirmed real install (and its refusal/failure), and a project's
 * unattended-build allowlist (deny by default) and the sandbox lookup it
 * feeds.
 */
import { describe, expect, it } from 'vitest';
import { DevToolsError, type DevToolDescriptor, type DevToolDetection, type DevToolRunResult, type DevToolsPort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/** A seed catalog of one tool, plus a hand-driven run/detect the test controls. */
function fakePort(seed: DevToolDescriptor[] = [{ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', executables: ['gcloud'], installCommand: 'install gcloud' }]) {
  const installed = new Map<string, string>();
  let runs = 0;
  let runAnswer: DevToolRunResult = { ok: true };
  const port: DevToolsPort = {
    seedCatalog: () => seed,
    detect: async (tool): Promise<DevToolDetection> => {
      const path = installed.get(tool.id);
      return path === undefined ? { installed: false } : { installed: true, path };
    },
    run: async () => {
      runs++;
      return runAnswer;
    },
  };
  return {
    port,
    markInstalled: (id: string, path: string) => installed.set(id, path),
    runs: () => runs,
    setRunAnswer: (answer: DevToolRunResult) => (runAnswer = answer),
  };
}

describe('generic developer CLI tools', () => {
  it('lists the seed catalog, each resolved live, and never execs to detect', async () => {
    const core = openTestCore(undefined, undefined, { devToolsPort: fakePort().port });
    expect(await core.devTools.list()).toEqual([{ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', installed: false, installCommand: 'install gcloud' }]);
  });

  it('names a custom tool, which appears in the catalog like a seed one, and can be removed', async () => {
    const core = openTestCore(undefined, undefined, { devToolsPort: fakePort().port });
    const added = await core.devTools.addCustomTool({ id: 'terraform', label: 'Terraform', executable: 'terraform', installCommand: 'install terraform' });
    expect(added).toEqual({ id: 'terraform', label: 'Terraform', source: 'custom', installed: false, installCommand: 'install terraform' });
    expect(await core.devTools.list()).toHaveLength(2);
    await core.devTools.removeCustomTool('terraform');
    expect(await core.devTools.list()).toHaveLength(1);
  });

  it('refuses a duplicate custom tool id, including one a seed tool already uses', async () => {
    const core = openTestCore(undefined, undefined, { devToolsPort: fakePort().port });
    await core.devTools.addCustomTool({ id: 'terraform', label: 'Terraform', executable: 'terraform', installCommand: 'x' });
    await expect(core.devTools.addCustomTool({ id: 'terraform', label: 'Again', executable: 'tf', installCommand: 'y' })).rejects.toThrow();
    await expect(core.devTools.addCustomTool({ id: 'gcloud', label: 'Mine', executable: 'g', installCommand: 'z' })).rejects.toThrow();
  });

  it('runs the real install command only on confirmation, and never a bare request', async () => {
    const fake = fakePort();
    const core = openTestCore(undefined, undefined, { devToolsPort: fake.port });
    await expect(core.devTools.install('gcloud', {})).rejects.toThrow();
    expect(fake.runs()).toBe(0);
    fake.markInstalled('gcloud', '/usr/local/bin/gcloud');
    const status = await core.devTools.install('gcloud', { confirm: true });
    expect(fake.runs()).toBe(1);
    expect(status).toEqual({ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', installed: true, installCommand: 'install gcloud' });
  });

  it('leaves the tool not installed with a plain reason when the real installer fails, and never retries by itself', async () => {
    const fake = fakePort();
    fake.setRunAnswer({ ok: false, reason: 'brew: command not found' });
    const core = openTestCore(undefined, undefined, { devToolsPort: fake.port });
    await expect(core.devTools.install('gcloud', { confirm: true })).rejects.toMatchObject({ message: 'brew: command not found' });
    expect(fake.runs()).toBe(1);
    expect((await core.devTools.list())[0]?.installed).toBe(false);
    // Nothing retried on its own: a second look is still not installed.
    expect((await core.devTools.list())[0]?.installed).toBe(false);
  });

  it('refuses with no_install_command when this OS has none, before ever calling run', async () => {
    const fake = fakePort([{ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', executables: ['gcloud'] }]);
    const core = openTestCore(undefined, undefined, { devToolsPort: fake.port });
    const error = await core.devTools.install('gcloud', { confirm: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevToolsError);
    expect((error as DevToolsError).code).toBe('no_install_command');
    expect(fake.runs()).toBe(0);
  });

  it('allows and revokes one tool for one project, visibly and scoped to that project', async () => {
    const fake = fakePort();
    fake.markInstalled('gcloud', '/usr/local/bin/gcloud');
    const core = openTestCore(undefined, undefined, { devToolsPort: fake.port });
    const a = core.entities.ensureWorkspace(tempDir());
    const b = core.entities.ensureWorkspace(tempDir());
    expect(await core.devTools.unattendedAllowlist(a.id)).toEqual([{ id: 'gcloud', label: 'Google Cloud CLI', installed: true, allowed: false }]);
    await core.devTools.setUnattendedAllowed(a.id, 'gcloud', { allowed: true });
    expect(await core.devTools.unattendedAllowlist(a.id)).toEqual([{ id: 'gcloud', label: 'Google Cloud CLI', installed: true, allowed: true }]);
    // Scoped to project a only.
    expect(await core.devTools.unattendedAllowlist(b.id)).toEqual([{ id: 'gcloud', label: 'Google Cloud CLI', installed: true, allowed: false }]);
    await core.devTools.setUnattendedAllowed(a.id, 'gcloud', { allowed: false });
    expect((await core.devTools.unattendedAllowlist(a.id))[0]?.allowed).toBe(false);
  });

  it('deniedReadPathsFor denies every installed, not-yet-allowed tool, and omits an allowed one', async () => {
    const fake = fakePort([
      { id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', executables: ['gcloud'], installCommand: 'x' },
      { id: 'docker', label: 'Docker', source: 'seed', executables: ['docker'], installCommand: 'y' },
    ]);
    fake.markInstalled('gcloud', '/usr/local/bin/gcloud');
    fake.markInstalled('docker', '/usr/local/bin/docker');
    const core = openTestCore(undefined, undefined, { devToolsPort: fake.port });
    const ws = core.entities.ensureWorkspace(tempDir());
    expect(new Set(await core.devTools.deniedReadPathsFor(ws.id))).toEqual(new Set(['/usr/local/bin/gcloud', '/usr/local/bin/docker']));
    await core.devTools.setUnattendedAllowed(ws.id, 'gcloud', { allowed: true });
    expect(await core.devTools.deniedReadPathsFor(ws.id)).toEqual(['/usr/local/bin/docker']);
  });

  it('deniedReadPathsFor denies everything installed for an unknown workspace (fail closed)', async () => {
    const fake = fakePort();
    fake.markInstalled('gcloud', '/usr/local/bin/gcloud');
    const core = openTestCore(undefined, undefined, { devToolsPort: fake.port });
    expect(await core.devTools.deniedReadPathsFor('ws_unknown' as never)).toEqual(['/usr/local/bin/gcloud']);
  });
});
