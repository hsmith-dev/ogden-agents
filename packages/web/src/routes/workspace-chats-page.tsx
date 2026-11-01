import { ChatCircle, GearSix, House } from '@phosphor-icons/react';
import type { Session } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { AgentPicker } from '@/chat/agent-picker';
import { agentNameOf, ChatApiError, createChatSession, sendMessage } from '@/chat/chat-api';
import { ChatListRow } from '@/chat/chat-row';
import { Composer } from '@/chat/composer';
import { StartChatActions, useStartChat } from '@/chat/start-chat';
import { newChatDraftKey } from '@/chat/drafts';
import { useOpenNewChat } from '@/chat/new-chat';
import { AGENT_UNAVAILABLE_ID, NewChatAgentStatus, useNewChatAgent } from '@/chat/new-chat-agent';
import { MachinePicker } from '@/remote-machines/machine-picker';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';
import { RowList, RowMeta } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { BmadOffer } from '@/workspaces/bmad-offer';
import { fetchWorkspace, useSessions, workspaceName } from '@/workspaces/workspace-api';

const started = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * `/w/:wsId`: the workspace's Chats list (story 2.5), newest first, each
 * with its live state (AD-4). New chat and Workspace settings sit in the
 * header; New chat opens the new-chat draft with the agent and machine picked
 * beside it (epic 26), so trying it leaves no empty chat behind. With no chats yet the page says so, with Start a chat as its one
 * primary action (the project's default agent), Use another agent while
 * there is a choice, and the composer focused as the second way in
 * (EXPERIENCE.md Empty chats). The list follows the event stream, so a chat
 * started or a history deleted in any tab shows here without a reload.
 */
export function WorkspaceChatsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  // One page per project: the router reuses this component from /w/A to /w/B, and a pick, a first chat or an error is that project's.
  return <ChatsPage key={wsId} wsId={wsId} />;
}

function ChatsPage({ wsId }: { wsId: string }) {
  const navigate = useNavigate();
  const workspace = useQuery({ queryKey: ['workspace', wsId], queryFn: () => fetchWorkspace(wsId), retry: false });
  const { sessions, error } = useSessions(wsId);
  // The agent and machine New chat opens the draft with (epic 6; CAP-24, 19.7), shared with the draft (epic 26).
  const { chatAgents, settings, agentId, setPickedAgent, pickedAgent, pickedMachine, setPickedMachine, severalAgents, chosen, blocked } = useNewChatAgent(wsId);
  const openNewChat = useOpenNewChat();
  const { start, starting: creating, error: createError, setError: setCreateError } = useStartChat(wsId);
  /** The chat the first message created: a retry after a failed send reuses it, never leaving an empty one behind (2.5 F6). */
  const firstChat = useRef<Session | undefined>(undefined);
  const [firstChatId, setFirstChatId] = useState<string | undefined>(undefined);
  // The chat a first send created (and failed in) keeps the empty-state composer, for the retry.
  const onlyFirstChat = sessions !== undefined && sessions.length === 1 && sessions[0]?.id === firstChatId;
  const missing = (workspace.error instanceof ChatApiError && workspace.error.status === 404) || (error instanceof ChatApiError && error.status === 404);

  /** The chats list is empty (or holds only the chat a failed first send made): the composer starts the chat. */
  const listEmpty = sessions === undefined || sessions.length === 0 || onlyFirstChat;
  /** The empty state's Start a chat is shown: the list is empty and the agent it uses is known. */
  const startShown = sessions !== undefined && listEmpty && chatAgents.data !== undefined && agentId !== undefined;

  const onPick = (next: string) => {
    setPickedAgent(next);
    // A first chat made for another agent is not reused for this one.
    if (firstChat.current !== undefined && firstChat.current.agentId !== next) firstChat.current = undefined;
  };

  const openChat = (session: Session) => navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: session.id } });

  const onNewChat = () => {
    if (creating) return;
    if (blocked !== undefined) {
      // Said where the click lands too (role="alert"), not only in the status line.
      setCreateError(blocked.description);
      return;
    }
    // The draft (epic 26): the chat exists only once its first message is sent.
    openNewChat(wsId, { agent: pickedAgent, machine: pickedMachine ?? undefined });
  };

  return (
    <>
      <WorkspaceHeader title="Chats" wsId={missing ? undefined : wsId}>
        {missing ? null : (
          <div className="ml-auto flex items-center gap-2">
            {/* With chats listed, the agent New chat starts with sits beside it (epic 6, entry 6). */}
            {chatAgents.data === undefined || agentId === undefined || listEmpty ? null : (
              <>
                <AgentPicker agents={chatAgents.data.agents} value={agentId} onChange={onPick} />
                {/* The machine it runs on (CAP-24, epic 19 story 19.7), beside the agent it runs with. */}
                <MachinePicker value={pickedMachine} onChange={setPickedMachine} />
              </>
            )}
            <Button variant="ghost" size="icon" asChild>
              <Link to="/w/$wsId/settings" params={{ wsId }} aria-label="Workspace settings" data-testid="workspace-settings-link">
                <GearSix aria-hidden />
              </Link>
            </Button>
            {/* While the list is empty, Start a chat in the page is the one primary action. */}
            <Button
              variant={startShown ? 'outline' : 'primary'}
              onClick={onNewChat}
              aria-disabled={creating || blocked !== undefined} aria-describedby={blocked === undefined ? undefined : AGENT_UNAVAILABLE_ID} data-testid="new-chat">
              <ChatCircle aria-hidden />
              New chat
            </Button>
          </div>
        )}
      </WorkspaceHeader>
      <PageBody data-testid="workspace-chats-page">
        {missing ? (
          <EmptyState
            data-testid="workspace-not-found"
            title="There is no such project."
            description="Add it again to see its chats here."
            actions={
              <Button asChild variant="outline">
                <Link to="/">
                  <House aria-hidden />
                  Go to projects
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            {workspace.data === undefined ? null : (
              <Text variant="caption" data-testid="workspace-name" title={workspace.data.realPath}>
                {workspaceName(workspace.data)}
              </Text>
            )}
            {/* Why the chosen agent can't start a chat now, and the trust prompt that fixes one (epic 6, entry 6; epic 12, 12.3). */}
            <NewChatAgentStatus wsId={wsId} blocked={blocked} chosen={chosen} trustChanged={settings.data?.bmadScriptsTrusted === true} />
            {/* The "already uses BMad Method" offer (story 10.3): detected when this page opens, never when the project is added. */}
            {workspace.data === undefined ? null : <BmadOffer key={wsId} wsId={wsId} />}
            {createError === undefined ? null : (
              <Text variant="caption" role="alert">
                {createError}
              </Text>
            )}
            {error !== null ? (
              <Text variant="caption" role="alert">
                {error.message}
              </Text>
            ) : sessions === undefined ? (
              <div className="flex flex-col gap-2">
                <Skeleton />
                <Skeleton />
                <span role="status" className="sr-only">
                  Loading the chats
                </span>
              </div>
            ) : sessions.length === 0 || onlyFirstChat ? (
              <div className="flex max-w-(--space-chat-column) flex-col gap-4" data-testid="chats-empty">
                <EmptyState
                  title="No conversations yet."
                  description={
                    chatAgents.data === undefined || agentId === undefined
                      ? undefined
                      : `Start a chat with ${agentNameOf(chatAgents.data, agentId)} to work on this project, or write your first message below.`
                  }
                  actions={
                    !startShown || chatAgents.data === undefined ? undefined : (
                      <StartChatActions
                        agents={chatAgents.data.agents}
                        agentId={agentId}
                        blocked={blocked}
                        describedBy={AGENT_UNAVAILABLE_ID}
                        starting={creating}
                        // A failed first send already made this agent's chat (2.5 F6): open that one, never a second empty chat.
                        onStart={(next) => (firstChat.current !== undefined && firstChat.current.agentId === next ? void openChat(firstChat.current) : start(next))}
                        onBlocked={setCreateError}
                      />
                    )
                  }
                />
                {/* The second way in: the first message starts the chat with the agent named above. Use another agent is the one chooser here. */}
                <Composer
                  label={`Message ${agentNameOf(chatAgents.data, agentId)}`}
                  // The reason is the status line above, tied to the field; a send still goes to the server, which says why.
                  describedBy={blocked === undefined ? undefined : AGENT_UNAVAILABLE_ID}
                  draftKey={newChatDraftKey(wsId)}
                  onSend={async (text) => {
                    const session = firstChat.current ?? (await createChatSession(wsId, undefined, agentId, undefined, pickedMachine));
                    firstChat.current = session;
                    setFirstChatId(session.id);
                    await sendMessage(wsId, session.id, text);
                    await openChat(session);
                  }}
                />
              </div>
            ) : (
              <RowList aria-label="Chats" data-testid="chat-list" className="max-w-(--space-chat-column)">
                {sessions.map((session) => (
                  <ChatListRow
                    key={session.id}
                    wsId={wsId}
                    session={session}
                    meta={
                      <>
                        {severalAgents ? <RowMeta data-testid="chat-row-agent">{agentNameOf(chatAgents.data, session.agentId)}</RowMeta> : null}
                        <RowMeta>{started.format(new Date(session.createdAt))}</RowMeta>
                      </>
                    }
                  />
                ))}
              </RowList>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
