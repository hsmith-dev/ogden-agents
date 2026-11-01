import { House } from '@phosphor-icons/react';
import { RemoteMachineId, type Session } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AgentPicker } from '@/chat/agent-picker';
import { agentNameOf, ChatApiError, createChatSession, sendMessage } from '@/chat/chat-api';
import { Composer } from '@/chat/composer';
import { newChatDraftKey } from '@/chat/drafts';
import type { NewChatSearch } from '@/chat/new-chat';
import { AGENT_UNAVAILABLE_ID, NewChatAgentStatus, useNewChatAgent } from '@/chat/new-chat-agent';
import { MachinePicker } from '@/remote-machines/machine-picker';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody, PageFooter } from '@/ui/page';
import { Text } from '@/ui/typography';
import { fetchWorkspace } from '@/workspaces/workspace-api';

/**
 * `/w/:wsId/new`: the new-chat draft (epic 26, E26-R2; EXPERIENCE.md New
 * chat). An empty area and the composer, focused, with the agent and machine
 * pickers in its footer. The chat exists only once the first message is
 * sent, so leaving it unsent leaves nothing behind; the unsent text is kept
 * as the project's new-chat draft (shared with the empty project's
 * composer). A first send that fails keeps the chat it made, and the retry
 * goes to that chat (2.5 F6).
 */
export function NewChatPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const search = useSearch({ strict: false }) as NewChatSearch;
  // One draft per project: the router reuses this component from /w/A/new to /w/B/new.
  return <NewChatDraft key={wsId} wsId={wsId} search={search} />;
}

function NewChatDraft({ wsId, search }: { wsId: string; search: NewChatSearch }) {
  const navigate = useNavigate();
  const workspace = useQuery({ queryKey: ['workspace', wsId], queryFn: () => fetchWorkspace(wsId), retry: false });
  // The picks it opened with (the Chats list's), read once: `g n` here keeps what was picked.
  const initialMachine = RemoteMachineId.safeParse(search.machine);
  const { chatAgents, settings, agentId, setPickedAgent, pickedMachine, setPickedMachine, chosen, blocked } = useNewChatAgent(wsId, {
    agent: search.agent,
    machine: initialMachine.success ? initialMachine.data : null,
  });
  /** The chat the first send made: a retry after a failed send reuses it, never leaving a second one behind (2.5 F6). */
  const firstChat = useRef<Session | undefined>(undefined);
  // A send still on its way when the user left (another project, `g n`, Cmd/Ctrl+N) never pulls them back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const missing = workspace.error instanceof ChatApiError && workspace.error.status === 404;
  const agentName = agentNameOf(chatAgents.data, agentId);

  const onSend = async (text: string) => {
    const made = firstChat.current;
    // A chat made for another agent or machine is not reused for this one.
    const reuse = made !== undefined && (agentId === undefined || made.agentId === undefined || made.agentId === agentId) && made.machineId === pickedMachine;
    const session = reuse ? made : await createChatSession(wsId, undefined, agentId, undefined, pickedMachine);
    firstChat.current = session;
    await sendMessage(wsId, session.id, text);
    if (mounted.current) await navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: session.id } });
  };

  if (missing) {
    return (
      <>
        <WorkspaceHeader title="New chat" />
        <PageBody data-testid="new-chat-page">
          <EmptyState
            data-testid="workspace-not-found"
            title="There is no such project."
            description="Add it again to start a chat in it."
            actions={
              <Button asChild variant="outline">
                <Link to="/">
                  <House aria-hidden />
                  Go to projects
                </Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader title="New chat" wsId={wsId} />
      <PageBody data-testid="new-chat-page">
        <div className="flex max-w-(--space-chat-column) flex-col gap-4">
          {chatAgents.data === undefined || agentId === undefined ? null : (
            <Text variant="caption" data-testid="new-chat-hint">{`Ask ${agentName} about this project.`}</Text>
          )}
          <NewChatAgentStatus wsId={wsId} blocked={blocked} chosen={chosen} trustChanged={settings.data?.bmadScriptsTrusted === true} />
        </div>
      </PageBody>
      <PageFooter>
        <Composer
          label={`Message ${agentName}`}
          // The reason is the status line above, tied to the field; a send still goes to the server, which says why.
          describedBy={blocked === undefined ? undefined : AGENT_UNAVAILABLE_ID}
          draftKey={newChatDraftKey(wsId)}
          footer={
            chatAgents.data === undefined || agentId === undefined ? undefined : (
              <>
                <AgentPicker agents={chatAgents.data.agents} value={agentId} onChange={setPickedAgent} />
                <MachinePicker value={pickedMachine} onChange={setPickedMachine} />
              </>
            )
          }
          onSend={onSend}
        />
      </PageFooter>
    </>
  );
}
