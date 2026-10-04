import { useQuery } from '@tanstack/react-query';
import { CHAT_AGENTS_QUERY_KEY, fetchChatAgents } from './chat-api';

/** The agents a chat can be started with (epic 6), read once per server run. */
export function useChatAgents() {
  return useQuery({ queryKey: CHAT_AGENTS_QUERY_KEY, queryFn: () => fetchChatAgents(), staleTime: Number.POSITIVE_INFINITY, retry: 1 });
}
