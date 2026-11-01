/**
 * Which remote host the started server's remote machines go through (story
 * 27.10): the in-memory one only under the `OGDEN_AGENTS_TEST_REMOTE_HOST`
 * hook set to `memory` in a test run, the real SSH one otherwise (unset, or
 * outside a test run), and a remote host passed to `start()` always wins.
 * Read from what the real `wireAgents` returns, through the started server.
 */
import { createMemoryRemoteHostPort } from '@ogden-agents/adapters';
import type { RemoteHostPort } from '@ogden-agents/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_HOST_ENV } from '../src/test-hooks.js';
import { startTestServer } from './helpers.js';

const made = vi.hoisted(() => ({ ssh: new Set<object>(), memory: new Set<object>(), last: undefined as object | undefined }));

vi.mock('@ogden-agents/adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ogden-agents/adapters')>();
  return {
    ...actual,
    createSshRemoteHostPort: (...args: Parameters<typeof actual.createSshRemoteHostPort>) => {
      const port = actual.createSshRemoteHostPort(...args);
      made.ssh.add(port);
      return port;
    },
    createMemoryRemoteHostPort: (...args: Parameters<typeof actual.createMemoryRemoteHostPort>) => {
      const port = actual.createMemoryRemoteHostPort(...args);
      made.memory.add(port);
      return port;
    },
  };
});

vi.mock('../src/start-agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/start-agents.js')>();
  return {
    ...actual,
    wireAgents: (input: Parameters<typeof actual.wireAgents>[0]) => {
      const wired = actual.wireAgents(input);
      made.last = wired.remoteHosts;
      return wired;
    },
  };
});

const saved = { env: process.env[REMOTE_HOST_ENV], nodeEnv: process.env.NODE_ENV, vitest: process.env.VITEST };

afterEach(() => {
  for (const [name, value] of [[REMOTE_HOST_ENV, saved.env], ['NODE_ENV', saved.nodeEnv], ['VITEST', saved.vitest]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  made.last = undefined;
});

describe("the started server's remote host (27.10)", () => {
  it('is the in-memory host only with the hook set to memory in a test run', async () => {
    process.env[REMOTE_HOST_ENV] = 'memory';
    await startTestServer();
    expect(made.memory.has(made.last!)).toBe(true);
    expect(made.ssh.has(made.last!)).toBe(false);
  });

  it('is the real SSH host with the hook unset', async () => {
    delete process.env[REMOTE_HOST_ENV];
    await startTestServer();
    expect(made.ssh.has(made.last!)).toBe(true);
    expect(made.memory.has(made.last!)).toBe(false);
  });

  it('is the real SSH host with the hook set outside a test run', async () => {
    process.env[REMOTE_HOST_ENV] = 'memory';
    process.env.NODE_ENV = 'production';
    process.env.VITEST = '';
    await startTestServer();
    expect(made.ssh.has(made.last!)).toBe(true);
    expect(made.memory.has(made.last!)).toBe(false);
  });

  it('is the one passed to start(), whatever the hook says', async () => {
    process.env[REMOTE_HOST_ENV] = 'memory';
    const given: RemoteHostPort = createMemoryRemoteHostPort();
    const before = made.memory.size;
    await startTestServer({ remoteHost: given });
    expect(made.last).toBe(given);
    // The given port is the test's own (made before the start); the server made no other.
    expect(made.memory.size).toBe(before);
  });
});
