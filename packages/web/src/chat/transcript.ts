import type {
  AlwaysAllowScope,
  CatalogNext,
  CautionLevel,
  CoreEvent,
  MessageRole,
  PermissionDecision,
  PermissionMode,
  PermissionResolvedEvent,
  ResumedVia,
  SessionErrorCode,
  SessionState,
  ToolCallDiff,
  ToolCallStatus,
  ToolKind,
} from '@ogden-agents/shared';

/** One message in a session's transcript. */
export interface TranscriptMessage {
  messageId: string;
  role: MessageRole;
  text: string;
  /** Still arriving as deltas; false once `session.message_completed` replaced them. */
  streaming: boolean;
  /**
   * A user message sent while the agent worked (story 2.10): `queued` until
   * it is sent, `not_sent` when the turn ended in `error`, a Stop or a
   * restart first. Absent on a message that was sent.
   */
  status?: 'queued' | 'not_sent';
  /**
   * Where a user message came from when not the composer (story 3.6):
   * `terminal` was typed in the agent's own terminal (shown "from terminal"),
   * `deny_reason` was a Deny's reason core sent. Absent otherwise.
   */
  origin?: 'deny_reason' | 'terminal' | 'manager' | 'manager_auto';
  /**
   * The agent that wrote an agent message, when the chat named it (handoff:
   * a chat continued with another agent keeps each reply labelled by its
   * own). Absent on user messages and in sessions from before agents could
   * be chosen.
   */
  agentId?: string;
  /** A queued message sent right away (send now or wait): it is on its way now, ahead of the others. */
  now?: boolean;
  /** A message sent right away that the agent took into its running turn (send now or wait). */
  delivery?: 'injected';
}

/** One tool call as it stands now (story 2.10): each event carries the whole call; diffs only when they changed. */
export interface TranscriptToolCall {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  diffs: ToolCallDiff[] | undefined;
}

/** The latest `session.check_in` (story 2.10), until any later event of the session. */
export interface TranscriptCheckIn {
  /** The tool call still in progress, if any. */
  waitingOn: string | undefined;
  at: string;
}

/**
 * One permission request, where the agent asked (story 2.6). `status` is
 * `pending` while the session waits for the answer; `resolved` once it was
 * decided or cancelled; `unanswered` when it has no answer and the session no
 * longer waits for one (a restart took the agent away).
 */
export interface TranscriptPermission {
  requestId: string;
  toolCall: { toolCallId: string; title: string; kind: ToolKind; command?: string | undefined; protectedPath?: true | undefined };
  /** What Always allow would cover; `null` when it is not offered. */
  scope: AlwaysAllowScope | null;
  cautionLevel: CautionLevel;
  /** The chat's permission mode when it asked (absent before permission modes: Ask). */
  permissionMode?: PermissionMode | undefined;
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

/**
 * The transcript in the order things happened: messages, permission requests,
 * runs of consecutive tool calls (story 2.10), and the breaks where a chat
 * was reopened after its agent was gone (story 2.7), each just before the
 * user message that reopened it.
 */
export type TranscriptItem =
  | { type: 'message'; message: TranscriptMessage }
  | { type: 'permission'; permission: TranscriptPermission }
  | { type: 'tools'; calls: TranscriptToolCall[] }
  | { type: 'resumed'; via: ResumedVia; at: string }
  /**
   * A document the planning session wrote (story 4.7, `session.document_written`):
   * one per path, where its latest write happened.
   */
  | { type: 'document'; path: string; next: CatalogNext | null; toolCallId: string | null; at: string }
  /** The user continued the chat with another agent here (handoff, `session.agent_changed`): the "Continued with" divider. */
  | { type: 'agent_changed'; agentId: string; previous: string; at: string }
  /** The agent's current step was stopped so a message sent right away goes at once (`session.turn_interrupted`). */
  | {
      type: 'interrupted';
      messageId: string;
      at: string;
      /** A permission request the agent raised while its step was stopping was cancelled (no card shown). */
      cancelledRequest?: boolean;
    };

export interface SessionView {
  /** Whether the event log has this session at all (its `session.created`). */
  known: boolean;
  /** The normalized state (AD-4), the only field the UI reads for it. */
  state: SessionState | undefined;
  /** The plain reason of the latest `error`, if the session is in `error`. */
  errorReason: string | undefined;
  /** Why the latest `error` happened, when the UI acts on it (`auth_required`: Sign in again, 9.4). */
  errorCode: SessionErrorCode | undefined;
  messages: TranscriptMessage[];
  /** Messages, tool calls and permission requests, in the order they started. */
  items: TranscriptItem[];
  /** Requests waiting for the user's answer, oldest first. */
  pendingPermissions: TranscriptPermission[];
  /** Messages waiting to be sent, oldest first: shown after everything else, as "Queued". */
  queued: TranscriptMessage[];
  /** Every message that was queued and never sent ("Not sent"), oldest first. */
  notSent: TranscriptMessage[];
  /** The agent has been quiet (`session.check_in`) and nothing has happened since, while it still works. */
  checkIn: TranscriptCheckIn | undefined;
  /**
   * The agent is taking a while to start (`session.agent_starting`, epic 6
   * entry 5) and nothing has come from it since, while the session works.
   */
  starting: boolean;
  /** The text of the latest user message that was sent, for Try again. */
  lastUserText: string | undefined;
  /** The chat's agent as its events say: the latest `session.agent_changed`, else the one it was created with. */
  agentId: string | undefined;
}

/**
 * Folds the event log into one session's view: its state, its messages, tool
 * calls and permission requests, in the order they started. Deltas append to
 * their message until the completed message replaces them (AD-5). A queued
 * message waits outside the order until it is sent (its
 * `session.message_completed`), and becomes "Not sent" when the session goes
 * `idle` or `error` first. Consecutive tool calls share one `tools` item.
 * `rulesRemoved` names the always-allow rules undone since, when `events` is
 * the session's own stream (story 2.10), which does not carry them.
 */
export function sessionView(events: readonly CoreEvent[], sessionId: string, rulesRemoved: ReadonlySet<string> = new Set()): SessionView {
  const view: SessionView = {
    known: false,
    state: undefined,
    errorReason: undefined,
    errorCode: undefined,
    messages: [],
    items: [],
    pendingPermissions: [],
    queued: [],
    notSent: [],
    checkIn: undefined,
    starting: false,
    lastUserText: undefined,
    agentId: undefined,
  };
  const byId = new Map<string, TranscriptMessage>();
  const permissions = new Map<string, TranscriptPermission>();
  const toolCalls = new Map<string, TranscriptToolCall>();
  let queued = new Map<string, TranscriptMessage>();
  /** The latest stop for a message sent right away, until a message of the user's is sent after it. */
  let openInterrupt: Extract<TranscriptItem, { type: 'interrupted' }> | undefined;
  const removedRules = new Set<string>(rulesRemoved);
  const message = (messageId: string, role: MessageRole) => {
    let found = byId.get(messageId);
    if (found === undefined) {
      found = { messageId, role, text: '', streaming: true, ...(role === 'agent' && view.agentId !== undefined ? { agentId: view.agentId } : {}) };
      byId.set(messageId, found);
      view.messages.push(found);
      view.items.push({ type: 'message', message: found });
    }
    return found;
  };
  const toolCall = (call: TranscriptToolCall, update: boolean) => {
    const known = toolCalls.get(call.toolCallId);
    if (known !== undefined) {
      // An update carries the whole call; its diffs only when they changed (story 2.3 review F1).
      // A late one that names no title or kind never blanks what the row already says.
      Object.assign(known, {
        status: call.status,
        title: call.title === '' ? known.title : call.title,
        kind: call.kind === 'other' ? known.kind : call.kind,
        diffs: call.diffs ?? known.diffs,
      });
      return;
    }
    // An update for a call never seen, with nothing to show, makes no blank row.
    if (update && call.title === '') return;
    toolCalls.set(call.toolCallId, call);
    const last = view.items.at(-1);
    if (last?.type === 'tools') last.calls.push(call);
    else view.items.push({ type: 'tools', calls: [call] });
  };
  for (const event of events) {
    // Rules live on the workspace's stream; their ids are unique across the install.
    if (event.type === 'workspace.permission_rule_removed') removedRules.add(event.payload.ruleId);
    if (event.streamId !== sessionId) continue;
    // A chat's name (backlog story 12) is not something the session did: it leaves the transcript, Starting and a check-in alone.
    if (event.type === 'session.renamed') continue;
    // A check-in stands only until the session does anything else.
    if (event.type !== 'session.check_in') view.checkIn = undefined;
    // Starting stands until the agent is started or anything else happens, but a message queued meanwhile.
    if (event.type === 'session.agent_starting') view.starting = true;
    else if (event.type !== 'session.message_queued' && !(event.type === 'session.state_changed' && event.payload.state === 'working')) view.starting = false;
    switch (event.type) {
      case 'session.created':
        view.known = true;
        view.state = event.payload.session.state;
        view.agentId = event.payload.session.agentId;
        break;
      case 'session.agent_changed':
        // A session from before agents could be chosen names no agent: its earlier replies were the one that leaves.
        for (const earlier of view.messages) if (earlier.role === 'agent' && earlier.agentId === undefined) earlier.agentId = event.payload.previous;
        view.agentId = event.payload.agentId;
        view.items.push({ type: 'agent_changed', agentId: event.payload.agentId, previous: event.payload.previous, at: event.at });
        break;
      case 'session.state_changed':
        view.state = event.payload.state;
        view.errorReason = event.payload.state === 'error' ? event.payload.reason : undefined;
        view.errorCode = event.payload.state === 'error' ? event.payload.errorCode : undefined;
        if (event.payload.state === 'idle' || event.payload.state === 'error') {
          // The turn ended before these went: they are not sent, where the turn ended.
          for (const unsent of queued.values()) {
            unsent.status = 'not_sent';
            delete unsent.now;
            view.notSent.push(unsent);
            view.items.push({ type: 'message', message: unsent });
          }
          queued.clear();
        }
        break;
      case 'session.message_delta':
        message(event.payload.messageId, event.payload.role).text += event.payload.text;
        break;
      case 'session.message_queued': {
        const { messageId, content } = event.payload;
        if (byId.has(messageId) || queued.has(messageId)) break;
        const waiting: TranscriptMessage = { messageId, role: 'user', text: content, streaming: false, status: 'queued' };
        if (event.payload.now === true) {
          // Sent right away: after the others sent right away, ahead of every one that waits.
          waiting.now = true;
          const ahead = [...queued.values()].filter((message) => message.now === true);
          const behind = [...queued.values()].filter((message) => message.now !== true);
          queued = new Map([...ahead, waiting, ...behind].map((message) => [message.messageId, message]));
        } else queued.set(messageId, waiting);
        break;
      }
      case 'session.queue_changed': {
        // The user changed what waits: this is all of it, in order. One missing was removed, not "Not sent".
        const next = new Map<string, TranscriptMessage>();
        for (const entry of event.payload.queue) {
          const known = queued.get(entry.messageId) ?? { messageId: entry.messageId, role: 'user' as const, text: '', streaming: false, status: 'queued' as const };
          known.text = entry.content;
          if (entry.now === true) known.now = true;
          else delete known.now;
          next.set(entry.messageId, known);
        }
        queued = next;
        break;
      }
      case 'session.turn_interrupted':
        openInterrupt = { type: 'interrupted', messageId: event.payload.messageId, at: event.at };
        view.items.push(openInterrupt);
        break;
      case 'session.message_completed': {
        // A queued message is sent now: it takes its place here.
        queued.delete(event.payload.messageId);
        // One shown "Not sent" that the agent had taken after all (a Stop during a send now): sent, where it is.
        const unsent = view.notSent.findIndex((m) => m.messageId === event.payload.messageId);
        if (unsent !== -1) {
          const [taken] = view.notSent.splice(unsent, 1);
          delete taken!.status;
          byId.set(taken!.messageId, taken!);
          view.messages.push(taken!);
        }
        const done = message(event.payload.messageId, event.payload.role);
        done.text = event.payload.content;
        done.streaming = false;
        if (event.payload.origin !== undefined) done.origin = event.payload.origin;
        if (event.payload.delivery !== undefined) done.delivery = event.payload.delivery;
        // A Deny reason core sent is not the user's message to try again (9.4 review F4).
        if (event.payload.role === 'user' && event.payload.origin !== 'deny_reason') view.lastUserText = event.payload.content;
        if (event.payload.role === 'user') openInterrupt = undefined;
        break;
      }
      case 'session.tool_call':
      case 'session.tool_call_updated': {
        const { toolCallId, title, kind, status, diffs } = event.payload;
        toolCall({ toolCallId, title, kind, status, diffs }, event.type === 'session.tool_call_updated');
        break;
      }
      case 'session.document_written': {
        // One card per path: a rewrite moves it to where the latest write happened.
        const { path, next, toolCallId } = event.payload;
        const earlier = view.items.findIndex((item) => item.type === 'document' && item.path === path);
        if (earlier !== -1) view.items.splice(earlier, 1);
        view.items.push({ type: 'document', path, next, toolCallId, at: event.at });
        break;
      }
      case 'session.check_in':
        view.checkIn = { waitingOn: event.payload.waitingOn, at: event.at };
        break;
      case 'session.resumed': {
        // The chat reopens on the user's next message: the break goes just before it.
        const reopenedBy = view.items.findLastIndex((item) => item.type === 'message' && item.message.role === 'user' && item.message.status === undefined);
        const marker: TranscriptItem = { type: 'resumed', via: event.payload.via, at: event.at };
        if (reopenedBy === -1) view.items.push(marker);
        else view.items.splice(reopenedBy, 0, marker);
        break;
      }
      case 'permission.requested': {
        const { requestId, toolCall: call, alwaysAllowScope, cautionLevel, permissionMode } = event.payload;
        if (permissions.has(requestId)) break;
        const permission: TranscriptPermission = {
          requestId,
          toolCall: call,
          scope: alwaysAllowScope,
          cautionLevel,
          ...(permissionMode === undefined ? {} : { permissionMode }),
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
        // Cancelled while the step was stopping for a message sent right away: the note says so.
        if (event.payload.by === 'cancelled' && openInterrupt !== undefined) openInterrupt.cancelledRequest = true;
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
  view.queued = [...queued.values()];
  // A reply is only streaming while its session works; after an error or idle it is what arrived.
  if (view.state !== 'working') {
    for (const m of view.messages) m.streaming = false;
    view.checkIn = undefined;
    view.starting = false;
  }
  for (const permission of permissions.values()) {
    if (permission.resolution?.ruleId !== undefined) permission.resolution.ruleRemoved = removedRules.has(permission.resolution.ruleId);
    // Only a waiting session is holding a request for its answer; any other has let it go.
    if (permission.status === 'pending' && view.state !== 'waiting') permission.status = 'unanswered';
    if (permission.status === 'pending') view.pendingPermissions.push(permission);
  }
  return view;
}
