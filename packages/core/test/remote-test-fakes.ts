/**
 * The core-side remote-build fakes shared by story 19.4's, 19.5's and this
 * story's (CAP-24, epic 19 story 19.6) own tests: never
 * `@ogden-agents/adapters` (core depends on no adapter, even in a test,
 * `remote-worktree-sync.test.ts`'s own convention), so every test that
 * exercises `remote-worktree-sync.ts` or `BuildCtx.remote` through core
 * alone imports these rather than inventing a second fake transport.
 *
 * - `createFakeRemoteHost(temp)`: `connect`/`exec` over a real local `sh -c`
 *   against a temp folder standing in for "the remote machine" (the same
 *   technique `remote-host-memory`'s own adapter uses), so the shell
 *   commands `remote-worktree-sync.ts` builds actually run. `temp` is the
 *   caller's own tracked-temp-directory helper (removed after the test).
 * - `createFakeMachines()`: a minimal `RemoteMachines` (`get` and
 *   `verifyPinnedHostKey` only, the two methods `remote-worktree-sync.ts`
 *   calls), test settable for "never confirmed" and "host key changed since".
 * - `memorySecrets()`: a `SecretStorePort` in memory.
 */
import { spawn } from 'node:child_process';
import type { RemoteMachine, RemoteMachineId } from '@ogden-agents/shared';
import { newId, RemoteHostError, type RemoteHostChannel, type RemoteHostConnection, type SecretStorePort } from '../src/index.js';

/** A fake standing in for one remote machine's `connect`/`exec`, the minimal shape `remote-worktree-sync.ts` depends on (`SyncHosts`), over a real local `sh -c`. */
export function createFakeRemoteHost(temp: (prefix: string) => string) {
  const calls: string[] = [];
  const homes = new Map<string, string>();
  const dropNext = new Set<string>();
  const connectFingerprints = new Map<string, string>();
  const addressKey = (host: string, port: number) => `${host}:${port}`;
  const homeDirFor = (host: string, port: number): string => {
    const key = addressKey(host, port);
    let dir = homes.get(key);
    if (dir === undefined) {
      dir = temp('ogden-agents-rws-remote-');
      homes.set(key, dir);
    }
    return dir;
  };
  return {
    calls,
    homeDirFor,
    setConnectionLost(host: string, port: number): void {
      dropNext.add(addressKey(host, port));
    },
    /** Simulates an on-path attacker intercepting only the real `connect` (never the earlier `verifyPinnedHostKey` probe, which this fake has nothing to do with): the live key this exact connection sees from now on differs from whatever the caller pins. */
    setConnectFingerprint(host: string, port: number, fingerprint: string): void {
      connectFingerprints.set(addressKey(host, port), fingerprint);
    },
    async connect(target: { host: string; port: number; username: string }, _credential: { privateKey: string }, expectedFingerprint: string): Promise<RemoteHostConnection> {
      const key = addressKey(target.host, target.port);
      calls.push(`connect ${key}`);
      const live = connectFingerprints.get(key) ?? expectedFingerprint;
      if (live !== expectedFingerprint) {
        throw new RemoteHostError(`${target.host}'s host key has changed since it was confirmed.`, { host: target.host }, 'host_key_changed');
      }
      const home = homeDirFor(target.host, target.port);
      return {
        exec(command: string): Promise<RemoteHostChannel> {
          calls.push(`exec ${key} ${command}`);
          const dropped = dropNext.delete(key);
          const child = spawn('sh', ['-c', command], { cwd: home, env: { PATH: process.env.PATH ?? '' }, stdio: ['pipe', 'pipe', 'pipe'] });
          let settled = false;
          let resolveExit!: (code: number) => void;
          let rejectExit!: (error: unknown) => void;
          const exitCode = new Promise<number>((resolve, reject) => {
            resolveExit = resolve;
            rejectExit = reject;
          });
          const finish = (run: () => void): void => {
            if (settled) return;
            settled = true;
            run();
          };
          child.stdin.on('error', () => undefined);
          child.on('error', (error) => finish(() => rejectExit(error)));
          child.on('close', (code) => {
            if (dropped) finish(() => rejectExit(new RemoteHostError('The connection to the machine was lost.', {}, 'connection_lost')));
            else finish(() => resolveExit(code ?? 1));
          });
          if (dropped) child.kill('SIGKILL');
          return Promise.resolve({
            stdin: child.stdin,
            stdout: child.stdout,
            stderr: child.stderr,
            exitCode,
            kill: () => {
              try {
                child.kill();
              } catch {
                /* best-effort */
              }
            },
          });
        },
        async close() {
          /* Each `exec` spawns its own short-lived child; nothing is held open. */
        },
      };
    },
  };
}

interface FakeMachineState {
  id: RemoteMachineId;
  host: string;
  port: number;
  username: string;
  confirmed: boolean;
  pinnedFingerprint: string;
  liveFingerprint: string;
}

/** A minimal `RemoteMachines` (`get`/`verifyPinnedHostKey` only): test-settable for "never confirmed" and "host key changed since". */
export function createFakeMachines() {
  const machines = new Map<RemoteMachineId, FakeMachineState>();
  return {
    add(input: { host: string; port: number; username: string; confirmed?: boolean }): RemoteMachineId {
      const id = newId('mach');
      machines.set(id, { id, host: input.host, port: input.port, username: input.username, confirmed: input.confirmed ?? true, pinnedFingerprint: 'fp', liveFingerprint: 'fp' });
      return id;
    },
    setHostKeyChanged(id: RemoteMachineId): void {
      machines.get(id)!.liveFingerprint = 'a-different-fp';
    },
    get(id: RemoteMachineId): RemoteMachine {
      const machine = machines.get(id);
      if (machine === undefined) throw new Error(`no such fake machine: ${id}`);
      return {
        id: machine.id,
        host: machine.host,
        port: machine.port,
        username: machine.username,
        label: 'Test machine',
        hostKeyFingerprint: machine.pinnedFingerprint,
        publicKey: 'ssh-ed25519 FAKE test', // secret-scan:allow: an obviously-fake, in-memory test double
        hostKeyConfirmed: machine.confirmed,
        createdAt: new Date(0).toISOString(),
      };
    },
    async verifyPinnedHostKey(id: RemoteMachineId): Promise<void> {
      const machine = machines.get(id);
      if (machine === undefined) throw new Error(`no such fake machine: ${id}`);
      if (!machine.confirmed) throw new RemoteHostError(`Confirm ${machine.host}'s host key before using it.`, { host: machine.host }, 'host_key_not_confirmed');
      if (machine.liveFingerprint !== machine.pinnedFingerprint) {
        throw new RemoteHostError(`${machine.host}'s host key has changed since it was confirmed.`, { host: machine.host }, 'host_key_changed');
      }
    },
  };
}

export function memorySecrets(): SecretStorePort {
  const values = new Map<string, string>();
  return {
    backend: 'memory',
    get: async (name) => values.get(name),
    set: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}
