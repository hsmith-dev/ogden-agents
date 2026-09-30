import type {
  AlwaysAllowScope,
  CautionLevel,
  CoreEvent,
  MessageRole,
  PermissionDecision,
  PermissionResolvedEvent,
  SessionState,
  ToolKind,
} from '@ogden-agents/shared';

/** One message in a session's transcript. */
export interface TranscriptMessage {
  messageId: string;
  role: MessageRole;
  text: string;
  /** Still arriving as deltas; false once `session.message_completed` replaced them. */
  streaming: boolean;
}

/**
 * One permission request, where the agent asked (story 2.6). `status` is
 * `pending` while the session waits for the answer; `resolved` once it was
 * decided or cancelled; `unanswered` when it has no answer and the session no
 * longer waits for one (a restart took the agent away).
 */
export interface TranscriptPermission {
  requestId: string;
  toolCall: { toolCallId: string; title: string; kind: ToolKind; command?: string | undefined };
  /** What Always allow would cover; `null` when it is not offered. */
  scope: AlwaysAllowScope | null;
  cautionLevel: CautionLevel;
  requestedAt: string;
  status: 'pending' | 'resolved' | 'unanswered';
  resolution:
    | {
        decision: PermissionDecision;
        by: PermissionResolvedEvent['payload']['by'];
        reason: string | undefined;
        ruleId: string | undefined;
        /** The rule was undone since (`workspace.permission_rule_removed`). */
        ruleRemoved: boolean;
        at: string;
      }
    | undefined;
}

/** The transcript in the order things happened: messages and permission requests. */
export type TranscriptItem = { type: 'message'; message: TranscriptMessage } | { type: 'permission'; permission: TranscriptPermission };

export interface SessionView {
  /** Whether the event log has this session at all (its `session.created`). */
  known: boolean;
  /** The normalized state (AD-4), the only field the UI reads for it. */
  state: SessionState | undefined;
  /** The plain reason of the latest `error`, if the session is in `error`. */
  errorReason: string | undefined;
  messages: TranscriptMessage[];
  /** Messages and permission requests, in the order they started. */
  items: TranscriptItem[];
  /** Requests waiting for the user's answer, oldest first. */
  pendingPermissions: TranscriptPermission[];
}

/**
 * Folds the event log into one session's view: its state, its messages and
 * its permission requests, in the order they started. Deltas append to their
 * message until the completed message replaces them (AD-5).
 */
export function sessionView(events: readonly CoreEvent[], sessionId: string): SessionView {
  const view: SessionView = { known: false, state: undefined, errorReason: undefined, messages: [], items: [], pendingPermissions: [] };
  const byId = new Map<string, TranscriptMessage>();
  const permissions = new Map<string, TranscriptPermission>();
  const removedRules = new Set<string>();
  const message = (messageId: string, role: MessageRole) => {
    let found = byId.get(messageId);
    if (found === undefined) {
      found = { messageId, role, text: '', streaming: true };
      byId.set(messageId, found);
      view.messages.push(found);
      view.items.push({ type: 'message', message: found });
    }
    return found;
  };
  for (const event of events) {
    // Rules live on the workspace's stream; their ids are unique across the install.
    if (event.type === 'workspace.permission_rule_removed') removedRules.add(event.payload.ruleId);
    if (event.streamId !== sessionId) continue;
    switch (event.type) {
      case 'session.created':
        view.known = true;
        view.state = event.payload.session.state;
        break;
      case 'session.state_changed':
        view.state = event.payload.state;
        view.errorReason = event.payload.state === 'error' ? event.payload.reason : undefined;
        break;
      case 'session.message_delta':
        message(event.payload.messageId, event.payload.role).text += event.payload.text;
        break;
      case 'session.message_completed': {
        const done = message(event.payload.messageId, event.payload.role);
        done.text = event.payload.content;
        done.streaming = false;
        break;
      }
      case 'permission.requested': {
        const { requestId, toolCall, alwaysAllowScope, cautionLevel } = event.payload;
        if (permissions.has(requestId)) break;
        const permission: TranscriptPermission = {
          requestId,
          toolCall,
          scope: alwaysAllowScope,
          cautionLevel,
          requestedAt: event.at,
          status: 'pending',
          resolution: undefined,
        };
        permissions.set(requestId, permission);
        view.items.push({ type: 'permission', permission });
        break;
      }
      case 'permission.resolved': {
        const permission = permissions.get(event.payload.requestId);
        if (permission === undefined) break;
        permission.status = 'resolved';
        permission.resolution = {
          decision: event.payload.decision,
          by: event.payload.by,
          reason: event.payload.reason,
          ruleId: event.payload.ruleId,
          ruleRemoved: false,
          at: event.at,
        };
        break;
      }
      default:
        break;
    }
  }
  // A reply is only streaming while its session works; after an error or idle it is what arrived.
  if (view.state !== 'working') for (const m of view.messages) m.streaming = false;
  for (const permission of permissions.values()) {
    if (permission.resolution?.ruleId !== undefined) permission.resolution.ruleRemoved = removedRules.has(permission.resolution.ruleId);
    // Only a waiting session is holding a request for its answer; any other has let it go.
    if (permission.status === 'pending' && view.state !== 'waiting') permission.status = 'unanswered';
    if (permission.status === 'pending') view.pendingPermissions.push(permission);
  }
  return view;
}
