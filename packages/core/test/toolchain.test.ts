import { CoreEvent, TOOLCHAIN_STREAM, type ToolchainStatus } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createToolchain, ToolchainError, type DetectedToolStatus, type ToolchainPort, type ToolProgress } from '../src/index.js';
import { openTestCore } from './helpers.js';

/** A port whose status and install the test drives by hand. */
function fakePort(initial: DetectedToolStatus = { state: 'missing' }) {
  let detected: DetectedToolStatus = initial;
  let installs = 0;
  let finish!: (result: { version: string } | Error) => void;
  let report!: (progress: ToolProgress) => void;
  const port: ToolchainPort = {
    uvVersion: '0.12.21',
    status: async () => detected,
    installUv: (onProgress) => {
      installs++;
      report = onProgress;
      return new Promise((resolve, reject) => {
        finish = (result) => (result instanceof Error ? reject(result) : resolve(result));
      });
    },
  };
  return {
    port,
    setDetected: (status: DetectedToolStatus) => (detected = status),
    installs: () => installs,
    progress: (progress: ToolProgress) => report(progress),
    finish: (result: { version: string } | Error) => finish(result),
  };
}

const toolchainEvents = (core: ReturnType<typeof openTestCore>) =>
  core.events.readAfter(0).filter((event) => event.type.startsWith('toolchain.'));

describe('toolchain', () => {
  it('reports what the port detects, and never installs on its own', async () => {
    const core = openTestCore();
    const fake = fakePort({ state: 'ready', version: '0.12.19', source: 'system' });
    const toolchain = createToolchain(core.events, fake.port);
    expect(await toolchain.status()).toEqual({ state: 'ready', version: '0.12.19', source: 'system' });
    fake.setDetected({ state: 'missing' });
    expect(await toolchain.status()).toEqual({ state: 'missing' });
    expect(fake.installs()).toBe(0);
    expect(toolchainEvents(core)).toEqual([]);
  });

  it('does not install when uv is already ready', async () => {
    const core = openTestCore();
    const fake = fakePort({ state: 'ready', version: '0.12.19', source: 'system' });
    const toolchain = createToolchain(core.events, fake.port);
    expect(await toolchain.installUv()).toEqual({ started: false, uv: { state: 'ready', version: '0.12.19', source: 'system' } });
    expect(fake.installs()).toBe(0);
  });

  it('installs once, reports throttled progress, then completes', async () => {
    const core = openTestCore();
    const fake = fakePort();
    let clock = 0;
    const toolchain = createToolchain(core.events, fake.port, { now: () => clock, progressIntervalMs: 500 });

    const first = await toolchain.installUv();
    expect(first).toEqual({ started: true, uv: { state: 'installing', bytes: 0, total: null } });
    // A second click while it runs starts nothing.
    expect((await toolchain.installUv()).started).toBe(false);
    expect(fake.installs()).toBe(1);

    fake.progress({ bytes: 0, total: 1000 });
    clock = 100;
    fake.progress({ bytes: 100, total: 1000 }); // throttled
    clock = 600;
    fake.progress({ bytes: 600, total: 1000 });
    expect(await toolchain.status()).toEqual({ state: 'installing', bytes: 600, total: 1000 });
    clock = 700;
    fake.progress({ bytes: 1000, total: 1000 }); // the last one always goes out
    fake.setDetected({ state: 'ready', version: '0.12.21', source: 'private' });
    fake.finish({ version: '0.12.21' });
    await toolchain.settled();

    const events = toolchainEvents(core);
    for (const event of events) {
      expect(CoreEvent.parse(event)).toEqual(event);
      expect(event.workspaceId).toBeNull();
      expect(event.streamId).toBe(TOOLCHAIN_STREAM);
    }
    expect(events.map((event) => [event.type, event.payload])).toEqual([
      ['toolchain.install_started', { tool: 'uv', version: '0.12.21' }],
      ['toolchain.install_progress', { tool: 'uv', bytes: 0, total: 1000 }],
      ['toolchain.install_progress', { tool: 'uv', bytes: 600, total: 1000 }],
      ['toolchain.install_progress', { tool: 'uv', bytes: 1000, total: 1000 }],
      ['toolchain.install_completed', { tool: 'uv', version: '0.12.21', source: 'private' }],
    ]);
    expect(await toolchain.status()).toEqual({ state: 'ready', version: '0.12.21', source: 'private' });
  });

  it('records a failure with its plain reason, shows it until a retry, and passes the details to onFailure only', async () => {
    const core = openTestCore();
    const fake = fakePort();
    const failures: ToolchainError[] = [];
    const toolchain = createToolchain(core.events, fake.port, { onFailure: (error) => failures.push(error) });

    await toolchain.installUv();
    fake.finish(
      new ToolchainError('hash_mismatch', "The download didn't match the expected file, so nothing was installed. Try again.", {
        details: { target: 'x86_64-unknown-linux-gnu', expected: 'aa', actual: 'bb' },
      }),
    );
    await toolchain.settled();

    const failed: ToolchainStatus = {
      state: 'failed',
      reason: "The download didn't match the expected file, so nothing was installed. Try again.",
      canInstall: true,
    };
    expect(await toolchain.status()).toEqual(failed);
    const last = toolchainEvents(core).at(-1)!;
    expect(last.type).toBe('toolchain.install_failed');
    expect(last.payload).toEqual({ tool: 'uv', code: 'hash_mismatch', reason: failed.reason, canInstall: true });
    expect(JSON.stringify(last)).not.toContain('"expected"');
    expect(failures.map((f) => f.details)).toEqual([{ target: 'x86_64-unknown-linux-gnu', expected: 'aa', actual: 'bb' }]);

    // Try again: installing, then ready.
    expect((await toolchain.installUv()).started).toBe(true);
    expect((await toolchain.status()).state).toBe('installing');
    fake.setDetected({ state: 'ready', version: '0.12.21', source: 'private' });
    fake.finish({ version: '0.12.21' });
    await toolchain.settled();
    expect(await toolchain.status()).toEqual({ state: 'ready', version: '0.12.21', source: 'private' });
  });

  it('always sends a final progress event, even with an unknown total or a throttled last report', async () => {
    const core = openTestCore();
    const fake = fakePort();
    let clock = 0;
    const toolchain = createToolchain(core.events, fake.port, { now: () => clock, progressIntervalMs: 500 });
    await toolchain.installUv();
    fake.progress({ bytes: 0, total: null });
    clock = 100;
    fake.progress({ bytes: 700, total: null }); // throttled
    fake.setDetected({ state: 'ready', version: '0.12.21', source: 'private' });
    fake.finish({ version: '0.12.21' });
    await toolchain.settled();
    expect(toolchainEvents(core).map((event) => [event.type, event.payload])).toEqual([
      ['toolchain.install_started', { tool: 'uv', version: '0.12.21' }],
      ['toolchain.install_progress', { tool: 'uv', bytes: 0, total: null }],
      ['toolchain.install_progress', { tool: 'uv', bytes: 700, total: null }],
      ['toolchain.install_completed', { tool: 'uv', version: '0.12.21', source: 'private' }],
    ]);
  });

  it('sends a finished count once, however often it is reported', async () => {
    const core = openTestCore();
    const fake = fakePort();
    const toolchain = createToolchain(core.events, fake.port, { now: () => 0 });
    await toolchain.installUv();
    for (let i = 0; i < 3; i++) fake.progress({ bytes: 1000, total: 1000 });
    fake.finish({ version: '0.12.21' });
    await toolchain.settled();
    expect(toolchainEvents(core).filter((event) => event.type === 'toolchain.install_progress')).toHaveLength(1);
  });

  it('turns an unexpected error into a plain failure', async () => {
    const core = openTestCore();
    const fake = fakePort();
    const toolchain = createToolchain(core.events, fake.port);
    await toolchain.installUv();
    fake.finish(new Error('EACCES: permission denied'));
    await toolchain.settled();
    expect(await toolchain.status()).toEqual({ state: 'failed', reason: "uv couldn't be installed. Try again.", canInstall: true });
    expect(toolchainEvents(core).at(-1)!.payload).toMatchObject({ code: 'install_failed' });
  });
});
