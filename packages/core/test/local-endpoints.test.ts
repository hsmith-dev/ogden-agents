/**
 * The Local model's endpoints (epic 14 story 14.3): stored without their keys
 * (the keychain holds them under `agent-endpoint-key/<id>`), a host that is not
 * this computer refused until the user's confirmation is recorded and bound to
 * the host, a changed host asking again, and one event per change that never
 * carries an address or a key. No test reaches a keychain or the network.
 */
import { endpointKeyName } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { EndpointConfirmationRequiredError, NotFoundError, SecretsUnavailableError, ValidationError, type SecretStorePort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const KEY = 'sk-test-dummy-key-0b7e55';

function memorySecrets(initial: Record<string, string> = {}): SecretStorePort & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    backend: 'memory',
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

const setUp = (secrets: SecretStorePort = memorySecrets()) => {
  const dataDir = tempDir();
  const core = openTestCore(dataDir);
  return { core, secrets, endpoints: core.localEndpoints(secrets), dataDir };
};

const everything = (core: ReturnType<typeof openTestCore>) => JSON.stringify(core.events.readAfter(0));

describe('adding an endpoint', () => {
  it('stores a loopback server with no confirmation, no key and the cleaned address, and appends one event with no address in it', async () => {
    const { core, endpoints } = setUp();
    const before = core.events.lastSeq();
    const added = await endpoints.add({ label: 'My Mac', baseUrl: 'HTTP://Localhost:1234/v1/' });
    expect(added).toMatchObject({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1', auth: 'none', loopback: true, needsConfirmation: false, insecureRemote: false, keySaved: false, remoteConfirmedFor: null, model: null, preset: null });
    expect(added.id).toMatch(/^lep_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'settings.local_endpoints_changed', workspaceId: null, payload: { endpointId: added.id, change: 'added' } })]);
    expect(endpoints.list()).toEqual([added]);
  });

  it('refuses an address that cannot be used, in plain words', async () => {
    const { endpoints } = setUp();
    for (const baseUrl of ['', 'nonsense', 'ftp://localhost/v1', 'http://user:pw@localhost/v1', 'http://localhost/v1?x=1']) {
      await expect(endpoints.add({ label: 'x', baseUrl }), baseUrl).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(endpoints.add({ label: '', baseUrl: 'http://localhost/v1' })).rejects.toBeInstanceOf(ValidationError);
    expect(endpoints.list()).toEqual([]);
  });

  it('refuses another host until its confirmation, naming the host, and records the confirmation bound to it', async () => {
    const { endpoints } = setUp();
    const refused = await endpoints.add({ label: 'Gateway', baseUrl: 'http://192.168.1.20:8000/v1' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(EndpointConfirmationRequiredError);
    expect((refused as EndpointConfirmationRequiredError).message).toContain('192.168.1.20:8000');
    // A confirmation for another host does not count.
    await expect(endpoints.add({ label: 'Gateway', baseUrl: 'http://192.168.1.20:8000/v1', confirmHost: 'evil.example.com' })).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
    expect(endpoints.list()).toEqual([]);
    const added = await endpoints.add({ label: 'Gateway', baseUrl: 'http://192.168.1.20:8000/v1', confirmHost: 'http://192.168.1.20:8000' });
    expect(added).toMatchObject({ loopback: false, needsConfirmation: false, insecureRemote: true, remoteConfirmedFor: 'http://192.168.1.20:8000' });
  });

  it('keeps the key in the keychain under the endpoint id and never in the database or an event', async () => {
    const { core, endpoints, secrets, dataDir } = setUp();
    const added = await endpoints.add({ label: 'Keyed', baseUrl: 'https://api.example.com/v1', confirmHost: 'https://api.example.com', key: KEY });
    expect(added).toMatchObject({ auth: 'key', keySaved: true, insecureRemote: false });
    expect((secrets as ReturnType<typeof memorySecrets>).values.get(endpointKeyName(added.id))).toBe(KEY);
    expect(JSON.stringify(added)).not.toContain(KEY);
    expect(JSON.stringify(endpoints.list())).not.toContain(KEY);
    expect(everything(core)).not.toContain(KEY);
    expect(everything(core)).not.toContain('api.example.com');
    core.close();
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const name of readdirSync(dataDir)) {
      if (!/\.db(-wal|-shm)?$/.test(name)) continue;
      expect(readFileSync(join(dataDir, name)).includes(KEY), name).toBe(false);
    }
  });

  it('refuses to add, with the keychain\'s plain reason, when a key is given and none can hold it, and adds nothing', async () => {
    const broken: SecretStorePort = { backend: 'none', get: async () => undefined, set: async () => { throw new SecretsUnavailableError(); }, delete: async () => undefined };
    const { endpoints } = setUp(broken);
    await expect(endpoints.add({ label: 'x', baseUrl: 'http://localhost/v1', key: KEY })).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(endpoints.list()).toEqual([]);
    // Without a key nothing needs the keychain.
    await expect(endpoints.add({ label: 'x', baseUrl: 'http://localhost/v1' })).resolves.toBeDefined();
  });

  it('keeps at most twenty', async () => {
    const { endpoints } = setUp();
    for (let i = 0; i < 20; i++) await endpoints.add({ label: `s${i}`, baseUrl: `http://localhost:${2000 + i}/v1` });
    await expect(endpoints.add({ label: 'one more', baseUrl: 'http://localhost:3000/v1' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('a changed host asks again', () => {
  it('drops the confirmation when the host changes, keeps it when only the path or name changes, and takes a new one given with the change', async () => {
    const { endpoints } = setUp();
    const added = await endpoints.add({ label: 'Gateway', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    expect(await endpoints.update(added.id, { label: 'Renamed' })).toMatchObject({ needsConfirmation: false });
    expect(await endpoints.update(added.id, { baseUrl: 'https://a.example.com/openai/v1' })).toMatchObject({ needsConfirmation: false, remoteConfirmedFor: 'https://a.example.com' });
    const moved = await endpoints.update(added.id, { baseUrl: 'https://b.example.com/v1' });
    expect(moved).toMatchObject({ needsConfirmation: true, remoteConfirmedFor: null, host: 'https://b.example.com' });
    // A new port is a new host too.
    expect(await endpoints.update(added.id, { baseUrl: 'https://b.example.com:8443/v1', confirmHost: 'https://b.example.com:8443' })).toMatchObject({ needsConfirmation: false });
    expect(await endpoints.update(added.id, { baseUrl: 'https://b.example.com:9443/v1' })).toMatchObject({ needsConfirmation: true });
    // Moving to this computer needs none, and moving back asks again.
    expect(await endpoints.update(added.id, { baseUrl: 'http://localhost:1234/v1' })).toMatchObject({ loopback: true, needsConfirmation: false });
    expect(await endpoints.update(added.id, { baseUrl: 'https://b.example.com/v1' })).toMatchObject({ needsConfirmation: true });
  });

  it('confirms only the host the user was shown, and says there is nothing to confirm on this computer', async () => {
    const { endpoints } = setUp();
    const other = await endpoints.add({ label: 'x', baseUrl: 'http://10.0.0.5:8000/v1', confirmHost: 'http://10.0.0.5:8000' });
    await endpoints.update(other.id, { baseUrl: 'http://10.0.0.6:8000/v1' });
    expect(() => endpoints.confirm(other.id, { host: 'http://10.0.0.5:8000' })).toThrow(EndpointConfirmationRequiredError);
    expect(endpoints.confirm(other.id, { host: 'http://10.0.0.6:8000' })).toMatchObject({ needsConfirmation: false });
    const local = await endpoints.add({ label: 'l', baseUrl: 'http://localhost:1234/v1' });
    expect(() => endpoints.confirm(local.id, { host: 'localhost:1234' })).toThrow(ValidationError);
  });
});

describe('a key belongs to its server', () => {
  it('is dropped, from the keychain too, when the address changes to another scheme, host or port, and kept for a new path or name', async () => {
    const { endpoints, secrets, core } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com', key: KEY });
    expect(await endpoints.update(added.id, { label: 'y', baseUrl: 'https://a.example.com/other/v1' })).toMatchObject({ keySaved: true });
    expect(await secrets.get(endpointKeyName(added.id))).toBe(KEY);
    const moved = await endpoints.update(added.id, { baseUrl: 'http://127.0.0.1:9999/v1' });
    expect(moved).toMatchObject({ keySaved: false, auth: 'none' });
    expect(await secrets.get(endpointKeyName(added.id))).toBeUndefined();
    expect((await endpoints.target(added.id))?.key).toBeUndefined();
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain(KEY);
    // Over http instead of https on the same name is another service too.
    const second = await endpoints.add({ label: 's', baseUrl: 'https://b.example.com/v1', confirmHost: 'https://b.example.com', key: KEY });
    expect(await endpoints.update(second.id, { baseUrl: 'http://b.example.com/v1' })).toMatchObject({ keySaved: false, needsConfirmation: true });
  });

  it('never keeps a confirmation across the scheme', async () => {
    const { endpoints } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    expect(await endpoints.update(added.id, { baseUrl: 'http://a.example.com/v1' })).toMatchObject({ needsConfirmation: true, insecureRemote: true });
  });

  it('refuses a confirmation sent with a change when it does not match the host', async () => {
    const { endpoints } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1/v1' });
    await expect(endpoints.update(added.id, { confirmHost: 'http://localhost:1' })).rejects.toBeInstanceOf(ValidationError);
    const far = await endpoints.add({ label: 'f', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    await expect(endpoints.update(far.id, { confirmHost: 'https://other.example.com' })).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
  });
});

describe('what a chat or a call may reach (target)', () => {
  it('is nothing when none is set up, the default endpoint with its key from the keychain, else the first', async () => {
    const { endpoints } = setUp();
    expect(await endpoints.target()).toBeUndefined();
    const first = await endpoints.add({ label: 'first', baseUrl: 'http://localhost:1/v1' });
    const second = await endpoints.add({ label: 'second', baseUrl: 'https://s.example.com/v1', confirmHost: 'https://s.example.com', key: KEY, model: 'm1' });
    expect((await endpoints.target())?.endpointId).toBe(first.id);
    endpoints.setDefault({ endpointId: second.id });
    expect(endpoints.defaultEndpointId()).toBe(second.id);
    expect(await endpoints.target()).toEqual({ endpointId: second.id, baseUrl: 'https://s.example.com/v1', key: KEY, model: 'm1' });
    expect(await endpoints.target(first.id)).toEqual({ endpointId: first.id, baseUrl: 'http://localhost:1/v1' });
    await expect(endpoints.target('lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an unconfirmed host, so no call can reach it', async () => {
    const { endpoints } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    await endpoints.update(added.id, { baseUrl: 'https://elsewhere.example.com/v1' });
    await expect(endpoints.target(added.id)).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
    await expect(endpoints.target()).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
  });

  it('says so, in words, when a saved key is gone from the keychain', async () => {
    const { endpoints, secrets } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1/v1', key: KEY });
    await secrets.delete(endpointKeyName(added.id));
    await expect(endpoints.target(added.id)).rejects.toThrow(/no longer in your keychain/);
  });
});

describe('keys, defaults and removal', () => {
  it('saves and removes a key with one event each, and never echoes it', async () => {
    const { core, endpoints, secrets } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1/v1' });
    const before = core.events.lastSeq();
    expect(await endpoints.setKey(added.id, { key: KEY })).toMatchObject({ auth: 'key', keySaved: true });
    expect(await secrets.get(endpointKeyName(added.id))).toBe(KEY);
    expect(await endpoints.removeKey(added.id)).toMatchObject({ auth: 'none', keySaved: false });
    expect(await secrets.get(endpointKeyName(added.id))).toBeUndefined();
    expect(core.events.readAfter(before).map((event) => (event as { payload: { change: string } }).payload.change)).toEqual(['key_saved', 'key_removed']);
    expect(everything(core)).not.toContain(KEY);
    await expect(endpoints.setKey(added.id, { key: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes an endpoint with its key and its default mark', async () => {
    const { endpoints, secrets } = setUp();
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1/v1', key: KEY });
    endpoints.setDefault({ endpointId: added.id });
    await endpoints.remove(added.id);
    expect(endpoints.list()).toEqual([]);
    expect(endpoints.defaultEndpointId()).toBeNull();
    expect(await secrets.get(endpointKeyName(added.id))).toBeUndefined();
    await expect(endpoints.remove(added.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('survives a restart: the list, the default and the confirmation are stored, the key is read from the keychain', async () => {
    const dataDir = tempDir();
    const secrets = memorySecrets();
    const first = openTestCore(dataDir);
    const endpoints = first.localEndpoints(secrets);
    const added = await endpoints.add({ label: 'x', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com', key: KEY });
    endpoints.setDefault({ endpointId: added.id });
    first.close();
    const second = openTestCore(dataDir).localEndpoints(secrets);
    expect(second.list()).toEqual([added]);
    expect(second.defaultEndpointId()).toBe(added.id);
    expect((await second.target())?.key).toBe(KEY);
  });
});
