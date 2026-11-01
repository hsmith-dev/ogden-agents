/**
 * When a chat's header actions can be taken (27.9, moved out of the chat
 * page): Continue with another agent, Delete chat (27.3) and the hand-off
 * between this folder and its own worktree (27.4). Each answer is
 * `undefined` when the action can be taken now, else its one-sentence
 * reason, which the menu item shows disabled.
 */
import {
  chatPlaceOf,
  DELETE_CHAT_NOT_DELETABLE_TEXT,
  DELETE_CHAT_REMOTE_TEXT,
  DELETE_CHAT_TERMINAL_TEXT,
  deleteChatBusyText,
  HANDOFF_PUT_AWAY_TEXT,
  handOffMidTurnText,
  type Session,
  type SessionState,
} from '@ogden-agents/shared';

/** What every chat action reads: the agent's name, the chat's state, and who drives it. */
export interface ChatActionState {
  agentName: string;
  /** The chat's state, `undefined` until it is known. */
  state: SessionState | undefined;
  /** The terminal drives the chat. */
  terminalDrives: boolean;
  /** The chat is switching to or from the terminal. */
  switching: boolean;
}

const SWITCHING_TEXT = 'This chat is switching to or from the terminal.';

const busy = (state: SessionState | undefined): boolean => state === 'working' || state === 'waiting';

/** Continue with another agent: while the chat is idle or in error and the chat drives it. */
export function continueBlockedReason({ agentName, state, terminalDrives, switching }: ChatActionState): string | undefined {
  if (terminalDrives) return DELETE_CHAT_TERMINAL_TEXT;
  if (switching) return SWITCHING_TEXT;
  if (state === 'waiting') return `${agentName} is waiting for your answer. Answer it or stop it first.`;
  if (state === 'working') return `${agentName} is working. Stop it first.`;
  if (state === 'done') return 'This chat is finished.';
  return undefined;
}

/** Delete chat (27.3): a plain local chat only (a planning or remote one says why), never mid-turn, switching or while the terminal drives. */
export function deleteBlockedReason(session: Pick<Session, 'kind' | 'machineId'> | undefined, { agentName, state, terminalDrives, switching }: ChatActionState): string | undefined {
  if (session?.kind !== 'chat') return DELETE_CHAT_NOT_DELETABLE_TEXT;
  if (chatPlaceOf(session) === 'remote') return DELETE_CHAT_REMOTE_TEXT;
  if (terminalDrives) return DELETE_CHAT_TERMINAL_TEXT;
  if (busy(state) || switching) return deleteChatBusyText(agentName);
  return undefined;
}

/** Hand off (27.4): never while the chat's copy is put away (27.6), the terminal drives, it switches, or mid-turn. */
export function moveBlockedReason(putAway: boolean, { agentName, state, terminalDrives, switching }: ChatActionState): string | undefined {
  if (putAway) return HANDOFF_PUT_AWAY_TEXT;
  if (terminalDrives) return DELETE_CHAT_TERMINAL_TEXT;
  if (switching) return SWITCHING_TEXT;
  if (busy(state)) return handOffMidTurnText(agentName);
  return undefined;
}
