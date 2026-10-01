/**
 * The turns typed in the agent's own terminal that the chat's transcript
 * lacks (CAP-5, E3-R4; story 3.3): after switching back, core reads the
 * session's conversation as the CLI recorded it (`AgentTerminalResume.transcript`)
 * and appends what this returns as completed messages, the user's marked
 * `origin: 'terminal'`.
 *
 * Where the import starts is the mark core saved when the terminal opened:
 * the id of the CLI's last turn then ({@link START_MARK} when it had none).
 * Without a mark (the read failed then) it lines up on the chat's last user
 * message instead, and imports nothing when it can't find it.
 */
import { MAX_MESSAGE_LENGTH } from '@ogden-agents/shared';
import type { AgentTranscriptTurn } from './agent-port.js';
import type { CompletedMessage } from './entities.js';

/** The mark of a terminal opened on a session the CLI had recorded nothing of: every turn is new. */
export const START_MARK = 'start';

/** The most turns imported on one switch back: the newest (user decision, 2026-10-01). */
export const MAX_IMPORTED_TURNS = 200;

/** The agent note before an import cut to {@link MAX_IMPORTED_TURNS} (user decision, 2026-10-01). */
export const omittedNote = (count: number): string =>
  count === 1 ? '1 earlier terminal message was not imported' : `${count} earlier terminal messages were not imported`;

export interface TerminalImport {
  /** The turns to append, oldest first, each text cut to {@link MAX_MESSAGE_LENGTH}. */
  turns: AgentTranscriptTurn[];
  /** How many older turns were left out by {@link MAX_IMPORTED_TURNS}. */
  omitted: number;
  /** No mark, and the chat's last user message isn't among the CLI's turns: nothing is imported. */
  unaligned: boolean;
}

const lastIndexOf = <T>(items: readonly T[], test: (item: T) => boolean): number => {
  for (let at = items.length - 1; at >= 0; at--) if (test(items[at]!)) return at;
  return -1;
};

/** The index after the turns of the exchange at `at` (a user message and the reply to it share an id). */
const endOfExchange = (turns: readonly AgentTranscriptTurn[], at: number): number => {
  let end = at;
  while (end < turns.length && turns[end]!.id === turns[at]!.id) end++;
  return end;
};

/**
 * The turns of `turns` (the CLI's, oldest first) to append after `stored`
 * (the chat's completed messages, oldest first), given the mark `after`
 * saved when the terminal opened (`undefined` or `''` when none was).
 */
export function turnsToImport(stored: readonly CompletedMessage[], turns: readonly AgentTranscriptTurn[], after?: string): TerminalImport {
  let from: number | undefined;
  if (after === START_MARK) from = 0;
  else if (after !== undefined && after !== '') {
    const at = lastIndexOf(turns, (turn) => turn.id === after);
    if (at !== -1) from = at + 1;
  }
  if (from === undefined) {
    // No usable mark: after the chat's last user message, found among the CLI's.
    const typed = stored.findLast((message) => message.role === 'user')?.content.trim();
    const at = typed === undefined || typed === '' ? -1 : lastIndexOf(turns, (turn) => turn.role === 'user' && turn.text.trim() === typed);
    if (at === -1) return { turns: [], omitted: 0, unaligned: true };
    from = endOfExchange(turns, at);
  }
  const rest = turns.slice(from);
  const omitted = Math.max(0, rest.length - MAX_IMPORTED_TURNS);
  return {
    turns: rest
      .slice(omitted)
      .map((turn) => (turn.text.length > MAX_MESSAGE_LENGTH ? { ...turn, text: turn.text.slice(0, MAX_MESSAGE_LENGTH) } : turn)),
    omitted,
    unaligned: false,
  };
}
