import { ChatCircle, GearSix, House } from '@phosphor-icons/react';
import type { Session } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { AgentPicker, SET_UP_AGENTS } from '@/chat/agent-picker';
import { agentNameOf, ChatApiError, createChatSession, sendMessage } from '@/chat/chat-api';
import { Composer } from '@/chat/composer';
import { agentAvailability, projectDefaultAgent, useChatAgents } from '@/chat/use-chat-agents';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';
import { Row, RowList, RowMeta } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { BmadOffer } from '@/workspaces/bmad-offer';
import { fetchWorkspace, useSessions, workspaceName } from '@/workspaces/workspace-api';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

const started = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * `/w/:wsId`: the workspace's Chats list (story 2.5), newest first, each
 * with its live state (AD-4). New chat and Workspace settings sit in the
 * header. With no chats yet the composer is focused and starts one
 * (EXPERIENCE.md Empty chats). The list follows the event stream, so a chat
 * started or a history deleted in any tab shows here without a reload.
 */
export function WorkspaceChatsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const navigate = useNavigate();
  const workspace = useQuery({ queryKey: ['workspace', wsId], queryFn: () => fetchWorkspace(wsId), retry: false });
  const { sessions, error } = useSessions(wsId);
  // The agent a new chat starts with (epic 6): the project's default (entry 6), which follows a change made
  // in another tab, until the user picks another here. Unknown until both the list and the settings are in.
  const chatAgents = useChatAgents();
  const settings = useWorkspaceSettings(wsId);
  const [pickedAgent, setPickedAgent] = useState<string | undefined>(undefined);
  const settingsKnown = settings.data !== undefined || settings.isError;
  const projectDefault = chatAgents.data === undefined || !settingsKnown ? undefined : projectDefaultAgent(chatAgents.data, settings.data?.defaultAgentId);
  const agentId = pickedAgent ?? projectDefault;
  const severalAgents = (chatAgents.data?.agents.length ?? 0) > 1;
  const chosen = chatAgents.data?.agents.find((agent) => agent.agentId === agentId);
  /** Why a new chat with the chosen agent can't start now (not installed, signed out, needs trust), said before trying. */
  const unavailable = chosen === undefined ? undefined : agentAvailability(chosen);
  // Only while there is a choice: with one agent the page is as before, and the server says why a chat can't start.
  const blocked = !severalAgents || unavailable === undefined || unavailable.available ? undefined : unavailable;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  /** The chat the first message created: a retry after a failed send reuses it, never leaving an empty one behind (2.5 F6). */
  const firstChat = useRef<Session | undefined>(undefined);
  const [firstChatId, setFirstChatId] = useState<string | undefined>(undefined);
  // The chat a first send created (and failed in) keeps the empty-state composer, for the retry.
  const onlyFirstChat = sessions !== undefined && sessions.length === 1 && sessions[0]?.id === firstChatId;
  const missing = (workspace.error instanceof ChatApiError && workspace.error.status === 404) || (error instanceof ChatApiError && error.status === 404);

  /** The chats list is empty (or holds only the chat a failed first send made): the composer starts the chat. */
  const listEmpty = sessions === undefined || sessions.length === 0 || onlyFirstChat;

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
    setCreating(true);
    setCreateError(undefined);
    createChatSession(wsId, undefined, agentId).then(
      (session) => openChat(session),
      (failure: unknown) => {
        setCreating(false);
        setCreateError(failure instanceof Error ? failure.message : "Ogden Agents couldn't start a chat. Try again.");
      },
    );
  };

  return (
    <>
      <WorkspaceHeader title="Chats" wsId={missing ? undefined : wsId}>
        {missing ? null : (
          <div className="ml-auto flex items-center gap-2">
            {/* With chats listed, the agent New chat starts with sits beside it (epic 6, entry 6). */}
            {chatAgents.data === undefined || agentId === undefined || listEmpty ? null : <AgentPicker agents={chatAgents.data.agents} value={agentId} onChange={onPick} />}
            <Button variant="ghost" size="icon" asChild>
              <Link to="/w/$wsId/settings" params={{ wsId }} aria-label="Workspace settings" data-testid="workspace-settings-link">
                <GearSix aria-hidden />
              </Link>
            </Button>
            <Button onClick={onNewChat} aria-disabled={creating || blocked !== undefined} aria-describedby={blocked === undefined ? undefined : 'agent-unavailable'} data-testid="new-chat">
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
            {/* Why the chosen agent can't start a chat now, and where to fix it (epic 6, entry 6). */}
            {/* Always mounted, so a change (a pick, or the default changed in another tab) is announced. */}
            <Text variant="caption" id="agent-unavailable" role="status" data-testid="agent-unavailable-status">
              {blocked === undefined ? null : (
                <span data-testid="agent-unavailable">
                  {blocked.description}
                  {blocked.setUp ? (
                    <>
                      {' '}
                      <Button variant="link" size="sm" asChild>
                        <Link to="/settings/agents" data-testid="agent-unavailable-link">
                          {SET_UP_AGENTS}
                        </Link>
                      </Button>
                    </>
                  ) : null}
                </span>
              )}
            </Text>
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
                <EmptyState title="No conversations yet." />
                <Composer
                  label={`Message ${agentNameOf(chatAgents.data, agentId)}`}
                  // The agent picker sits in the composer footer (EXPERIENCE.md Empty chats, DESIGN.md Composer).
                  footer={chatAgents.data === undefined || agentId === undefined ? undefined : <AgentPicker agents={chatAgents.data.agents} value={agentId} onChange={onPick} />}
                  // The reason is the status line above, tied to the field; a send still goes to the server, which says why.
                  describedBy={blocked === undefined ? undefined : 'agent-unavailable'}
                  onSend={async (text) => {
                    const session = firstChat.current ?? (await createChatSession(wsId, undefined, agentId));
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
                  <li key={session.id}>
                    <Row asChild>
                      <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: session.id }} data-testid="chat-row">
                        <StateGlyph state={session.state} labelMode="hidden" data-testid="chat-row-state" />
                        <span className="min-w-0 flex-1 truncate">{session.title ?? 'Chat'}</span>
                        {severalAgents ? <RowMeta data-testid="chat-row-agent">{agentNameOf(chatAgents.data, session.agentId)}</RowMeta> : null}
                        <RowMeta>{started.format(new Date(session.createdAt))}</RowMeta>
                      </Link>
                    </Row>
                  </li>
                ))}
              </RowList>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
