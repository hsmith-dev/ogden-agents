import type { RemoteMachine } from '@ogden-agents/shared';
import { useEffect, useRef, useState } from 'react';
import { checkRemoteMachineHostKey } from './remote-machines-api';

/**
 * The live check of each confirmed machine (CAP-24, epic 19 story 19.7;
 * shared with the Location chip in 27.5): the server probes its host key
 * (`checkRemoteMachineHostKey`) when a menu that lists machines opens; the
 * page itself never opens a connection. An answer is trusted briefly, so
 * reopening the menu right after doesn't probe every machine again.
 */

/** Said for a confirmed machine the live probe couldn't reach at all. */
export const MACHINE_UNREACHABLE_REASON = "This machine can't be reached right now. Check it in Settings → Remote machines.";
/** Said for a confirmed machine whose live host key no longer matches the one pinned (defense in depth: the chat or build itself also refuses it, server-side). */
export const MACHINE_HOST_KEY_CHANGED_REASON = "This machine's host key has changed since it was confirmed. Remove and re-add it in Settings → Remote machines if you trust this is expected.";

/** How long a live host-key probe is trusted before a menu asks again. */
const PROBE_CACHE_MS = 30_000;

/** What the live probe said of a machine: it answered with the pinned key, it couldn't be reached, or its key changed. */
export type MachineState = 'connected' | 'unreachable' | 'host_key_changed';

export interface MachineCheck {
  checkedAt: number;
  state: MachineState;
}

/**
 * Probes every confirmed machine not checked in the last 30 s, once `open`
 * turns true (and `enabled`), and returns what each answered by machine id;
 * a machine not yet answered is absent.
 */
export function useMachineChecks(open: boolean, confirmed: readonly RemoteMachine[], enabled = true): Readonly<Record<string, MachineCheck>> {
  const [checks, setChecks] = useState<Record<string, MachineCheck>>({});
  const probing = useRef(false);

  useEffect(() => {
    if (!open || !enabled || confirmed.length === 0 || probing.current) return;
    const now = Date.now();
    const stale = confirmed.filter((machine) => (checks[machine.id]?.checkedAt ?? 0) < now - PROBE_CACHE_MS);
    if (stale.length === 0) return;
    probing.current = true;
    void Promise.all(
      stale.map(async (machine) => {
        try {
          const live = await checkRemoteMachineHostKey(machine.id);
          const state: MachineState = live.fingerprint !== machine.hostKeyFingerprint ? 'host_key_changed' : 'connected';
          return [machine.id, { checkedAt: Date.now(), state }] as const;
        } catch {
          return [machine.id, { checkedAt: Date.now(), state: 'unreachable' as const }] as const;
        }
      }),
    ).then((results) => {
      probing.current = false;
      setChecks((before) => ({ ...before, ...Object.fromEntries(results) }));
    });
    // `checks` is read, not a dependency: re-running whenever it changes would loop with the update above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enabled, confirmed]);

  return checks;
}
