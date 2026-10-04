/**
 * Whether a project's repo already uses BMad Method, and the user's answer to
 * the offer (CAP-19, AD-22, E10-R5; story 10.3). Detection asks
 * {@link BmadCatalogPort.detect} about the workspace's stored real path
 * (never a path from a request), read-only; core adds the per-project Not
 * now flag it keeps on the workspace row. Not now is changed only here, and
 * appends `workspace.bmad_offer_dismissed` in the same transaction (AD-5),
 * once: a repeat changes nothing.
 *
 * These use-cases serve projects with BMad off, so they are not guarded by
 * a piece.
 */
import type { BmadDetection, WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import type { Entities } from './entities.js';
import { NotFoundError } from './errors.js';
import type { EventLog } from './event-log.js';

export interface BmadDetectionUseCases {
  /**
   * What the workspace's repo has (`_bmad/`, `_bmad-output/`) and whether its
   * offer was dismissed. {@link NotFoundError} for an unknown workspace.
   * With no catalog wired, the repo answers that it has neither.
   */
  detect(workspaceId: WorkspaceId): Promise<BmadDetection>;
  /**
   * Not now: keeps the offer hidden for this workspace for good. The first
   * call appends one `workspace.bmad_offer_dismissed`; a repeat changes
   * nothing. {@link NotFoundError} for an unknown workspace.
   */
  dismissOffer(workspaceId: WorkspaceId): void;
}

export interface BmadDetectionDeps {
  orm: Orm;
  events: EventLog;
  entities: Pick<Entities, 'getWorkspace'>;
  catalog?: BmadCatalogPort | undefined;
}

export function createBmadDetection({ orm, events, entities, catalog }: BmadDetectionDeps): BmadDetectionUseCases {
  /** The stored flag, or `undefined` for an unknown workspace. */
  const readDismissed = (workspaceId: string): boolean | undefined =>
    orm.select({ dismissed: workspaces.bmadOfferDismissed }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.dismissed;

  return {
    async detect(workspaceId) {
      const workspace = entities.getWorkspace(workspaceId);
      if (workspace === undefined) throw new NotFoundError('workspace', workspaceId);
      // `toWorkspace` always sets `realPath`; the shared type only keeps it optional for old events.
      const repoPath = workspace.realPath;
      const found = catalog === undefined || repoPath === undefined ? { hasBmad: false, hasOutput: false } : await catalog.detect(repoPath);
      // Read after the (async) detection, so a Not now that landed meanwhile counts.
      const offerDismissed = readDismissed(workspaceId);
      if (offerDismissed === undefined) throw new NotFoundError('workspace', workspaceId);
      return { hasBmad: found.hasBmad === true, hasOutput: found.hasOutput === true, offerDismissed };
    },

    dismissOffer(workspaceId) {
      events.transaction(() => {
        const dismissed = readDismissed(workspaceId);
        if (dismissed === undefined) throw new NotFoundError('workspace', workspaceId);
        if (dismissed) return;
        orm.update(workspaces).set({ bmadOfferDismissed: true }).where(eq(workspaces.id, workspaceId)).run();
        events.append({ type: 'workspace.bmad_offer_dismissed', workspaceId, streamId: workspaceId, payload: {} });
      });
    },
  };
}
