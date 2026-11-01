/**
 * `port-probe-memory` (CAP-35; epic 27 entry 2): an in-memory
 * `PortProbePort` for tests and the ports lane (27.7 builds the real probe
 * on `127.0.0.1`). It never touches the network: every port is free unless
 * a test marks it taken (`taken`). Each probe is recorded.
 */
import type { PortProbePort } from '@ogden-agents/core';

export interface MemoryPortProbe extends PortProbePort {
  /** Ports that answer not free. */
  readonly taken: Set<number>;
  /** Every port probed, in order. */
  readonly probed: number[];
}

export function createMemoryPortProbe(): MemoryPortProbe {
  const taken = new Set<number>();
  const probed: number[] = [];
  return {
    taken,
    probed,
    async isFree(port) {
      probed.push(port);
      return !taken.has(port);
    },
  };
}
