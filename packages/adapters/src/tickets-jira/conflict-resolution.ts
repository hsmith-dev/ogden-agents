/**
 * AD-28's conflict rule, as pure functions (epic 18 story 6): each two-way
 * field keeps the value it held at the last successful sync (the
 * baseline). Changed on exactly one side since then, that side's value
 * wins. Changed on both sides to different values is a genuine conflict:
 * Ogden never guesses a merge, keeps the local value, and records a
 * notice — unless the caller is an explicit Refresh, the one case AD-28
 * allows Jira's version to overwrite local outright. `status` has its own
 * function, because BMad's local status and Jira's raw status name are
 * different vocabularies (many Jira names can map to one BMad status) and
 * because `done` is never written by a sync in either direction,
 * regardless of Refresh.
 */
import type { TicketStatus } from '@ogden-agents/shared';
import { mapJiraStatusToBmad } from './jira-issue-mapping.js';

export type ConflictField = 'title' | 'body' | 'status';

/**
 * One field's reconciliation outcome: `apply` (Jira alone changed — write
 * its value locally), `push` (local alone changed — write it out to
 * Jira; AD-28: "a local title/body edit pushes to the matching Jira
 * issue on the next successful sync"), `keep` (neither changed, or both
 * changed and converged on the same value — nothing to write either
 * way), or `conflict` (both changed to different values — local wins for
 * now, but a notice is recorded).
 */
export interface FieldOutcome<T> {
  action: 'apply' | 'push' | 'keep' | 'conflict';
  /** The value now in force: Jira's for `apply`, local's for everything else. */
  value: T;
  /** Present only for `conflict`: both sides' current values, for the notice. */
  conflict?: { local: T; jira: T };
}

/**
 * Reconciles one plain two-way field (`title` or `body`): see this
 * module's header. `isExplicitRefresh` is the one case a genuine conflict
 * resolves to Jira's value instead of staying a conflict.
 */
export function reconcileField<T>(baseline: T, local: T, jira: T, isExplicitRefresh: boolean, equals: (a: T, b: T) => boolean = (a, b) => a === b): FieldOutcome<T> {
  const jiraChanged = !equals(jira, baseline);
  const localChanged = !equals(local, baseline);
  if (!jiraChanged && !localChanged) return { action: 'keep', value: local };
  if (!jiraChanged) return { action: 'push', value: local };
  if (!localChanged) return { action: 'apply', value: jira };
  if (equals(local, jira)) return { action: 'keep', value: local }; // converged independently to the same value: not a real conflict
  if (isExplicitRefresh) return { action: 'apply', value: jira };
  return { action: 'conflict', value: local, conflict: { local, jira } };
}

/** Local statuses a pulled Jira status may ever be applied into automatically. `built` and `done` are excluded: build-pipeline-owned states a tracker pull must never fabricate (AD-10, AD-17; `done`'s own exception is handled separately, below). */
const PULL_TARGETABLE_STATUSES: ReadonlySet<TicketStatus> = new Set(['draft', 'ready-for-dev', 'in-progress', 'in-review', 'blocked']);

/** How far along BMad's own pipeline each status sits, for "no backward move" below. `blocked`/`dropped` are side-states, not on the line. */
const PIPELINE_RANK: Readonly<Record<TicketStatus, number>> = { draft: 0, 'ready-for-dev': 1, 'in-progress': 2, 'in-review': 3, built: 4, done: 5, blocked: -1, dropped: -1 };

/**
 * Whether a pull may move a ticket from `from` to `to` at all: `to` must
 * be one {@link PULL_TARGETABLE_STATUSES} can reach automatically, and
 * the move must not be backward on BMad's own pipeline (AD-28: "the
 * local state machine does not represent every Jira workflow move,
 * including some backward ones") — except into or out of `blocked`,
 * which is always allowed either way, since a block can land or lift at
 * any point in the pipeline.
 */
function isValidPullTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (!PULL_TARGETABLE_STATUSES.has(to)) return false;
  if (to === 'blocked' || from === 'blocked' || from === 'dropped') return true;
  return PIPELINE_RANK[to] >= PIPELINE_RANK[from];
}

export interface StatusOutcome {
  action: 'apply' | 'push' | 'keep' | 'conflict';
  value: TicketStatus;
  conflict?: { local: TicketStatus; jira: string };
  /** Why a `conflict` was chosen, for the notice shown to the user. */
  reason?: 'done_exception' | 'no_valid_transition' | 'both_changed';
}

/**
 * Reconciles `status` (AD-28's own exceptions, on top of the general
 * rule): a Jira status mapping to `done` is never applied automatically,
 * with no local `done` already matching (only `approve` writes `done`,
 * AD-10/AD-17) — not even on an explicit Refresh. Nor is a mapped status
 * this adapter has no valid local transition for (never `built`, never
 * `done` other than through the exception just named). Everything else
 * follows {@link reconcileField}'s general rule, byte for byte.
 *
 * `baselineJiraStatusName` and `currentJiraStatusName` are Jira's own raw
 * status text (what the sync baseline stores); `localStatus` and the
 * comparison against the baseline are both done in BMad's status
 * vocabulary, since that is what "changed on the local side" means here.
 */
export function reconcileStatus(baselineJiraStatusName: string, localStatus: TicketStatus, currentJiraStatusName: string, isExplicitRefresh: boolean): StatusOutcome {
  const baselineBmadStatus = mapJiraStatusToBmad(baselineJiraStatusName).status;
  const jiraMappedStatus = mapJiraStatusToBmad(currentJiraStatusName).status;

  // The done exception overrides everything else, including an explicit Refresh.
  if (jiraMappedStatus === 'done' && localStatus !== 'done') {
    return { action: 'conflict', value: localStatus, conflict: { local: localStatus, jira: currentJiraStatusName }, reason: 'done_exception' };
  }

  const general = reconcileField(baselineBmadStatus, localStatus, jiraMappedStatus, isExplicitRefresh);
  if (general.action === 'conflict') return { action: 'conflict', value: localStatus, conflict: { local: localStatus, jira: currentJiraStatusName }, reason: 'both_changed' };
  if (general.action === 'keep' || general.action === 'push') return { action: general.action, value: localStatus };
  // `apply` was chosen (Jira alone changed, or an explicit Refresh resolved a conflict to it): still refuse a move this adapter has no safe local transition for (including backward ones).
  if (!isValidPullTransition(localStatus, jiraMappedStatus)) {
    return { action: 'conflict', value: localStatus, conflict: { local: localStatus, jira: currentJiraStatusName }, reason: 'no_valid_transition' };
  }
  return { action: 'apply', value: jiraMappedStatus };
}
