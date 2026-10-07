/**
 * Generic developer CLI tools' routes (CAP-25, story: generic developer CLI
 * tools detect, install, and sandbox-gate): the install-wide catalog, a
 * confirmed real install (and its refusal/failure), naming a custom tool,
 * and a project's unattended-build allowlist, all behind the gate (AD-15).
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevToolDescriptor, DevToolDetection, DevToolRunResult, DevToolsPort } from '@ogden-agents/core';
import { API_ROUTES, DevToolsAllowlistResponse, DevToolsResponse, DevToolStatus, WorkspaceResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer } from './helpers.js';

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempRepo(): string {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-dev-tools-repo-')));
  repos.push(repo);
  return repo;
}

/** A seed catalog of one tool the test drives by hand: never execs to detect, never runs without `{confirm: true}`. */
function stubDevTools(seed: DevToolDescriptor[] = [{ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', executables: ['gcloud'], installCommand: 'install gcloud' }]) {
  const installedAt = new Map<string, string>();
  let runs = 0;
  let answer: DevToolRunResult = { ok: true };
  const port: DevToolsPort = {
    seedCatalog: () => seed,
    detect: async (tool): Promise<DevToolDetection> => {
      const path = installedAt.get(tool.id);
      return path === undefined ? { installed: false } : { installed: true, path };
    },
    run: async () => {
      runs++;
      return answer;
    },
  };
  return { port, markInstalled: (id: string, path: string) => installedAt.set(id, path), runs: () => runs, setAnswer: (next: DevToolRunResult) => (answer = next) };
}

describe('generic developer CLI tools routes', () => {
  it('report the catalog to a connected tab, and nothing without a token', async () => {
    const server = await startTestServer({ devToolsPort: stubDevTools().port });
    expect((await fetch(`${server.url}${API_ROUTES.devTools}`)).status).toBe(401);
    const { headers } = await signIn(server);
    const response = await fetch(`${server.url}${API_ROUTES.devTools}`, { headers });
    expect(response.status).toBe(200);
    expect(DevToolsResponse.parse(await response.json())).toEqual({ tools: [{ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', installed: false, installCommand: 'install gcloud' }] });
  });

  it('install runs the real command only on confirm, refused for a bad Origin, and nothing runs twice for one decline', async () => {
    const stub = stubDevTools();
    const server = await startTestServer({ devToolsPort: stub.port });
    const { token, headers } = await signIn(server);
    const authorization = `Bearer ${token}`;
    // No confirmation: 400, nothing runs.
    const unconfirmed = await fetch(`${server.url}${API_ROUTES.devTools}/gcloud/install`, { method: 'POST', headers, body: '{}' });
    expect(unconfirmed.status).toBe(400);
    expect(stub.runs()).toBe(0);
    // A bad Origin: 403, nothing runs.
    const badOrigin = await fetch(`${server.url}${API_ROUTES.devTools}/gcloud/install`, { method: 'POST', headers: { authorization, origin: 'http://evil.example' }, body: JSON.stringify({ confirm: true }) });
    expect(badOrigin.status).toBe(403);
    expect(stub.runs()).toBe(0);
    // Confirmed, through the real gate: runs once, and the tool is then reported installed.
    stub.markInstalled('gcloud', '/usr/local/bin/gcloud');
    const response = await fetch(`${server.url}${API_ROUTES.devTools}/gcloud/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
    expect(response.status).toBe(200);
    expect(DevToolStatus.parse(await response.json())).toEqual({ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', installed: true, installCommand: 'install gcloud' });
    expect(stub.runs()).toBe(1);
  });

  it('a failed real install leaves the tool not installed with a plain reason (409), never retried by itself', async () => {
    const stub = stubDevTools();
    stub.setAnswer({ ok: false, reason: 'brew: command not found' });
    const server = await startTestServer({ devToolsPort: stub.port });
    const { headers } = await signIn(server);
    const response = await fetch(`${server.url}${API_ROUTES.devTools}/gcloud/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
    expect(response.status).toBe(409);
    expect((await response.json()) as { error: { code: string; message: string } }).toMatchObject({ error: { code: 'install_failed', message: 'brew: command not found' } });
    expect(stub.runs()).toBe(1);
    const status = await fetch(`${server.url}${API_ROUTES.devTools}`, { headers });
    expect((await status.json()) as { tools: Array<{ installed: boolean }> }).toMatchObject({ tools: [{ installed: false }] });
  });

  it('names a custom tool generically (not only the seed four), then removes it', async () => {
    const server = await startTestServer({ devToolsPort: stubDevTools().port });
    const { headers } = await signIn(server);
    const added = await fetch(`${server.url}${API_ROUTES.devTools}`, { method: 'POST', headers, body: JSON.stringify({ id: 'terraform', label: 'Terraform', executable: 'terraform', installCommand: 'install terraform' }) });
    expect(added.status).toBe(201);
    const list = await fetch(`${server.url}${API_ROUTES.devTools}`, { headers });
    expect((await list.json() as { tools: Array<{ id: string }> }).tools.map((tool) => tool.id).sort()).toEqual(['gcloud', 'terraform']);
    const removed = await fetch(`${server.url}${API_ROUTES.devTools}/terraform`, { method: 'DELETE', headers });
    expect(removed.status).toBe(204);
    const again = await fetch(`${server.url}${API_ROUTES.devTools}`, { headers });
    expect((await again.json() as { tools: Array<{ id: string }> }).tools.map((tool) => tool.id)).toEqual(['gcloud']);
  });

  it("a project's unattended allowlist is scoped, visible, and revocable", async () => {
    const stub = stubDevTools();
    stub.markInstalled('gcloud', '/usr/local/bin/gcloud');
    const server = await startTestServer({ devToolsPort: stub.port });
    const { headers } = await signIn(server);
    const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: tempRepo() }) });
    const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
    const before = await fetch(`${server.url}/api/v1/workspaces/${wsId}/dev-tools-allowlist`, { headers });
    expect(DevToolsAllowlistResponse.parse(await before.json())).toEqual({ tools: [{ id: 'gcloud', label: 'Google Cloud CLI', installed: true, allowed: false }] });
    const allowed = await fetch(`${server.url}/api/v1/workspaces/${wsId}/dev-tools-allowlist/gcloud`, { method: 'PUT', headers, body: JSON.stringify({ allowed: true }) });
    expect(DevToolsAllowlistResponse.parse(await allowed.json())).toEqual({ tools: [{ id: 'gcloud', label: 'Google Cloud CLI', installed: true, allowed: true }] });
    const revoked = await fetch(`${server.url}/api/v1/workspaces/${wsId}/dev-tools-allowlist/gcloud`, { method: 'PUT', headers, body: JSON.stringify({ allowed: false }) });
    expect(DevToolsAllowlistResponse.parse(await revoked.json())).toEqual({ tools: [{ id: 'gcloud', label: 'Google Cloud CLI', installed: true, allowed: false }] });
  });
});
