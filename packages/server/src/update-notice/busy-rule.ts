/**
 * The one busy rule (story 13.3, user decision 2026-10-04): the server may not
 * restart for an app update while an agent turn or a build is running. Today it
 * counts busy sessions (AD-20). Epic 5 registers running runs as another source
 * through `register`; epic 13 does not wait on it.
 */

export interface Busy {
  /** True when anything is working. */
  busy: boolean;
  /** Sessions working (the AD-20 count). */
  busySessions: number;
  /** Everything working: sessions plus every registered source (running builds, once epic 5 adds them). */
  total: number;
}

export interface BusyRule {
  /** The rule now. */
  (): Busy;
  /** Adds a count of other running work (a build's runs). Returns a function that removes it. */
  register(source: () => number): () => void;
}

/** `sessions` is `countBusySessions(core)`. */
export function createBusyRule(sessions: () => number): BusyRule {
  const sources = new Set<() => number>();
  const rule = (() => {
    const busySessions = sessions();
    let total = busySessions;
    for (const source of sources) total += Math.max(0, source());
    return { busy: total > 0, busySessions, total };
  }) as BusyRule;
  rule.register = (source) => {
    sources.add(source);
    return () => void sources.delete(source);
  };
  return rule;
}
