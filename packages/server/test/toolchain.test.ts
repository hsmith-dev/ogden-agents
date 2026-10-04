/**
 * The toolchain routes (story 1.8): `GET /api/v1/toolchain` reports uv's status
 * and `POST /api/v1/toolchain/uv/install` starts the private install, behind the
 * gate (AD-15), with progress and the outcome in the event log (AD-5).
 */
import { ToolchainError, type DetectedToolStatus, type ToolchainPort, type ToolProgress } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, ToolchainInstallResponse, ToolchainResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/start.js';
import { signIn, startTestServer, waitFor } from './helpers.js';

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

/** A test server whose uv comes from `toolchain`. */
const startServer = (toolchain: ToolchainPort, lines: string[] = []) => startTestServer({ toolchain, lines });

const toolchainTypes = (server: RunningServer) =>
  server.core.events
    .readAfter(0)
    .filter((event) => event.type.startsWith('toolchain.'))
    .map((event) => event.type);

describe('toolchain routes', () => {
  it("report the status to a connected tab, and nothing without its token (an old cookie doesn't count)", async () => {
    const server = await startServer(stubPort().port);
    expect((await fetch(`${server.url}${API_ROUTES.toolchain}`)).status).toBe(401);
    const cookie = `ogden_session_${server.port}=AAAAAAAAAAAAAAAAAAAAAA.${Math.floor(Date.now() / 1000) + 3600}.${'A'.repeat(43)}`;
    expect((await fetch(`${server.url}${API_ROUTES.toolchain}`, { headers: { cookie } })).status).toBe(401);

    const { token } = await signIn(server);
    const response = await fetch(`${server.url}${API_ROUTES.toolchain}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(ToolchainResponse.parse(await response.json())).toEqual({ uv: { state: 'missing' } });
  });

  it('refuse an install without a matching Origin (403), and download nothing', async () => {
    const stub = stubPort();
    const server = await startServer(stub.port);
    const { token } = await signIn(server);
    const authorization = `Bearer ${token}`;
    for (const headers of [{ authorization }, { authorization, origin: 'http://evil.example' }]) {
      expect((await fetch(`${server.url}${API_ROUTES.uvInstall}`, { method: 'POST', headers })).status).toBe(403);
    }
    expect(stub.installs()).toBe(0);
    expect(toolchainTypes(server)).toEqual([]);
  });

  it('install on request, with progress and completion in the event log, then report ready', async () => {
    const stub = stubPort();
    const server = await startServer(stub.port);
    const { token, headers } = await signIn(server);
    const authorization = `Bearer ${token}`;
    // Nothing downloads at startup.
    expect(stub.installs()).toBe(0);

    const response = await fetch(`${server.url}${API_ROUTES.uvInstall}`, { method: 'POST', headers });
    expect(response.status).toBe(202);
    expect(ToolchainInstallResponse.parse(await response.json())).toMatchObject({ started: true, uv: { state: 'installing' } });

    await waitFor(() => toolchainTypes(server).includes('toolchain.install_completed'), 'the install to complete');
    expect(toolchainTypes(server)).toEqual([
      'toolchain.install_started',
      'toolchain.install_progress',
      'toolchain.install_progress',
      'toolchain.install_completed',
    ]);
    const status = await fetch(`${server.url}${API_ROUTES.toolchain}`, { headers: { authorization } });
    expect(await status.json()).toEqual({ uv: { state: 'ready', version: '0.12.21', source: 'private' } });

    // Already ready: a second request starts nothing.
    const again = await fetch(`${server.url}${API_ROUTES.uvInstall}`, { method: 'POST', headers });
    expect(await again.json()).toMatchObject({ started: false, uv: { state: 'ready' } });
    expect(stub.installs()).toBe(1);
  });

  it('answer a status the server could not read with the shared error body (500)', async () => {
    const broken: ToolchainPort = {
      ...stubPort().port,
      status: async () => {
        throw new Error('disk on fire');
      },
    };
    const server = await startServer(broken);
    const { headers } = await signIn(server);
    const response = await fetch(`${server.url}${API_ROUTES.toolchain}`, { headers });
    expect(response.status).toBe(500);
    expect(ApiErrorBody.parse(await response.json())).toEqual({
      error: { code: 'toolchain_unavailable', message: "Ogden Agents couldn't check for uv. Try again." },
    });
  });

  it('report a failed install plainly, logging the target and both hashes', async () => {
    const lines: string[] = [];
    const server = await startServer(stubPort('hash_mismatch').port, lines);
    const { token, headers } = await signIn(server);
    const authorization = `Bearer ${token}`;
    await fetch(`${server.url}${API_ROUTES.uvInstall}`, { method: 'POST', headers });
    await waitFor(() => toolchainTypes(server).includes('toolchain.install_failed'), 'the install to fail');

    const status = await fetch(`${server.url}${API_ROUTES.toolchain}`, { headers: { authorization } });
    expect(await status.json()).toEqual({
      uv: { state: 'failed', reason: "The download didn't match the expected file, so nothing was installed. Try again.", canInstall: true },
    });
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === 'uv install failed');
    expect(logged).toMatchObject({ code: 'hash_mismatch', target: 'x86_64-unknown-linux-gnu', expected: 'a'.repeat(64), actual: 'b'.repeat(64) });
  });
});
