import { z } from 'zod';

/**
 * Chat names (backlog story 2): every chat has a name. The user's own name
 * (`Session.title`) wins; else the automatic one core set once (`autoTitle`:
 * the planning action's label, or the first message); else "New chat".
 * Names are plain text: these rules run on the server for every name it
 * stores and in the UI before it sends one, and the UI shows a name only as
 * text.
 */

/** The longest name a user can give a chat, after {@link normalizeChatName}. */
export const CHAT_NAME_MAX = 80;

/** The longest automatic name, ellipsis included. */
export const AUTO_CHAT_NAME_MAX = 60;

/** What a chat with no name and no message yet is called. */
export const NEW_CHAT_NAME = 'New chat';

/** The refusal for a name over {@link CHAT_NAME_MAX} characters. */
export const CHAT_NAME_TOO_LONG = `A chat name can be at most ${CHAT_NAME_MAX} characters.`;

/** Control and invisible formatting characters (bidirectional overrides, zero width ones), removed from every name. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\u034f\u115f\u1160\u3164\uffa0\u2800]/gu;

/** More than this many combining marks on one character are dropped (stacked "zalgo" text); real scripts need fewer. */
const MAX_MARKS = 3;
const STACKED_MARKS = new RegExp(`(\\p{M}{${MAX_MARKS}})\\p{M}+`, 'gu');

/** Characters, counted as the user sees them (a surrogate pair is one). */
const length = (text: string) => [...text].length;

/**
 * A name as it is stored: control and formatting characters removed, every
 * run of white space one space, the ends trimmed. `null` when nothing is
 * left: the chat shows its automatic name. Line breaks become spaces, so a
 * name is always one line.
 */
export function normalizeChatName(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  const clean = name.replace(/[\r\n\t\u2028\u2029]/g, ' ').replace(UNSEEN, '').replace(STACKED_MARKS, '$1').replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean;
}

/** Whether a normalized name is short enough to store. */
export const chatNameFits = (name: string): boolean => length(name) <= CHAT_NAME_MAX;

/**
 * The automatic name a message gives a chat: the text on one line, cut to
 * {@link AUTO_CHAT_NAME_MAX} characters at a word break where there is one,
 * with an ellipsis when cut. `null` for a message with no visible text.
 */
export function autoChatName(text: string, max = AUTO_CHAT_NAME_MAX): string | null {
  const clean = normalizeChatName(text);
  if (clean === null) return null;
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  // A word break in the last third keeps whole words; otherwise cut mid word.
  const kept = space >= Math.floor((max - 1) * 0.66) ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}…`;
}

/** The name a chat shows: the user's, else the automatic one, else "New chat". */
export function chatName(session: { title?: string | null | undefined; autoTitle?: string | null | undefined }): string {
  return session.title ?? session.autoTitle ?? NEW_CHAT_NAME;
}

/**
 * `PUT /api/v1/workspaces/:wsId/sessions/:sesId/title`: the user's name for
 * the chat; `null` or a blank name clears it (the automatic one shows). The
 * raw string is bounded here; the server normalizes it and refuses one over
 * {@link CHAT_NAME_MAX} characters.
 */
export const RenameSessionRequest = z.object({ title: z.string().max(2000, CHAT_NAME_TOO_LONG).nullable() });
export type RenameSessionRequest = z.infer<typeof RenameSessionRequest>;

/** Why a chat's name changed: the user renamed it, or core named it automatically. */
export const SessionRenameCause = z.enum(['user', 'auto']);
export type SessionRenameCause = z.infer<typeof SessionRenameCause>;
