/**
 * What a worker's chat shows for one instruction (epic 15, story 15.13), read from the chat's own events: the reply and tool calls after the
 * instruction, a Deny of a permission card, whether a restart cut the turn off, and a build run's end checks. Read only: nothing here
 * changes a chat, a run or a step, and everything returned is plain text for the caller to mask and cap.
 */
import { MAX_PAGE_EVENTS, REVIEW_LIMITS, isReviewMessageFor, redactSecrets, type OrchestrationBuildRunView, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { RESTARTED_REASON } from './chat/constants.js';
import type { Base } from './orchestration-kernel.js';

/** How much of a session's newest events are read for its last reply. */
const REPLY_WINDOW = Math.min(MAX_PAGE_EVENTS, 500);
/** How many tool calls the read-back names, and the most characters of them. */
const TOOL_CALLS_SHOWN = 10;
const TOOL_CALLS_CHARS = 800;

/** `text` masked, on one line and cut to `max` characters. */
export const oneLine = (text: string, max: number): string => redactSecrets(text).replace(/\s+/g, ' ').trim().slice(0, max);

/** Whether `content` is the instruction a step sent: the text itself, or for a review step the message core built from its question. */
const sentAs = (content: string, instruction: string, reviewed: boolean): boolean => content === instruction || (reviewed && isReviewMessageFor(content, instruction.slice(0, REVIEW_LIMITS.maxQuestionChars)));

export function createTranscript({ events }: Pick<Base, 'events'>) {
  /**
   * What the worker did for one instruction: the tool calls after it (the newest few, with their last status) and its newest
   * finished reply after it, as plain text for `makeStatusReport`, which masks and caps it. The instruction is found by its
   * text among the chat's newest events; a chat that was used before the instruction shows only what came after it.
   */
  const lastReply = (workspaceId: WorkspaceId, sessionId: SessionId, instruction: string, reused: boolean, reviewed = false): string => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    let reply = '';
    let found = false;
    const calls = new Map<string, string>();
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'session.message_completed') {
        if (event.payload.role === 'agent') {
          if (reply === '') reply = event.payload.content;
        } else if ((event.payload.origin === 'manager' || event.payload.origin === 'manager_auto') && sentAs(event.payload.content, instruction, reviewed)) {
          found = true;
          break;
        }
      } else if (event.type === 'session.tool_call' || event.type === 'session.tool_call_updated') {
        // Newest first: the first time a call is seen is its latest status.
        if (!calls.has(event.payload.toolCallId)) calls.set(event.payload.toolCallId, `${oneLine(event.payload.title, 80)} (${event.payload.status})`);
      }
    }
    // A chat the user used before: if the instruction is not in the window, nothing of it is the worker's result (never the user's own history).
    if (reused && !found) return '';
    const shown = [...calls.values()].slice(0, TOOL_CALLS_SHOWN).reverse();
    const tools = shown.length === 0 ? '' : `Tool calls${calls.size > shown.length ? ` (the last ${shown.length} of ${calls.size})` : ''}: ${shown.join('; ')}`.slice(0, TOOL_CALLS_CHARS);
    return tools === '' ? reply : reply === '' ? tools : `${tools}\n\n${reply}`;
  };

  /**
   * Whether a worker's permission card was Denied during this instruction (15.9): the title of the denied tool call (possibly empty), or
   * `undefined`. Read from the worker session's own `permission.resolved` events since the manager's instruction, so it survives a restart.
   * A card that was cancelled (the worker was stopped) is not a Deny.
   */
  const deniedSince = (workspaceId: WorkspaceId, sessionId: SessionId, instruction: string, reused: boolean, reviewed = false): { title: string } | undefined => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    const denied: string[] = [];
    const titles = new Map<string, string>();
    let found = false;
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'permission.resolved') {
        if (event.payload.decision === 'deny' && event.payload.by !== 'cancelled') denied.push(event.payload.requestId);
      } else if (event.type === 'permission.requested') titles.set(event.payload.requestId, event.payload.toolCall.title);
      else if (event.type === 'session.message_completed' && event.payload.role !== 'agent' && (event.payload.origin === 'manager' || event.payload.origin === 'manager_auto') && sentAs(event.payload.content, instruction, reviewed)) {
        found = true;
        break;
      }
    }
    if ((reused && !found) || denied.length === 0) return undefined;
    return { title: oneLine(titles.get(denied[0]!) ?? '', 80) };
  };

  /** Whether the worker's chat was left idle because Ogden Agents restarted in the middle of its turn (its newest state change says so). */
  const cutOffByRestart = (workspaceId: WorkspaceId, sessionId: SessionId): boolean => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, 60, sessionId);
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'session.state_changed') return event.payload.state === 'idle' && event.payload.resumable === true && event.payload.reason === RESTARTED_REASON;
    }
    return false;
  };

  /** The latest end checks of a build run: counts only (never output), or `null` when none ran. */
  const checksOf = (workspaceId: WorkspaceId, sessionId: SessionId): OrchestrationBuildRunView['checks'] => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type !== 'run.verification_completed') continue;
      const results = event.payload.verification.checks.map((check) => check.result);
      return { passed: results.filter((result) => result === 'pass').length, failed: results.filter((result) => result === 'fail').length, notRun: results.filter((result) => result === 'not_run').length };
    }
    return null;
  };

  return { lastReply, deniedSince, cutOffByRestart, checksOf };
}

export type TranscriptApi = ReturnType<typeof createTranscript>;
