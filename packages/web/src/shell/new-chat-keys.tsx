import { useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { NEW_CHAT_EVENT, useOpenNewChat } from '@/chat/new-chat';
import { openCommandPalette } from '@/palette/palette-store';
import { focusInsideOverlay } from './keyboard-guard';
import { useGoKeys } from './use-go-shortcuts';

/**
 * New chat from the keyboard inside a project (epic 26, E26-R2): `g n`, and
 * the desktop app's File > New Chat (Cmd/Ctrl+N), which reaches the page as
 * {@link NEW_CHAT_EVENT} (AD-15: no IPC). Both open the project's new-chat
 * draft; outside a project both open the command palette on "New chat in..."
 * (26.3), which lists the projects.
 * A browser tab never gets the event, so it keeps Cmd/Ctrl+N for itself.
 * Mounted once per tab in the shell.
 */
export function NewChatKeys() {
  const { wsId } = useParams({ strict: false }) as { wsId?: string };
  const openNewChat = useOpenNewChat();
  const current = useRef({ wsId, openNewChat });
  current.current = { wsId, openNewChat };
  useGoKeys([{ key: 'n', run: () => (wsId === undefined ? openCommandPalette('new-chat-in') : openNewChat(wsId)) }]);
  useEffect(() => {
    const onNewChat = (event: Event) => {
      const { wsId: inProject, openNewChat: open } = current.current;
      if (inProject !== undefined) open(inProject);
      // Never a second modal over an open dialog or menu (as Cmd/Ctrl+K).
      else if (!focusInsideOverlay(event)) openCommandPalette('new-chat-in');
    };
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, []);
  return null;
}
