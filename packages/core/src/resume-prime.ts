/**
 * The first prompt of a chat whose agent had to start a new session (story
 * 2.7, E2-R2): the agent could neither resume nor load its earlier session,
 * so core puts the chat's own transcript in front of the user's message.
 *
 * The transcript is the session's completed messages only (the user's own
 * text and the agent's masked replies): never tool output or permission data.
 * It is capped at {@link MAX_PRIME_CHARS}; whole recent messages are kept and
 * the number left out is said. A newest message longer than the cap on its
 * own keeps its end, marked as shortened. The primer goes only to the agent: the stored
 * user message stays the user's own text.
 */
import type { MessageRole } from '@ogden-agents/shared';

/** The most transcript text a primer carries. */
export const MAX_PRIME_CHARS = 100_000;

export const PRIME_HEADER = '[Ogden Agents] This conversation continues from a saved transcript; your earlier session ended.';
export const PRIME_NEW_MESSAGE = '[Ogden Agents] New message:';
/** Put before the kept end of a newest message too long for the cap on its own. */
export const PRIME_SHORTENED = '[shortened: only the end is kept] …';

export interface PrimeMessage {
  role: MessageRole;
  content: string;
}

/**
 * `text` preceded by the transcript of `messages` (oldest first), or `text`
 * alone when there are none. `agentName` labels the agent's messages.
 */
export function primedPrompt(messages: readonly PrimeMessage[], text: string, agentName: string, maxChars = MAX_PRIME_CHARS): string {
  if (messages.length === 0) return text;
  const lines: string[] = [];
  let used = 0;
  // Newest first, whole messages only, until the next one would pass the cap.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const label = `${message.role === 'user' ? 'User' : agentName}: `;
    const line = `${label}${message.content}`;
    if (used + line.length > maxChars) {
      // The newest message alone is too long: keep its end, marked as shortened (review F2).
      if (lines.length === 0) {
        const room = Math.max(0, maxChars - label.length - PRIME_SHORTENED.length);
        lines.push(`${label}${PRIME_SHORTENED}${message.content.slice(message.content.length - room)}`);
      }
      break;
    }
    used += line.length;
    lines.unshift(line);
  }
  const omitted = messages.length - lines.length;
  return [
    PRIME_HEADER,
    ...(omitted > 0 ? [`(${omitted} earlier message${omitted === 1 ? '' : 's'} omitted)`] : []),
    ...lines,
    PRIME_NEW_MESSAGE,
    text,
  ].join('\n');
}
