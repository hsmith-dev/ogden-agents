/**
 * The remote-machine registry (CAP-24, epic 18 story 18.1): install-level
 * state, add/list/rename/remove, no credential field, and one event per
 * change that never carries the host, username or label. No test reaches
 * a keychain or the network — story 18.2 adds the real SSH connection.
 */
import { MAX_REMOTE_MACHINES } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError, type SecretStorePort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

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
  return { core, secrets, machines: core.remoteMachines(secrets), dataDir };
};

describe('adding a machine', () => {
  it('stores it with no credential, a generated id, host-key fields unset, and appends one event with none of its details in it', () => {
    const { core, machines } = setUp();
    const before = core.events.lastSeq();
    const added = machines.add({ host: 'bench.local', port: 22, username: 'ada', label: 'Build bench' });
    expect(added).toMatchObject({ host: 'bench.local', port: 22, username: 'ada', label: 'Build bench', hostKeyFingerprint: null, publicKey: null, hostKeyConfirmed: false });
    expect(added.id).toMatch(/^mach_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(added).not.toHaveProperty('privateKey');
    expect(added).not.toHaveProperty('passphrase');
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'settings.remote_machines_changed', workspaceId: null, payload: { machineId: added.id, change: 'added' } })]);
    // The event payload is only the id and the change, nothing that could leak the host, user or label.
    expect(JSON.stringify(core.events.readAfter(before))).not.toContain('bench.local');
    expect(JSON.stringify(core.events.readAfter(before))).not.toContain('Build bench');
    expect(machines.list()).toEqual([added]);
  });

  it('defaults the port to 22 when none is given', () => {
    const { machines } = setUp();
    const added = machines.add({ host: 'box', username: 'u', label: 'Box' });
    expect(added.port).toBe(22);
  });

  it('refuses bad input in plain words, and adds nothing', () => {
    const { machines } = setUp();
    for (const bad of [
      { host: '', username: 'u', label: 'L' },
      { host: 'h', username: '', label: 'L' },
      { host: 'h', username: 'u', label: '' },
      { host: 'has spaces', username: 'u', label: 'L' },
      { host: 'h', username: 'has spaces', label: 'L' },
      { host: 'h', username: 'u', label: 'L', port: 0 },
      { host: 'h', username: 'u', label: 'L', port: 70000 },
      { host: 'http://h', username: 'u', label: 'L' },
    ]) {
      expect(() => machines.add(bad), JSON.stringify(bad)).toThrow(ValidationError);
    }
    expect(machines.list()).toEqual([]);
  });

  it('refuses a stray credential-shaped field rather than silently dropping it (`.strict()`)', () => {
    const { machines } = setUp();
    expect(() => machines.add({ host: 'h', username: 'u', label: 'L', privateKey: 'nope' })).toThrow(ValidationError);
  });

  it('refuses once the limit is reached', () => {
    const { machines } = setUp();
    for (let i = 0; i < MAX_REMOTE_MACHINES; i++) machines.add({ host: `h${i}`, username: 'u', label: `L${i}` });
    expect(() => machines.add({ host: 'one-too-many', username: 'u', label: 'L' })).toThrow(ValidationError);
    expect(machines.list()).toHaveLength(MAX_REMOTE_MACHINES);
  });
});

describe('listing and getting', () => {
  it('lists every machine, oldest first', () => {
    const { machines } = setUp();
    const first = machines.add({ host: 'a', username: 'u', label: 'A' });
    const second = machines.add({ host: 'b', username: 'u', label: 'B' });
    expect(machines.list().map((m) => m.id)).toEqual([first.id, second.id]);
  });

  it('gets one machine by id, and throws NotFoundError for no such id', () => {
    const { machines } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    expect(machines.get(added.id)).toEqual(added);
    expect(() => machines.get('mach_00000000000000000000000000')).toThrow(NotFoundError);
  });
});

describe('renaming a machine', () => {
  it('changes only the label, and appends a renamed event with no label in it', () => {
    const { core, machines } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'Old name' });
    const before = core.events.lastSeq();
    const renamed = machines.rename(added.id, { label: 'New name' });
    expect(renamed).toMatchObject({ ...added, label: 'New name' });
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'settings.remote_machines_changed', payload: { machineId: added.id, change: 'renamed' } })]);
    expect(JSON.stringify(core.events.readAfter(before))).not.toContain('New name');
  });

  it('refuses an empty label, and throws NotFoundError for no such machine', () => {
    const { machines } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    expect(() => machines.rename(added.id, { label: '' })).toThrow(ValidationError);
    expect(() => machines.rename('mach_00000000000000000000000000', { label: 'X' })).toThrow(NotFoundError);
  });
});

describe('removing a machine', () => {
  it('removes the record and appends a removed event', async () => {
    const { core, machines } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    await machines.remove(added.id);
    expect(machines.list()).toEqual([]);
    expect(core.events.readAfter(0).at(-1)).toMatchObject({ type: 'settings.remote_machines_changed', payload: { machineId: added.id, change: 'removed' } });
  });

  it('cleans up any stored credential under this machine’s keychain name, even though story 18.1 never stores one', async () => {
    const { machines, secrets } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    await secrets.set(`remote-machine-ssh/${added.id}`, 'pretend-private-key');
    await machines.remove(added.id);
    expect(await secrets.get(`remote-machine-ssh/${added.id}`)).toBeUndefined();
  });

  it('throws NotFoundError for no such machine, and removing is a no-op on the keychain otherwise', async () => {
    const { machines } = setUp();
    await expect(machines.remove('mach_00000000000000000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});
