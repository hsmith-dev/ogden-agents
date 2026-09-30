/**
 * The toolchain routes (story 1.8): `GET /api/toolchain` reports uv's status
 * and `POST /api/toolchain/uv/install` starts the private install, behind the
 * gate (AD-15), with progress and the outcome in the event log (AD-5).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolchainError, type DetectedToolStatus, type ToolchainPort, type ToolProgress } from '@ogden-agents/core';
import { ToolchainInstallResponse, ToolchainResponse, TOOLCHAIN_PATH, UV_INSTALL_PATH } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { start, type RunningServer } from '../src/start.js';
import { signIn, tempDataDir } from './helpers.js';

const running: RunningServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
});

/** A stub port: missing until installed; `outcome` decides how the install ends. */
function stubPort(outcome: 'ok' | 'hash_mismatch' = 'ok') {
  let detected: DetectedToolStatus = { state: 'missing' };
  let installs = 0;
  const port: ToolchainPort = {
    uvVersion: '0.12.21',
    status: async () => detected,
    installUv: async (onProgress: (progress: ToolProgress) => void) => {
      installs++;
      onProgress({ bytes: 0, total: 2000 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      onProgress({ bytes: 2000, total: 2000 });
      if (outcome === 'hash_mismatch') {
        throw new ToolchainError('hash_mismatch', "The download didn't match the expected file, so nothing was installed. Try again.", {
          details: { target: 'x86_64-unknown-linux-gnu', expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
        });
      }
      detected = { state: 'ready', version: '0.12.21', source: 'private' };
      return { version: '0.12.21' };
    },
  };
  return { port, installs: () => installs };
}

async function startServer(toolchain: ToolchainPort, lines: string[] = []) {
  const dataDir = tempDataDir();
  const webRoot = join(dataDir, 'web');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><div id="root"></div>');
  const server = await start({ port: 0, open: false, dataDir, webRoot, toolchain, log: createLogger((line) => lines.push(line)) });
  running.push(server);
  return server;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const toolchainTypes = (server: RunningServer) =>
  server.core.events
    .readAfter(0)
    .filter((event) => event.type.startsWith('toolchain.'))
    .map((event) => event.type);

describe('toolchain routes', () => {
  it('report the status to a signed-in browser, and nothing without a session', async () => {
    const server = await startServer(stubPort().port);
    expect((await fetch(`${server.url}${TOOLCHAIN_PATH}`)).status).toBe(401);

    const { cookie } = await signIn(server);
    const response = await fetch(`${server.url}${TOOLCHAIN_PATH}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(ToolchainResponse.parse(await response.json())).toEqual({ uv: { state: 'missing' } });
  });

  it('refuse an install without a matching Origin (403), and download nothing', async () => {
    const stub = stubPort();
    const server = await startServer(stub.port);
    const { cookie } = await signIn(server);
    for (const headers of [{ cookie }, { cookie, origin: 'http://evil.example' }]) {
      expect((await fetch(`${server.url}${UV_INSTALL_PATH}`, { method: 'POST', headers })).status).toBe(403);
    }
    expect(stub.installs()).toBe(0);
    expect(toolchainTypes(server)).toEqual([]);
  });

  it('install on request, with progress and completion in the event log, then report ready', async () => {
    const stub = stubPort();
    const server = await startServer(stub.port);
    const { cookie, origin } = await signIn(server);
    // Nothing downloads at startup.
    expect(stub.installs()).toBe(0);

    const response = await fetch(`${server.url}${UV_INSTALL_PATH}`, { method: 'POST', headers: { cookie, origin } });
    expect(response.status).toBe(202);
    expect(ToolchainInstallResponse.parse(await response.json())).toMatchObject({ started: true, uv: { state: 'installing' } });

    await waitFor(() => toolchainTypes(server).includes('toolchain.install_completed'), 'the install to complete');
    expect(toolchainTypes(server)).toEqual([
      'toolchain.install_started',
      'toolchain.install_progress',
      'toolchain.install_progress',
      'toolchain.install_completed',
    ]);
    const status = await fetch(`${server.url}${TOOLCHAIN_PATH}`, { headers: { cookie } });
    expect(await status.json()).toEqual({ uv: { state: 'ready', version: '0.12.21', source: 'private' } });

    // Already ready: a second request starts nothing.
    const again = await fetch(`${server.url}${UV_INSTALL_PATH}`, { method: 'POST', headers: { cookie, origin } });
    expect(await again.json()).toMatchObject({ started: false, uv: { state: 'ready' } });
    expect(stub.installs()).toBe(1);
  });

  it('report a failed install plainly, logging the target and both hashes', async () => {
    const lines: string[] = [];
    const server = await startServer(stubPort('hash_mismatch').port, lines);
    const { cookie, origin } = await signIn(server);
    await fetch(`${server.url}${UV_INSTALL_PATH}`, { method: 'POST', headers: { cookie, origin } });
    await waitFor(() => toolchainTypes(server).includes('toolchain.install_failed'), 'the install to fail');

    const status = await fetch(`${server.url}${TOOLCHAIN_PATH}`, { headers: { cookie } });
    expect(await status.json()).toEqual({
      uv: { state: 'failed', reason: "The download didn't match the expected file, so nothing was installed. Try again.", canInstall: true },
    });
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === 'uv install failed');
    expect(logged).toMatchObject({ code: 'hash_mismatch', target: 'x86_64-unknown-linux-gnu', expected: 'a'.repeat(64), actual: 'b'.repeat(64) });
  });
});
