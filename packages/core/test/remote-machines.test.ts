/**
 * The remote-machine registry (CAP-24, epic 19 stories 19.1-19.2):
 * install-level state, add/list/rename/remove, host-key confirm-and-pin
 * (AD-26), no credential field ever on the row, and one event per change
 * that never carries the host, username, label, fingerprint or key. No
 * test reaches a real keychain or a real network: `memoryHosts()` below
 * stands in for `RemoteHostPort`.
 */
import { MAX_REMOTE_MACHINES, type RemoteMachine } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { ConfirmationRequiredError, NotFoundError, RemoteHostError, ValidationError, type RemoteHostPort, type SecretStorePort } from '../src/index.js';
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

/** A tiny in-process fake, matching this file's own `memorySecrets` convention: no network, deterministic, test-settable. */
function memoryHosts(): RemoteHostPort & { fingerprints: Map<string, string>; unreachable: Set<string>; calls: string[] } {
  const fingerprints = new Map<string, string>();
  const unreachable = new Set<string>();
  const calls: string[] = [];
  const key = (host: string, port: number) => `${host}:${port}`;
  let n = 0;
  return {
    fingerprints,
    unreachable,
    calls,
    generateKeypair({ comment }) {
      n += 1;
      calls.push(`generateKeypair ${comment}`);
      return { privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\nfake-${n}\n-----END OPENSSH PRIVATE KEY-----\n`, publicKeyLine: `ssh-ed25519 FAKE${n} ${comment}` }; // secret-scan:allow: an obviously-fake, in-memory test double
    },
    async checkHostKey(target) {
      const k = key(target.host, target.port);
      calls.push(`checkHostKey ${k}`);
      if (unreachable.has(k)) throw new RemoteHostError(`Could not reach ${target.host}:${target.port}.`, { host: target.host }, 'host_unreachable');
      return { fingerprint: fingerprints.get(k) ?? `fake-fp-${k}` };
    },
  };
}

const setUp = (secrets: SecretStorePort = memorySecrets(), hosts = memoryHosts()) => {
  const dataDir = tempDir();
  const core = openTestCore(dataDir);
  return { core, secrets, hosts, machines: core.remoteMachines(secrets, hosts), dataDir };
};

/** Confirms `id` against `hosts`' current fingerprint for it, as the UI would: check, then confirm with exactly that value. */
async function confirm(machines: ReturnType<typeof setUp>['machines'], hosts: ReturnType<typeof memoryHosts>, id: string): Promise<RemoteMachine> {
  const { fingerprint } = await machines.checkHostKey(id as never);
  void hosts;
  return machines.confirmHostKey(id as never, { fingerprint, confirm: true });
}

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

  it('cleans up any stored credential under this machine’s keychain name', async () => {
    const { machines, secrets, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    await confirm(machines, hosts, added.id);
    expect(await secrets.get(`remote-machine-ssh/${added.id}`)).toBeDefined();
    await machines.remove(added.id);
    expect(await secrets.get(`remote-machine-ssh/${added.id}`)).toBeUndefined();
  });

  it('throws NotFoundError for no such machine', async () => {
    const { machines } = setUp();
    await expect(machines.remove('mach_00000000000000000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('checking a host key', () => {
  it('reads the live fingerprint without pinning or confirming anything', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    hosts.fingerprints.set('a:22', 'fp-1');
    const check = await machines.checkHostKey(added.id);
    expect(check).toEqual({ fingerprint: 'fp-1' });
    expect(machines.get(added.id)).toMatchObject({ hostKeyFingerprint: null, hostKeyConfirmed: false, publicKey: null });
  });

  it('propagates RemoteHostError for an unreachable machine, in plain words, and pins nothing', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'gone', username: 'u', label: 'A' });
    hosts.unreachable.add('gone:22');
    await expect(machines.checkHostKey(added.id)).rejects.toBeInstanceOf(RemoteHostError);
    expect(machines.get(added.id).hostKeyConfirmed).toBe(false);
  });
});

describe('confirming a host key (AD-26)', () => {
  it('refuses without an explicit confirm, and changes nothing', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    const { fingerprint } = await machines.checkHostKey(added.id);
    await expect(machines.confirmHostKey(added.id, { fingerprint })).rejects.toBeInstanceOf(ConfirmationRequiredError);
    await expect(machines.confirmHostKey(added.id, { fingerprint, confirm: false })).rejects.toBeInstanceOf(ConfirmationRequiredError);
    expect(machines.get(added.id).hostKeyConfirmed).toBe(false);
    expect(hosts.calls.some((call) => call.startsWith('generateKeypair'))).toBe(false);
  });

  it('on first confirm, generates and stores a fresh keypair, pins the fingerprint, marks it confirmed, and appends one event with none of that in it', async () => {
    const { core, machines, secrets, hosts } = setUp();
    const added = machines.add({ host: 'bench.local', port: 2222, username: 'ada', label: 'Build bench' });
    hosts.fingerprints.set('bench.local:2222', 'fp-live');
    const before = core.events.lastSeq();
    const confirmed = await confirm(machines, hosts, added.id);
    expect(confirmed).toMatchObject({ hostKeyFingerprint: 'fp-live', hostKeyConfirmed: true });
    expect(confirmed.publicKey).toMatch(/^ssh-ed25519 FAKE\d+ ogden-agents:mach_/);
    const stored = await secrets.get('remote-machine-ssh/' + added.id);
    expect(stored).toMatch(/BEGIN OPENSSH PRIVATE KEY/);
    const events = core.events.readAfter(before);
    expect(events).toEqual([expect.objectContaining({ type: 'settings.remote_machines_changed', payload: { machineId: added.id, change: 'host_key_confirmed' } })]);
    expect(JSON.stringify(events)).not.toContain('fp-live');
    expect(JSON.stringify(events)).not.toContain('FAKE');
  });

  it('refuses when the live fingerprint no longer matches what was shown, and pins nothing', async () => {
    const { machines, hosts, secrets } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    hosts.fingerprints.set('a:22', 'fp-shown');
    const { fingerprint } = await machines.checkHostKey(added.id);
    hosts.fingerprints.set('a:22', 'fp-changed'); // the key changed between showing it and confirming
    await expect(machines.confirmHostKey(added.id, { fingerprint, confirm: true })).rejects.toBeInstanceOf(RemoteHostError);
    expect(machines.get(added.id)).toMatchObject({ hostKeyFingerprint: null, hostKeyConfirmed: false });
    expect(await secrets.get('remote-machine-ssh/' + added.id)).toBeUndefined();
  });

  it('a later confirm on an already-pinned, unchanged machine is a harmless no-op', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    hosts.fingerprints.set('a:22', 'fp-1');
    const first = await confirm(machines, hosts, added.id);
    const { fingerprint } = await machines.checkHostKey(added.id);
    const second = await machines.confirmHostKey(added.id, { fingerprint, confirm: true });
    expect(second).toEqual(first);
  });

  it('refuses outright, never silently re-pinning, when an already-confirmed machine’s host key has changed', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    hosts.fingerprints.set('a:22', 'fp-1');
    const confirmed = await confirm(machines, hosts, added.id);
    hosts.fingerprints.set('a:22', 'fp-attacker');
    await expect(machines.confirmHostKey(added.id, { fingerprint: 'fp-attacker', confirm: true })).rejects.toBeInstanceOf(RemoteHostError);
    // Still pinned to the original fingerprint: never silently replaced.
    expect(machines.get(added.id)).toMatchObject({ hostKeyFingerprint: confirmed.hostKeyFingerprint, publicKey: confirmed.publicKey });
  });

  it('throws NotFoundError for no such machine', async () => {
    const { machines } = setUp();
    await expect(machines.confirmHostKey('mach_00000000000000000000000000', { fingerprint: 'x', confirm: true })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('verifying a pinned host key (what a real connection checks first, stories 19.4/19.5)', () => {
  it('refuses an unconfirmed machine', async () => {
    const { machines } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    await expect(machines.verifyPinnedHostKey(added.id)).rejects.toBeInstanceOf(RemoteHostError);
  });

  it('passes silently for a confirmed, unchanged machine', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    hosts.fingerprints.set('a:22', 'fp-1');
    await confirm(machines, hosts, added.id);
    await expect(machines.verifyPinnedHostKey(added.id)).resolves.toBeUndefined();
  });

  it('refuses outright once the live host key no longer matches the pinned one', async () => {
    const { machines, hosts } = setUp();
    const added = machines.add({ host: 'a', username: 'u', label: 'A' });
    hosts.fingerprints.set('a:22', 'fp-1');
    await confirm(machines, hosts, added.id);
    hosts.fingerprints.set('a:22', 'fp-changed');
    await expect(machines.verifyPinnedHostKey(added.id)).rejects.toBeInstanceOf(RemoteHostError);
  });
});
