import type { CoreEvent } from '@ogden-agents/shared';

/**
 * Folds one event into the list: a completed message replaces its deltas
 * (AD-5), and a workspace's deleted history is dropped from the list.
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
  }
  return [...next, event];
}
