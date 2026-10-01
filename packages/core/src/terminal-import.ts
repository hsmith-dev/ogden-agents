/**
 * The turns typed in the agent's own terminal that the chat's transcript
 * lacks (CAP-5, E3-R4): after switching back, core reads the session's
 * conversation as the CLI recorded it (`AgentTerminalResume.transcript`)
 * and appends what this returns as completed messages, the user's marked
 * `origin: 'terminal'`.
 *
 * Story 3.2's stub imports nothing; story 3.3 owns this file and decides how
 * the stored transcript and the CLI's turns line up.
 */
import type { AgentTranscriptTurn } from './agent-port.js';
import type { CompletedMessage } from './entities.js';

/** The turns of `turns` (the CLI's, oldest first) to append after `stored` (the chat's completed messages, oldest first), in order. */
export function turnsToImport(stored: readonly CompletedMessage[], turns: readonly AgentTranscriptTurn[]): AgentTranscriptTurn[] {
  // Story 3.2's stub: nothing is imported yet (3.3).
  return [];
}
