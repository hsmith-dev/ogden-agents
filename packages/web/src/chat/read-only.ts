import { createContext, useContext } from 'react';

/**
 * Whether the conversation is read-only (story 3.6 review F2): true while the
 * agent's own terminal drives the chat. The conversation stays in the
 * accessibility tree, readable and scrollable; every action in it that would
 * send something (a permission card's answers, Undo Always allow, Stop, Try
 * again) is `aria-disabled` with no handler.
 */
export const ReadOnlyConversation = createContext(false);

export const useReadOnlyConversation = (): boolean => useContext(ReadOnlyConversation);
