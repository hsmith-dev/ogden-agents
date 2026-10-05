/**
 * The sandbox chain (story 5.6): the native sandbox, then Docker, each probed
 * and explained in plain words, failing closed. Fakes for every program; the
 * real probes run only as unit-level capability checks that assert a boolean
 * or a state and never start a sandboxed run.
 */
import { describe, expect, it } from 'vitest';
import { SandboxStatus } from '@ogden-agents/shared';
import {
  BUBBLEWRAP_BLOCKED,
  BUBBLEWRAP_BLOCKED_HINT,
  BUBBLEWRAP_HINT,
  createClaudeNativeSandbox,
  createDockerStep,
  createNativeSandboxStep,
  createSandboxChain,
  DOCKER_HINT,
  DOCKER_MISSING_NOTE,
  DOCKER_NOT_RUNNING_NOTE,
  DOCKER_UNSUPPORTED_NOTE,
  DOCKER_WINDOWS_CONTAINERS_NOTE,
  LANDLOCK_NOTE,
  NO_BUBBLEWRAP,
  NO_SANDBOX_ON_WINDOWS,
  NO_SEATBELT,
  probeDocker,
  runCapabilityProbe,
  SANDBOX_CHOICES_DEFAULT,
  SANDBOX_CHOICES_WINDOWS,
  SEATBELT_BLOCKED,
  WINDOWS_HINT,
  type DockerState,
  type SandboxStep,
} from '../src/index.js';

const only = (files: string[]) => (file: string) => files.includes(file);
const yes = async () => true;
const no = async () => false;

describe('the native sandbox step (story 5.6)', () => {
  it('macOS: Seatbelt only when sandbox-exec is there and its trivial profile runs', async () => {
    const ok = createClaudeNativeSandbox({ platform: 'darwin', isExecutable: only(['/usr/bin/sandbox-exec']), probe: yes });
    expect(await ok.check()).toEqual({ available: true, kind: 'seatbelt' });
    expect(await createClaudeNativeSandbox({ platform: 'darwin', isExecutable: only(['/usr/bin/sandbox-exec']), probe: no }).check()).toMatchObject({ available: false, reason: SEATBELT_BLOCKED });
    const missing = createClaudeNativeSandbox({ platform: 'darwin', isExecutable: only([]), probe: yes });
    expect(await missing.check()).toEqual({ available: false, reason: NO_SEATBELT, choices: SANDBOX_CHOICES_DEFAULT });
    expect((await missing.status()).installHint).toContain('macOS');
  });

  it('Linux: bubblewrap needs bwrap and socat on PATH and a working namespace probe; AppArmor blocking it is said so', async () => {
    const path = ['/opt/a', '/usr/bin'].join(':');
    const base = { platform: 'linux' as const, path, readSystemFile: () => 'capability,yama,apparmor' };
    expect(await createClaudeNativeSandbox({ ...base, isExecutable: only(['/usr/bin/bwrap', '/opt/a/socat']), probe: yes }).check()).toEqual({ available: true, kind: 'bubblewrap' });

    const blocked = createClaudeNativeSandbox({ ...base, isExecutable: only(['/usr/bin/bwrap', '/opt/a/socat']), probe: no });
    expect(await blocked.check()).toEqual({ available: false, reason: BUBBLEWRAP_BLOCKED, choices: SANDBOX_CHOICES_DEFAULT });
    expect((await blocked.status()).installHint).toBe(BUBBLEWRAP_BLOCKED_HINT);

    const noSocat = createClaudeNativeSandbox({ ...base, isExecutable: only(['/usr/bin/bwrap']), probe: yes });
    expect(await noSocat.check()).toEqual({ available: false, reason: NO_BUBBLEWRAP, choices: SANDBOX_CHOICES_DEFAULT });
    expect((await noSocat.status()).installHint).toBe(BUBBLEWRAP_HINT);
    expect(await createClaudeNativeSandbox({ ...base, path: '', isExecutable: () => true, probe: yes }).check()).toMatchObject({ available: false, reason: NO_BUBBLEWRAP });
  });

  it('the probe runs the program found on PATH with the namespace arguments, and nothing else', async () => {
    const calls: Array<[string, readonly string[]]> = [];
    await createNativeSandboxStep({ platform: 'linux', path: '/usr/bin', isExecutable: () => true, readSystemFile: () => undefined, probe: async (file, args) => (calls.push([file, args]), true) }).inspect();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/usr/bin/bwrap');
    expect(calls[0]![1]).toContain('--unshare-user');
    expect(calls[0]![1].at(-1)).toBe('true');
  });

  it('Linux shows Landlock as detected but never picks it', async () => {
    const step = createNativeSandboxStep({ platform: 'linux', path: '', isExecutable: () => false, readSystemFile: () => 'lockdown,capability,landlock,yama' });
    const result = await step.inspect();
    expect(result.kind).toBeUndefined();
    expect(result.probes).toContainEqual({ kind: 'landlock', state: 'detected', note: LANDLOCK_NOTE });
  });

  it('Windows (and anything else): none, with building with you watching first, and Docker Desktop optional', async () => {
    const windows = createSandboxChain({ platform: 'win32', steps: [createNativeSandboxStep({ platform: 'win32', isExecutable: () => true })] });
    expect(await windows.check()).toEqual({ available: false, reason: NO_SANDBOX_ON_WINDOWS, choices: SANDBOX_CHOICES_WINDOWS });
    expect(SANDBOX_CHOICES_WINDOWS[0]).toBe('attended');
    expect((await windows.status()).installHint).toBe(WINDOWS_HINT);
    expect(await createClaudeNativeSandbox({ platform: 'freebsd', isExecutable: () => true }).check()).toMatchObject({ available: false, choices: SANDBOX_CHOICES_DEFAULT });
  });
});

describe('the Docker step and the chain (story 5.6)', () => {
  const docker = (state: DockerState) => createDockerStep({ probe: async () => state });

  it('reports what Docker is in plain words, and never offers it as a sandbox', async () => {
    const notes: Record<DockerState, [string, string]> = {
      ready: ['detected', DOCKER_UNSUPPORTED_NOTE],
      windows_containers: ['blocked', DOCKER_WINDOWS_CONTAINERS_NOTE],
      not_running: ['blocked', DOCKER_NOT_RUNNING_NOTE],
      missing: ['missing', DOCKER_MISSING_NOTE],
    };
    for (const [state, [probeState, note]] of Object.entries(notes) as Array<[DockerState, [string, string]]>) {
      const result = await docker(state).inspect();
      expect(result.kind, state).toBeUndefined();
      expect(result.probes, state).toEqual([{ kind: 'docker', state: probeState, note }]);
    }
    expect((await docker('missing').inspect()).installHint).toBe(DOCKER_HINT);
    expect((await docker('ready').inspect()).installHint).toBeNull();
    // A probe that throws is "not running", never "ready".
    expect((await createDockerStep({ probe: async () => Promise.reject(new Error('boom')) }).inspect()).probes[0]?.state).toBe('blocked');
  });

  it('tries the native sandbox first and asks Docker only when it cannot', async () => {
    let asked = 0;
    const counting: SandboxStep = { inspect: async () => (asked++, { kind: undefined, probes: [], reason: '', installHint: null }) };
    const native = createNativeSandboxStep({ platform: 'darwin', isExecutable: only(['/usr/bin/sandbox-exec']), probe: yes });
    const available = createSandboxChain({ platform: 'darwin', steps: [native, counting] });
    expect(await available.check()).toEqual({ available: true, kind: 'seatbelt' });
    expect(asked).toBe(0);
    const status = await available.status();
    expect(status).toMatchObject({ platform: 'macos', available: true, kind: 'seatbelt', choices: [], installHint: null });
    expect(status.summary).toContain("Claude Code's sandbox");
    expect(SandboxStatus.safeParse(status).success).toBe(true);
  });

  it('with Docker ready but no native sandbox it is still unavailable (fail closed), saying what was found, and check and status agree', async () => {
    const chain = createSandboxChain({ platform: 'linux', steps: [createNativeSandboxStep({ platform: 'linux', path: '', isExecutable: () => false, readSystemFile: () => undefined }), docker('ready')] });
    const check = await chain.check();
    const status = await chain.status();
    expect(check).toEqual({ available: false, reason: NO_BUBBLEWRAP, choices: SANDBOX_CHOICES_DEFAULT });
    expect(status).toMatchObject({ platform: 'linux', available: false, kind: null, summary: NO_BUBBLEWRAP, choices: [...SANDBOX_CHOICES_DEFAULT] });
    expect(status.probes.map((probe) => `${probe.kind}:${probe.state}`)).toEqual(['bubblewrap:missing', 'docker:detected']);
    expect(status.installHint).toBe(BUBBLEWRAP_HINT);
    expect(SandboxStatus.safeParse(status).success).toBe(true);
  });

  it('a step that throws is a step that cannot, never an available sandbox', async () => {
    const chain = createSandboxChain({ platform: 'darwin', steps: [{ inspect: () => Promise.reject(new Error('boom')) }] });
    expect(await chain.check()).toMatchObject({ available: false });
    expect(await chain.status()).toMatchObject({ available: false, kind: null });
  });

  it('an empty chain is unavailable', async () => {
    expect(await createSandboxChain({ steps: [] }).check()).toMatchObject({ available: false });
  });
});

describe('real capability probes (unit level; they assert a shape, never start a sandboxed run)', () => {
  it('runCapabilityProbe is true for a program that exits 0, false for one that fails or is missing', async () => {
    expect(await runCapabilityProbe(process.execPath, ['-e', 'process.exit(0)'])).toBe(true);
    expect(await runCapabilityProbe(process.execPath, ['-e', 'process.exit(3)'])).toBe(false);
    expect(await runCapabilityProbe('/no/such/program-ogden', [])).toBe(false);
  });

  it('probeDocker answers one of the four states, whatever this computer has', async () => {
    expect(['ready', 'windows_containers', 'not_running', 'missing']).toContain(await probeDocker(() => ({ PATH: process.env.PATH ?? '' })));
    expect(await probeDocker(() => ({ PATH: '/no/such/dir' }))).toBe('missing');
  });

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('the native step on this computer answers a sandbox kind or why not, and runs only its own trivial test', async () => {
    const result = await createNativeSandboxStep().inspect();
    expect([undefined, process.platform === 'darwin' ? 'seatbelt' : 'bubblewrap']).toContain(result.kind);
    if (result.kind === undefined) expect(result.reason).not.toBe('');
  });
});
