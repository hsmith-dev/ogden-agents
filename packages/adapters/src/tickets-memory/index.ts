/**
 * `tickets-memory` (story 4.2): an in-memory `TicketStorePort` for tests and
 * the epic's lanes (the server wires the real `tickets-v7`). It runs nothing
 * and reads nothing on the computer. Each repo path answers the tree it was
 * given (any other path rejects as `tickets.py` does without an active
 * initiative); `find` answers a row with its entry's text; `mark` changes the
 * row in memory as `tickets.py mark` would change the plan (it refuses
 * `done` unless core's approve asks, AD-10 and story 5.2, and a stale `expectedStatus`
 * with `TicketChangedError`, story 4.10) and tells each watch of the repo;
 * `watch` records its callback until closed, and `emit` fires it as an
 * agent's write would (entry 4.8's watcher).
 */
import { NotFoundError, StatusNotAllowedError, TicketChangedError, TicketsUnavailableError, type TicketStorePort, type TicketsUnavailableReason } from '@ogden-agents/core';
import { TicketRow, TicketsResponse, type TicketDetail, type TicketStatus } from '@ogden-agents/shared';

/** The status a mark leaves, and the state `tickets.py` derives from it. */
const STATE_OF: Readonly<Record<TicketStatus, string>> = {
  draft: 'backlog',
  'ready-for-dev': 'backlog',
  'in-progress': 'in-progress',
  blocked: 'in-progress',
  'in-review': 'review',
  built: 'review',
  done: 'done',
  dropped: 'dropped',
};

/** Extra text `find` answers for a ticket, by ref. */
export type MemoryTicketText = Partial<Pick<TicketDetail, 'description' | 'verify' | 'references' | 'notes' | 'unknown'>>;

export interface MemoryTicketStoreOptions {
  /** Each repo path's tree (rows may leave out story 4.2's defaulted fields). */
  repos?: Readonly<Record<string, { tickets: readonly unknown[]; problems?: readonly string[]; folder?: string | null }>>;
  /** Each ref's entry text, for `find`. */
  text?: Readonly<Record<string, MemoryTicketText>>;
  /** Every operation rejects with this reason (a store that can't answer). */
  failWith?: TicketsUnavailableReason;
}

/** A {@link TicketStorePort} that records every call. */
export interface MemoryTicketStore extends TicketStorePort {
  /** Every call, as `[operation, repoPath, …args]`, in order. */
  readonly calls: ReadonlyArray<readonly unknown[]>;
  /** The watches still open, by repo path. */
  watching(repoPath: string): number;
  /** Tells each open watch of `repoPath` that `refs` changed, as an agent's write would. */
  emit(repoPath: string, refs: string[]): void;
  /** Makes every later call reject with `reason` (`undefined`: answer again). */
  fail(reason: TicketsUnavailableReason | undefined): void;
}

export function createMemoryTicketStore(options: MemoryTicketStoreOptions = {}): MemoryTicketStore {
  const repos = new Map<string, TicketsResponse>();
  for (const [path, tree] of Object.entries(options.repos ?? {})) {
    repos.set(path, TicketsResponse.parse({ tickets: tree.tickets, problems: tree.problems ?? [], folder: tree.folder ?? null }));
  }
  const text = options.text ?? {};
  const calls: unknown[][] = [];
  const watches = new Map<string, Set<(refs: string[]) => void>>();
  let failure: TicketsUnavailableReason | undefined = options.failWith;

  const treeOf = (repoPath: string): TicketsResponse => {
    if (failure !== undefined) throw new TicketsUnavailableError(failure);
    const tree = repos.get(repoPath);
    if (tree === undefined) throw new TicketsUnavailableError('failed');
    return tree;
  };
  const rowOf = (repoPath: string, ref: string): TicketRow => {
    const row = treeOf(repoPath).tickets.find((each) => each.ref === ref);
    if (row === undefined) throw new NotFoundError('ticket', ref);
    return row;
  };
  const emit = (repoPath: string, refs: string[]) => {
    for (const listener of [...(watches.get(repoPath) ?? [])]) {
      try {
        listener([...refs]);
      } catch {
        // A listener's failure never stops the others.
      }
    }
  };

  return {
    calls,
    async tree(repoPath) {
      calls.push(['tree', repoPath]);
      return structuredClone(treeOf(repoPath));
    },
    async find(repoPath, ref) {
      calls.push(['find', repoPath, ref]);
      const row = rowOf(repoPath, ref);
      const extra = text[ref] ?? {};
      return {
        ...structuredClone(row),
        description: extra.description ?? '',
        verify: extra.verify ?? '',
        references: [...(extra.references ?? [])],
        notes: [...(extra.notes ?? [])],
        unknown: extra.unknown ?? '',
        hasPlan: row.status !== null && row.status !== '',
        plan: row.status !== null && row.status !== '' && row.file !== null ? row.file : null,
      };
    },
    async mark(repoPath, ref, status, markOptions = {}) {
      calls.push(['mark', repoPath, ref, status, markOptions.blockedReason]);
      if (status === 'done' && markOptions.approve !== true) throw new StatusNotAllowedError(status);
      const row = rowOf(repoPath, ref);
      const current = row.status ?? '';
      if (markOptions.expectedStatus !== undefined && markOptions.expectedStatus !== current) throw new TicketChangedError(ref, markOptions.expectedStatus, current);
      const blocked = markOptions.blockedReason !== undefined;
      Object.assign(row, {
        status,
        state: STATE_OF[status],
        blocked_reason: blocked ? markOptions.blockedReason : '',
        blocked_at: blocked ? new Date().toISOString().slice(0, 10) : '',
      });
      emit(repoPath, [ref]);
      return { ref, status };
    },
    async watch(repoPath, outputFolder, onChange) {
      calls.push(['watch', repoPath, outputFolder]);
      if (failure !== undefined) throw new TicketsUnavailableError(failure);
      const set = watches.get(repoPath) ?? new Set();
      watches.set(repoPath, set);
      set.add(onChange);
      let open = true;
      return {
        close: () => {
          if (!open) return;
          open = false;
          set.delete(onChange);
        },
      };
    },
    watching: (repoPath) => watches.get(repoPath)?.size ?? 0,
    emit,
    fail: (reason) => {
      failure = reason;
    },
  };
}
