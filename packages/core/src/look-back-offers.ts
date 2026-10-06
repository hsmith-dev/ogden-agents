/**
 * The finished-epic offer's Not now (CAP-13, E7-R3; story 7.2): which epics
 * of a project the user answered "Every ticket in this epic is done. Look
 * back on it?" with Not now. The offer itself is derived from the ticket
 * index and needs no state; only the dismissal is kept, per project and epic
 * name, on the workspace row, and changed only here, in one transaction with
 * its `workspace.look_back_offer_dismissed` event (AD-5), once per epic.
 *
 * Both use-cases serve the `retrospectives` piece and call core's guard
 * first (AD-22), so a project with it off reads and writes nothing.
 */
import { EPIC_SLUG_PATTERN, type WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { BmadFeatures } from './bmad-pieces.js';
import type { Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';

/** The most dismissed epics kept per project (an epic folder name each). */
export const MAX_DISMISSED_OFFERS = 1000;

export interface LookBackOffers {
  /**
   * The epics whose offer was dismissed, in the order they were. `FeatureOffError`
   * with Retrospectives off, `NotFoundError` for an unknown workspace.
   */
  dismissed(workspaceId: WorkspaceId): string[];
  /**
   * Not now for `epic`: the first call appends one event and keeps the
   * answer; a repeat changes nothing. `FeatureOffError`, `NotFoundError`, and
   * `ValidationError` for a name that is not an epic's.
   */
  dismiss(workspaceId: WorkspaceId, epic: string): void;
}

export interface LookBackOffersDeps {
  orm: Orm;
  events: EventLog;
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
}

/** The stored list; damaged text reads as none, and an over-long one keeps the newest. */
function parse(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string' && EPIC_SLUG_PATTERN.test(each)).slice(-MAX_DISMISSED_OFFERS) : [];
  } catch {
    return [];
  }
}

export function createLookBackOffers({ orm, events, bmad }: LookBackOffersDeps): LookBackOffers {
  const read = (workspaceId: string): string[] => {
    const row = orm.select({ list: workspaces.lookBackDismissed }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (row === undefined) throw new NotFoundError('workspace', workspaceId);
    return parse(row.list);
  };
  return {
    dismissed(workspaceId) {
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      return read(workspaceId);
    },

    dismiss(workspaceId, epic) {
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      if (typeof epic !== 'string' || !EPIC_SLUG_PATTERN.test(epic)) {
        throw new ValidationError('That is not the name of an epic.', [{ path: ['epic'], message: 'That is not the name of an epic.' }]);
      }
      events.transaction(() => {
        const list = read(workspaceId);
        if (list.includes(epic)) return;
        // Past the bound the oldest answers go: a long-lived project never grows the row without end.
        const next = [...list, epic].slice(-MAX_DISMISSED_OFFERS);
        orm.update(workspaces).set({ lookBackDismissed: JSON.stringify(next) }).where(eq(workspaces.id, workspaceId)).run();
        events.append({ type: 'workspace.look_back_offer_dismissed', workspaceId, streamId: workspaceId, payload: { epic } });
      });
    },
  };
}
