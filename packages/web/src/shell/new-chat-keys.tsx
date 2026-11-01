import { useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { NEW_CHAT_EVENT, useOpenNewChat } from '@/chat/new-chat';
import { useGoKeys } from './use-go-shortcuts';

/**
 * New chat from the keyboard inside a project (epic 26, E26-R2): `g n`, and
 * the desktop app's File > New Chat (Cmd/Ctrl+N), which reaches the page as
 * {@link NEW_CHAT_EVENT} (AD-15: no IPC). Both open the project's new-chat
 * draft; outside a project they do nothing (entry 3's palette takes that).
 * A browser tab never gets the event, so it keeps Cmd/Ctrl+N for itself.
 * Mounted once per tab in the shell.
 */
export function NewChatKeys() {
  const { wsId } = useParams({ strict: false }) as { wsId?: string };
  const openNewChat = useOpenNewChat();
  const current = useRef({ wsId, openNewChat });
  current.current = { wsId, openNewChat };
  useGoKeys(wsId === undefined ? [] : [{ key: 'n', run: () => openNewChat(wsId) }]);
  useEffect(() => {
    const onNewChat = () => {
      const { wsId: inProject, openNewChat: open } = current.current;
      if (inProject !== undefined) open(inProject);
    };
    window.addEventListener(NEW_CHAT_EVENT, onNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNewChat);
  }, []);
  return null;
}
