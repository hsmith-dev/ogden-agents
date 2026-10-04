/** Adapter tool calls as events carry them (moved from `chat.ts`, story 3.11). */
import { MAX_DIFF_TEXT_LENGTH, ToolCallStatus, ToolKind, type SessionId, type ToolCallDiff } from '@ogden-agents/shared';
import type { AgentToolCallDiff } from '../agent-port.js';
import type { ToolCallState } from './types.js';

/** An adapter's tool kind as the shared enum, or `undefined` when it named none or an unknown one. */
export const toolKind = (kind: string | undefined): ToolKind | undefined => {
  const parsed = ToolKind.safeParse(kind);
  return parsed.success ? parsed.data : undefined;
};
export const toolStatus = (status: string | undefined): ToolCallStatus | undefined => {
  const parsed = ToolCallStatus.safeParse(status);
  return parsed.success ? parsed.data : undefined;
};
/**
 * The adapter's diffs as events carry them: each side cut to
 * {@link MAX_DIFF_TEXT_LENGTH} characters and flagged `truncated` when it was
 * (story 2.3 review F1), so no adapter can put an unbounded file in the log.
 */
export const capDiffs = (diffs: readonly AgentToolCallDiff[] | undefined): ToolCallDiff[] | undefined =>
  diffs?.map(({ path, oldText, newText }) => {
    const cut = (text: string) => (text.length > MAX_DIFF_TEXT_LENGTH ? text.slice(0, MAX_DIFF_TEXT_LENGTH) : text);
    const truncated = newText.length > MAX_DIFF_TEXT_LENGTH || (oldText !== null && oldText.length > MAX_DIFF_TEXT_LENGTH);
    return { path, oldText: oldText === null ? null : cut(oldText), newText: cut(newText), ...(truncated ? { truncated: true as const } : {}) };
  });
export const sameDiffs = (a: readonly ToolCallDiff[] | undefined, b: readonly ToolCallDiff[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
/** The event payload for `call`; `withDiffs: false` leaves its diffs out (an update that did not change them). */
export const toolCallPayload = (sessionId: SessionId, toolCallId: string, call: ToolCallState, withDiffs = true) => ({
  sessionId,
  toolCallId,
  title: call.title,
  kind: call.kind,
  status: call.status,
  ...(!withDiffs || call.diffs === undefined || call.diffs.length === 0 ? {} : { diffs: call.diffs }),
});
