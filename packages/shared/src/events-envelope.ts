/**
 * The envelope fields event schemas share (moved from `events.ts` in story
 * 10.8). Internal to the event modules: not exported from the package.
 */
import { Seq } from './events-common.js';
import { EventId, SessionId, WorkspaceId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';

/** Fields core fills in when it appends an event. */
export const assigned = {
  id: EventId,
  seq: Seq,
  at: IsoUtcTimestamp,
};

/** Workspace-level events use the workspace's stream. */
export const onWorkspaceStream = { workspaceId: WorkspaceId, streamId: WorkspaceId };
/** Session and run events share the session's stream: the run view is the session view (AD-8). */
export const onSessionStream = { workspaceId: WorkspaceId, streamId: SessionId };
