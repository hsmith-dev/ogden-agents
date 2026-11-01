import { House } from '@phosphor-icons/react';
import { RemoteMachineId, type ChatLocation, type PermissionMode, type Session } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { AgentPicker } from '@/chat/agent-picker';
import { agentNameOf, ChatApiError, createChatSession, sendMessage, setPermissionMode } from '@/chat/chat-api';
import { Composer } from '@/chat/composer';
import { newChatDraftKey } from '@/chat/drafts';
import { agentDefaultLabel, ModelMenu, modelLabel } from '@/chat/model-picker';
import type { NewChatSearch } from '@/chat/new-chat';
import { AGENT_UNAVAILABLE_ID, NewChatAgentStatus, useNewChatAgent } from '@/chat/new-chat-agent';
import { LocationChip, SETUP_CHIP_CLASS } from '@/chat/setup-row';
import { draftModeOptions, PermissionModePicker } from '@/permissions/permission-mode-picker';
import { useRemoteMachines } from '@/remote-machines/remote-machines-api';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { EmptyState, PageBody, PageFooter } from '@/ui/page';
import { Text } from '@/ui/typography';
import { fetchWorkspace } from '@/workspaces/workspace-api';

/**
 * `/w/:wsId/new`: the new-chat draft (epic 26, E26-R2; EXPERIENCE.md New
 * chat). An empty area and the composer, focused, with its setup row (epic
 * 27, 27.1): Agent, Model, Mode and Location chips on the project's
 * defaults; Location also lists the remote machines (27.5), and a machine
 * opened with (`?machine=`, the Chats list's) starts picked when it is
 * confirmed. The chat exists only once the first message is
 * sent, so leaving it unsent leaves nothing behind; the unsent text is kept
 * as the project's new-chat draft (shared with the empty project's
 * composer). A first send creates the chat with the row's agent, model and
 * place, then sets a picked mode through the set-mode route (so Skip all
 * keeps Developer mode and its confirmation), then sends. A first send that
 * fails keeps the chat it made, and the retry goes to that chat (2.5 F6)
 * when it still matches the row.
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
  const { appearance } = useAppearance();

  // The setup row's picks (27.1), for this agent: a model and a mode are the agent's own, so a new agent starts on its defaults.
  const [picks, setPicks] = useState<{ agentId: string | undefined; model?: string | null; mode?: { mode: PermissionMode; confirmed: boolean } }>({ agentId });
  const ownPicks = picks.agentId === agentId ? picks : { agentId };
  const [location, setLocation] = useState<ChatLocation>('this_folder');
  // One place (27.5): This folder, Worktree or a machine, never Worktree and a machine together.
  // A machine it opened with that isn't a confirmed one (a stale link) is This folder, once the machines are read.
  const machines = useRemoteMachines();
  const machine = pickedMachine === null || machines.data === undefined || machines.data.some((each) => each.id === pickedMachine && each.hostKeyConfirmed) ? pickedMachine : null;
  const effectiveLocation: ChatLocation = machine === null ? location : 'this_folder';
  // The chosen agent runs only on this computer: said before the send, which the server refuses (27.5).
  const localOnlyConflict = machine === null ? undefined : chosen?.localOnly;
  const modeOptions = draftModeOptions(chosen, appearance.developerMode);
  // The project's starting mode, as the server will start the chat in it (an unconfirmed Skip all, or a mode the agent lacks, is Ask).
  const projectMode = settings.data?.defaultPermissionModeNotice === 'skip_all_unconfirmed' ? 'ask' : (settings.data?.defaultPermissionMode ?? 'ask');
  const defaultMode: PermissionMode = modeOptions.find((option) => option.mode === projectMode)?.available === true ? projectMode : 'ask';
  const draftMode = ownPicks.mode?.mode ?? defaultMode;
  // The model it starts on: the one picked, else the project's default for the agent, else the install's, else the agent's own choice.
  const defaultModel = (agentId === undefined ? undefined : settings.data?.defaultModels?.[agentId]) ?? chosen?.defaultModel ?? null;
  const draftModel = ownPicks.model !== undefined ? ownPicks.model : defaultModel;
  const modelText = draftModel === null ? agentDefaultLabel(agentName) : modelLabel(chosen?.models, draftModel);

  const onSend = async (text: string) => {
    const made = firstChat.current;
    // A chat made for another agent, machine, model or place is not reused for this one.
    const reuse =
      made !== undefined &&
      (agentId === undefined || made.agentId === undefined || made.agentId === agentId) &&
      made.machineId === machine &&
      (made.worktreePath !== null) === (effectiveLocation === 'worktree') &&
      (ownPicks.model === undefined || (made.model ?? null) === ownPicks.model);
    let session = reuse ? made : await createChatSession(wsId, undefined, agentId, ownPicks.model, machine, effectiveLocation);
    firstChat.current = session;
    // A picked mode goes through the set-mode route once the chat exists: a refusal is shown, and the retry reuses this chat.
    const picked = ownPicks.mode;
    if (picked !== undefined && session.permissionMode !== picked.mode) {
      session = (await setPermissionMode(wsId, session.id, picked.mode, picked.confirmed)).session;
      firstChat.current = session;
    }
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
          <NewChatAgentStatus wsId={wsId} blocked={blocked} chosen={chosen} trustChanged={settings.data?.bmadScriptsTrusted === true} localOnlyConflict={localOnlyConflict} />
        </div>
      </PageBody>
      <PageFooter>
        <Composer
          label={`Message ${agentName}`}
          // The reason is the status line above, tied to the field; a send still goes to the server, which says why.
          describedBy={blocked === undefined && localOnlyConflict === undefined ? undefined : AGENT_UNAVAILABLE_ID}
          draftKey={newChatDraftKey(wsId)}
          footer={
            chatAgents.data === undefined || agentId === undefined ? undefined : (
              <>
                <AgentPicker agents={chatAgents.data.agents} value={agentId} onChange={setPickedAgent} className={SETUP_CHIP_CLASS} />
                <ModelMenu
                  testId="model-picker"
                  title="Model for the new chat"
                  ariaLabel={`Model: ${modelText}`}
                  prefix="Model:"
                  text={modelText}
                  models={chosen?.models ?? null}
                  value={draftModel}
                  none={{ label: agentDefaultLabel(agentName), description: `${agentName} picks the model itself.` }}
                  emptyText={`${agentName}'s models appear here once it has started in a chat.`}
                  busy={false}
                  onChoose={(model) => setPicks({ ...ownPicks, model })}
                  className={SETUP_CHIP_CLASS}
                />
                <PermissionModePicker
                  agentName={agentName}
                  mode={draftMode}
                  options={modeOptions}
                  developerMode={appearance.developerMode}
                  terminalDrives={false}
                  changing={false}
                  title="Permission mode for the new chat"
                  confirmTitle="Skip all permission checks in the new chat?"
                  onChoose={(mode, confirmed) => setPicks({ ...ownPicks, mode: { mode, confirmed } })}
                />
                <LocationChip
                  value={effectiveLocation}
                  machineId={machine}
                  localOnlyReason={chosen?.localOnly}
                  onChange={(place) => {
                    setLocation(place.location);
                    setPickedMachine(place.machineId);
                  }}
                />
              </>
            )
          }
          onSend={onSend}
        />
      </PageFooter>
    </>
  );
}
