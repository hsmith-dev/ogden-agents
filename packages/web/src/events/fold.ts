import type { CoreEvent } from '@ogden-agents/shared';

/**
 * Folds one event into the list: a completed message replaces its deltas
 * (AD-5), a workspace's deleted history is dropped from the list, and so
 * are a deleted chat's events (27.3).
 * Duplicates are filtered by `seq` before this is called.
 */
export function addEvent(previous: readonly CoreEvent[], event: CoreEvent): CoreEvent[] {
  let next = previous;
  if (event.type === 'session.message_completed') {
    const { messageId } = event.payload;
    next = next.filter(
      (e) => !(e.type === 'session.message_delta' && e.streamId === event.streamId && e.payload.messageId === messageId),
    );
  } else if (event.type === 'workspace.history_deleted') {
    next = next.filter((e) => e.workspaceId !== event.workspaceId);
  } else if (event.type === 'workspace.chat_deleted') {
    // Delete chat (27.3): that chat's own events go; the event itself stays on the workspace's stream.
    const { sessionId } = event.payload;
    next = next.filter((e) => e.streamId !== sessionId);
  }
  return [...next, event];
}
