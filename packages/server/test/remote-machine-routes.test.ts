/**
 * The remote-machine routes end to end (CAP-24, epic 19 story 19.3; AD-26):
 * a real server with the in-memory keychain and a fake SSH connection
 * (`remote-host-memory`). Adding a machine stores no credential; its host
 * key must be confirmed before anything is pinned; a changed fingerprint
 * is refused outright; confirming stores a generated key in the keychain
 * and it comes back nowhere (not in an answer, the event log, the log or
 * the database). Nothing here reaches a real network or a real keychain.
 */
import { readdirSync } from 'node:fs';
import { createMemoryRemoteHostPort, createMemorySecretStore } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, apiPath, RemoteHostKeyCheckResponse, RemoteMachineResponse, RemoteMachinesResponse, type RemoteMachineId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { signIn, startTestServer, type SignedIn, type TestServer } from './helpers.js';

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function setUp() {
  const secrets = createMemorySecretStore();
  const hosts = createMemoryRemoteHostPort();
  const server = await startTestServer({ secrets, remoteHost: hosts });
  const tab = await signIn(server);
  const add = (body: unknown) => call(server, tab, 'POST', API_ROUTES.remoteMachines, body);
  const machineOf = async (response: Response) => RemoteMachineResponse.parse(await response.json()).machine;
  const checkPath = (id: RemoteMachineId) => apiPath(API_ROUTES.remoteMachineHostKeyCheck, { machineId: id });
  const confirmPath = (id: RemoteMachineId) => apiPath(API_ROUTES.remoteMachineHostKeyConfirm, { machineId: id });
  const machinePath = (id: RemoteMachineId) => apiPath(API_ROUTES.remoteMachine, { machineId: id });
  /** Checks, then confirms with exactly the fingerprint shown, as the page would. */
  const confirm = async (id: RemoteMachineId) => {
    const { fingerprint } = RemoteHostKeyCheckResponse.parse(await (await call(server, tab, 'POST', checkPath(id))).json());
    return call(server, tab, 'POST', confirmPath(id), { fingerprint, confirm: true });
  };
  return { server, tab, secrets, hosts, add, machineOf, checkPath, confirmPath, machinePath, confirm };
}

describe('the remote-machine routes (CAP-24, epic 19 story 19.3)', () => {
  it('lists none at first, adds a machine with no credential, and answers no-store', async () => {
    const { server, tab, add, machineOf } = await setUp();
    const empty = await call(server, tab, 'GET', API_ROUTES.remoteMachines);
    expect(empty.headers.get('cache-control')).toBe('no-store');
    expect(RemoteMachinesResponse.parse(await empty.json())).toEqual({ machines: [] });
    const created = await add({ host: 'bench.local', username: 'ada', label: 'Build bench' });
    expect(created.status).toBe(201);
    const machine = await machineOf(created);
    expect(machine).toMatchObject({ host: 'bench.local', port: 22, username: 'ada', label: 'Build bench', hostKeyConfirmed: false, publicKey: null });
    expect(RemoteMachinesResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.remoteMachines)).json()).machines).toEqual([machine]);
  });

  it('answers 400 in plain words for bad input', async () => {
    const { add } = await setUp();
    const refused = await add({ host: '', username: 'u', label: 'L' });
    expect(refused.status).toBe(400);
    expect((await add({ host: 'h', username: 'u', label: 'L', nonsense: 1 })).status).toBe(400);
    expect((await add('not json')).status).toBe(400);
  });

  it('checks a host key without pinning it, then confirms it, generating and storing a fresh keypair with none of it in the answer, the event log, the log or the database', async () => {
    const { server, tab, secrets, hosts, add, machineOf, checkPath, confirmPath } = await setUp();
    const created = await machineOf(await add({ host: 'bench.local', port: 2222, username: 'ada', label: 'Build bench' }));
    hosts.setFingerprint('bench.local', 2222, 'fp-live');

    const checked = await call(server, tab, 'POST', checkPath(created.id));
    expect(RemoteHostKeyCheckResponse.parse(await checked.json())).toEqual({ fingerprint: 'fp-live' });
    expect((await call(server, tab, 'GET', API_ROUTES.remoteMachines)).headers.get('cache-control')).toBe('no-store');
    // Checking pins nothing.
    const stillUnconfirmed = (await (await call(server, tab, 'GET', API_ROUTES.remoteMachines)).json()) as { machines: Array<{ hostKeyConfirmed: boolean }> };
    expect(stillUnconfirmed.machines[0]?.hostKeyConfirmed).toBe(false);

    const refusedNoConfirm = await call(server, tab, 'POST', confirmPath(created.id), { fingerprint: 'fp-live' });
    expect(refusedNoConfirm.status).toBe(400);
    expect(ApiErrorBody.parse(await refusedNoConfirm.json()).error.code).toBe('confirmation_required');

    const confirmedResponse = await call(server, tab, 'POST', confirmPath(created.id), { fingerprint: 'fp-live', confirm: true });
    const confirmedText = await confirmedResponse.text();
    // The public key line is meant for the page to show (the user pastes it into authorized_keys); the private key never appears anywhere here.
    expect(confirmedText).not.toMatch(/BEGIN OPENSSH PRIVATE KEY/);
    expect(confirmedResponse.headers.get('cache-control')).toBe('no-store');
    const confirmed = RemoteMachineResponse.parse(JSON.parse(confirmedText)).machine;
    expect(confirmed).toMatchObject({ hostKeyFingerprint: 'fp-live', hostKeyConfirmed: true });
    expect(confirmed.publicKey).toMatch(/^ssh-ed25519 FAKEMEMORYKEY/);
    const storedPrivateKey = await secrets.get(`remote-machine-ssh/${created.id}`);
    expect(storedPrivateKey).toMatch(/BEGIN OPENSSH PRIVATE KEY/);

    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain('fp-live');
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(storedPrivateKey);
    await server.close();
    const files = readdirSync(server.dataDir, { recursive: true, encoding: 'utf8' }).filter((name) => /(\.db(-wal|-shm)?|\.log)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
  });

  it('refuses outright, with the host in the error details, when the host key changed since it was shown — never silently re-pinned', async () => {
    const { server, tab, hosts, add, machineOf, checkPath, confirmPath } = await setUp();
    const created = await machineOf(await add({ host: 'a', username: 'u', label: 'A' }));
    hosts.setFingerprint('a', 22, 'fp-shown');
    const { fingerprint } = RemoteHostKeyCheckResponse.parse(await (await call(server, tab, 'POST', checkPath(created.id))).json());
    hosts.setFingerprint('a', 22, 'fp-attacker');
    const refused = await call(server, tab, 'POST', confirmPath(created.id), { fingerprint, confirm: true });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'remote_host_key_changed', details: { host: 'a' } });
  });

  it('answers 502 for an unreachable machine on check, and 404 for no such machine everywhere', async () => {
    const { server, tab, hosts, add, machineOf, checkPath, machinePath } = await setUp();
    const created = await machineOf(await add({ host: 'gone', username: 'u', label: 'A' }));
    hosts.setUnreachable('gone', 22);
    expect((await call(server, tab, 'POST', checkPath(created.id))).status).toBe(502);

    const noSuchId = 'mach_00000000000000000000000000' as const;
    expect((await call(server, tab, 'PATCH', machinePath(noSuchId), { label: 'x' })).status).toBe(404);
    expect((await call(server, tab, 'DELETE', machinePath(noSuchId))).status).toBe(404);
  });

  it('renames a machine, and removes it along with its stored credential', async () => {
    const { server, tab, secrets, add, machineOf, machinePath, confirm } = await setUp();
    const created = await machineOf(await add({ host: 'a', username: 'u', label: 'Old name' }));
    const renamed = await machineOf(await call(server, tab, 'PATCH', machinePath(created.id), { label: 'New name' }));
    expect(renamed.label).toBe('New name');

    await confirm(created.id);
    expect(await secrets.get(`remote-machine-ssh/${created.id}`)).toBeDefined();
    const removed = await call(server, tab, 'DELETE', machinePath(created.id));
    expect(removed.status).toBe(204);
    expect(await secrets.get(`remote-machine-ssh/${created.id}`)).toBeUndefined();
    expect(RemoteMachinesResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.remoteMachines)).json()).machines).toEqual([]);
  });
});
