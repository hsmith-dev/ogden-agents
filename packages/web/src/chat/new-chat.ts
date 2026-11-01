import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { focusComposer } from './focus-composer';

/**
 * New chat in one step (epic 26, E26-R2): every way in (`g n`, the desktop
 * app's File > New Chat, a chat header's button, the Chats list's New chat,
 * and entry 3's palette) opens the project's new-chat draft, `/w/:wsId/new`,
 * through {@link useOpenNewChat}. The draft becomes a chat only on its first
 * message.
 */

/**
 * The page event the desktop shell dispatches for File > New Chat
 * (Cmd/Ctrl+N). AD-15: the page has no IPC, so the shell evaluates one fixed
 * script, `window.dispatchEvent(new Event('<this>'))`, and the page opens the
 * draft when it is inside a project. A browser never fires it.
 */
export const NEW_CHAT_EVENT = 'ogden-agents:new-chat';

/** What the draft starts with: the agent and machine picked on the Chats list. */
export interface NewChatPick {
  agent?: string | undefined;
  machine?: string | undefined;
}

/** The draft's search: the picks it opens with, strings only. */
export interface NewChatSearch {
  agent?: string;
  machine?: string;
}

/** Keeps only the string `agent` and `machine` of a search. */
export function newChatSearch(search: Record<string, unknown>): NewChatSearch {
  return {
    ...(typeof search.agent === 'string' && search.agent !== '' ? { agent: search.agent } : {}),
    ...(typeof search.machine === 'string' && search.machine !== '' ? { machine: search.machine } : {}),
  };
}

/** Where a new chat in `wsId` opens: the draft, with the picks (if any) in its search. */
export function newChatTarget(wsId: string, pick?: NewChatPick) {
  return { to: '/w/$wsId/new' as const, params: { wsId }, search: newChatSearch({ ...pick }) };
}

/** The draft's path for `wsId`, as the router's location shows it. */
const newChatPath = (wsId: string): string => `/w/${encodeURIComponent(wsId)}/new`;

/**
 * The one opener: navigates to the draft. A fresh draft focuses its own
 * composer (`autoFocus`); only a draft that was already open has the cursor
 * put back in it, so nothing else (a dialog, a menu) loses focus to it.
 */
export function useOpenNewChat() {
  const navigate = useNavigate();
  return useCallback(
    (wsId: string, pick?: NewChatPick) => {
      const alreadyOpen = window.location.pathname.replace(/\/$/, '') === newChatPath(wsId);
      navigate(newChatTarget(wsId, pick)).then(
        () => {
          if (alreadyOpen) requestAnimationFrame(() => focusComposer());
        },
        () => undefined,
      );
    },
    [navigate],
  );
}
