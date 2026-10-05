import { ChatCircle } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { START_A_CHAT, useStartChat } from '@/chat/start-chat';
import { agentAvailability, projectDefaultAgent, useChatAgents } from '@/chat/use-chat-agents';
import { SidebarLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarText, useSidebar } from '@/ui/sidebar';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * A project with no chats, in the sidebar (EXPERIENCE.md Status sidebar):
 * one row, Start a chat, that starts a chat with the project's default agent
 * and opens it, the same as the empty Chats page's primary action. When it
 * can't start one from here (the agents or the project's settings aren't
 * known yet, or the default agent can't start a chat while there is a
 * choice), it opens the project's Chats page, which says why.
 */
export function SidebarStartChat({ wsId, name }: { wsId: string; name: string }) {
  const chatAgents = useChatAgents();
  const settings = useWorkspaceSettings(wsId);
  const { setSheetOpen } = useSidebar();
  // The chat that opens closes the sheet (below md); a failure keeps it open, said where the click landed.
  const { start, starting, error } = useStartChat(wsId, () => setSheetOpen(false));
  const navigate = useNavigate();
  const settingsKnown = settings.data !== undefined || settings.isError;
  const list = chatAgents.data;
  const agentId = list === undefined || !settingsKnown ? undefined : projectDefaultAgent(list, settings.data?.defaultAgentId);
  const chosen = list?.agents.find((agent) => agent.agentId === agentId);
  // A default that can't start a chat: its Chats page says why (with one agent too, the server's reason on Start a chat).
  const blocked = chosen !== undefined && !agentAvailability(chosen).available;
  const label = `${START_A_CHAT} in ${name}`;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          data-testid="sidebar-start-chat"
          tooltip={label}
          aria-label={label}
          aria-disabled={starting || undefined}
          aria-busy={starting || undefined}
          onClick={(event) => {
            if (starting) {
              event.preventDefault();
              return;
            }
            if (agentId === undefined || blocked) {
              void navigate({ to: '/w/$wsId', params: { wsId } });
              return;
            }
            event.preventDefault();
            start(agentId);
          }}
        >
          <ChatCircle aria-hidden />
          <SidebarLabel>{START_A_CHAT}</SidebarLabel>
        </SidebarMenuButton>
        <span role="status" className="sr-only">
          {starting ? 'Starting a chat' : ''}
        </span>
        {error === undefined ? null : (
          <SidebarText role="alert" data-testid="sidebar-start-chat-error" className="md:max-lg:sr-only md:max-lg:block">
            {error}
          </SidebarText>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
