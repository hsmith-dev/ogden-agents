/**
 * The board (CAP-7; story 4.1, the tracer; story 4.2 freezes the rest): a
 * project's tickets, one ticket, and a status change, each through
 * `TicketStorePort` at each request (AD-7, AD-10: Ogden Agents stores no
 * ticket state). Every use-case serves the `board` piece and calls core's
 * guard first (AD-22), then the per-project script trust (story 4.2: the
 * store runs the project's own BMad Method scripts), then whether the pinned
 * BMad Method is downloaded (story 4.14, AD-13: `tickets.py` runs only from
 * the verified copy), so a project with Board off, not trusted, or an install
 * without the download runs nothing. Entry 4.11: last, the project's BMad
 * Method must have the `ticket_tree` capability (read-only, through
 * `BmadCatalogPort.missingCapabilities`), else `ReducedModeError` and
 * nothing runs. The repo is the workspace's stored real path, never request
 * input.
 */
import {
  MarkTicketRequest,
  TICKET_REF_PATTERN,
  type BmadCapability,
  type MarkTicketResponse,
  type TicketDetail,
  type TicketsResponse,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { BmadSourceUseCases } from './bmad-source-port.js';
import type { Entities } from './entities.js';
import { BmadNotSetUpError, ReducedModeError, ReopenNotConfirmedError, StatusNotAllowedError, ValidationError } from './errors.js';
import { workspaceRepoPath } from './planning.js';
import { serializedByRepo } from './repo-serialization.js';
import type { TicketStorePort } from './ticket-store-port.js';

export interface BoardUseCases {
  /**
   * Every ticket of the project, in build order, and what couldn't be read.
   * `FeatureOffError` with Board off, `ScriptsNotTrustedError` without
   * the project's trust and `BmadNotDownloadedError` without the pinned BMad
   * Method (nothing runs), `BmadNotSetUpError` without `_bmad/` and `ReducedModeError` when the project's BMad Method
   * lacks the ticket tree (entry 4.11; nothing runs), `NotFoundError` for an unknown
   * workspace, `TicketsUnavailableError` when the store can't answer.
   */
  tickets(workspaceId: WorkspaceId): Promise<TicketsResponse>;
  /**
   * One ticket (entry 4.9's route). As {@link tickets}, plus
   * `ValidationError` for a malformed ref and `NotFoundError` when no
   * ticket matches.
   */
  ticket(workspaceId: WorkspaceId, ref: string): Promise<TicketDetail>;
  /**
   * Sets a ticket's status (entry 4.10's route; E4-R9). As {@link ticket},
   * plus `ValidationError` for a request that fails `MarkTicketRequest` and
   * `StatusNotAllowedError` for `done`, which only approve writes (AD-10);
   * nothing runs then. With `expectedStatus` (story 4.10) the store compares
   * first: `TicketChangedError` and nothing written when it differs. With
   * `expectedStatus: 'done'` it needs `reopen: true` (the user confirmed),
   * else `ReopenNotConfirmedError` and nothing runs. Marks
   * of one repo run one at a time.
   */
  mark(workspaceId: WorkspaceId, ref: string, request: unknown): Promise<MarkTicketResponse>;
}

export interface BoardDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  trust: Pick<BmadScriptTrust, 'requireScriptsTrusted' | 'requireScriptsUnchanged'>;
  /** The pinned BMad Method (story 4.14): checked after the trust, never downloaded from here. */
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  entities: Pick<Entities, 'getWorkspace'>;
  /**
   * The project's BMad Method (entry 4.11, AD-14), checked last, read-only,
   * before the store runs anything: a `_bmad/` folder (`BmadNotSetUpError`
   * without one), then the ticket tree (`ReducedModeError`).
   */
  catalog: Pick<BmadCatalogPort, 'detect' | 'missingCapabilities'>;
  tickets: TicketStorePort;
}

/** What the board needs of the project's BMad Method (AD-14). */
const BOARD_CAPABILITIES: readonly BmadCapability[] = ['ticket_tree'];

/** `ref` as the store takes it, or {@link ValidationError}. */
function checkedRef(ref: unknown): string {
  if (typeof ref !== 'string' || !TICKET_REF_PATTERN.test(ref)) {
    throw new ValidationError('That is not a ticket reference.', [{ path: ['ref'], message: 'That is not a ticket reference.' }]);
  }
  return ref;
}

export function createBoard({ bmad, trust, source, entities, catalog, tickets }: BoardDeps): BoardUseCases {
  // The tail of each repo's marks (story 4.10), shared with approve's `done` mark (story 5.2): never two at once.
  const serialized = serializedByRepo;
  /** The guards in order (the piece, the trust, the pinned BMad Method, `_bmad/`, the ticket tree, then the scripts' contents), then the repo. */
  const guarded = async (workspaceId: WorkspaceId): Promise<string> => {
    bmad.requireBmadFeature(workspaceId, 'board');
    trust.requireScriptsTrusted(workspaceId);
    source.requireReady();
    const repoPath = workspaceRepoPath(entities, workspaceId);
    // No `_bmad/` is Set up's, not reduced mode: Upgrade would be refused there.
    if (!(await catalog.detect(repoPath)).hasBmad) throw new BmadNotSetUpError();
    const missing = await catalog.missingCapabilities(repoPath, BOARD_CAPABILITIES);
    if (missing.length > 0) throw new ReducedModeError(missing[0]!);
    // Last, right before the store runs them: the project's scripts are still the ones the user allowed (story 4.13).
    await trust.requireScriptsUnchanged(workspaceId);
    return repoPath;
  };
  return {
    async tickets(workspaceId) {
      return tickets.tree(await guarded(workspaceId));
    },

    async ticket(workspaceId, ref) {
      const repoPath = await guarded(workspaceId);
      return tickets.find(repoPath, checkedRef(ref));
    },

    async mark(workspaceId, ref, request) {
      const repoPath = await guarded(workspaceId);
      const checked = checkedRef(ref);
      const parsed = MarkTicketRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Choose a status.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      // Only approve writes `done` (AD-10): the board never asks the store for it.
      if (parsed.data.status === 'done') throw new StatusNotAllowedError(parsed.data.status);
      const { status, blockedReason, expectedStatus, reopen } = parsed.data;
      // Out of Done only once the user confirmed the reopen (user decision 2026-10-02); nothing runs otherwise.
      if (expectedStatus === 'done' && reopen !== true) throw new ReopenNotConfirmedError(checked);
      // The guards again once it's this mark's turn: Board, the trust or the download may be gone meanwhile.
      return serialized(repoPath, async () => tickets.mark(await guarded(workspaceId), checked, status, { blockedReason, expectedStatus }));
    },
  };
}
