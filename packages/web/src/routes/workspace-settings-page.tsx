import { CAUTION_LEVELS, PERMISSION_MODE_LABELS, type CautionLevel, type PermissionMode, type PermissionRule } from '@ogden-agents/shared';
import { House, Trash } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { keepSaved } from '@/api/keep-saved';
import { ChatApiError, removePermissionRule } from '@/chat/chat-api';
import { DefaultAgentView, type DefaultAgentViewProps } from '@/chat/default-agent-view';
import { appDefaultWords, DefaultModelsSection } from '@/chat/default-models';
import { ProjectWhileWorkingSection } from '@/chat/while-working-section';
import { projectDefaultAgent, useChatAgents } from '@/chat/use-chat-agents';
import { DefaultPermissionModeView, type DefaultPermissionModeViewProps } from '@/permissions/default-permission-mode';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent, AlertDialogTrigger } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { ProjectBuildLimit } from '@/planning/build-limit-fields';
import { EmptyState, PageBody, PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { deleteHistory, fetchWorkspace, workspaceName } from '@/workspaces/workspace-api';
import { BmadMethodSection } from '@/workspaces/bmad-method-section';
import { OrchestrationSection } from '@/workspaces/orchestration-section';
import { useBmadRepoNoteSlot, useNewProjectsDefaultSlot } from '@/workspaces/bmad-settings-slots';
import { createLatestGate, updateCautionLevel, updateDefaultAgent, updateDefaultPermissionMode, updateProjectDefaultModel, usePermissionRules, useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * `/w/:wsId/settings`: the workspace's settings (story 2.5, then the
 * caution level in 2.8): caution level, the BMad Method section (story
 * 10.5's, in `workspaces/bmad-method-section.tsx`, at `#bmad-method`, with
 * story 10.7's slots), the
 * Always allow rules, history deletion, and the default agent (epic 6,
 * entry 6, shown only when the install has more than one), and the mode new
 * chats start in (default permission mode). Story 2.3
 * registers the route; 2.5 and 2.8 fill this file.
 */
export function WorkspaceSettingsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const workspace = useQuery({ queryKey: ['workspace', wsId], queryFn: () => fetchWorkspace(wsId), retry: false });
  const missing = workspace.error instanceof ChatApiError && workspace.error.status === 404;
  return (
    <>
      <WorkspaceHeader title="Workspace settings" />
      <PageBody data-testid="workspace-settings-page">
        {missing ? (
          <EmptyState
            data-testid="workspace-not-found"
            title="There is no such project."
            actions={
              <Button asChild variant="outline">
                <Link to="/">
                  <House aria-hidden />
                  Go to projects
                </Link>
              </Button>
            }
          />
        ) : workspace.data === undefined ? null : (
          <>
            <CautionLevelSection wsId={wsId} />
            <DefaultPermissionModeSection wsId={wsId} />
            <DefaultAgentSection wsId={wsId} />
            <ProjectModelsSection wsId={wsId} />
            <ProjectWhileWorkingSection wsId={wsId} />
            <BmadSection wsId={wsId} />
            <OrchestrationSection wsId={wsId} />
            <BuildLimitSection wsId={wsId} />
            <AlwaysAllowRulesSection wsId={wsId} name={workspaceName(workspace.data)} />
            <DeleteHistorySection wsId={wsId} name={workspaceName(workspace.data)} />
          </>
        )}
      </PageBody>
    </>
  );
}

/** The BMad Method section with its two slots: the repo note and the default for new projects (story 10.7). */
/** The project's builds at a time (story 5.8): only with Unattended builds on. */
function BuildLimitSection({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  return settings.data?.bmadPieces.includes('builds') === true ? <ProjectBuildLimit wsId={wsId} /> : null;
}

function BmadSection({ wsId }: { wsId: string }) {
  const offerSlot = useBmadRepoNoteSlot(wsId);
  const defaultSlot = useNewProjectsDefaultSlot();
  return <BmadMethodSection wsId={wsId} offerSlot={offerSlot} defaultSlot={defaultSlot} />;
}

/** The caution ladder in the user's words (EXPERIENCE.md Caution level), strictest first. */
export const CAUTION_OPTIONS: Record<CautionLevel, { label: string; description: string }> = {
  ask_every_time: { label: 'Ask every time', description: 'Every request from the agent waits for your answer.' },
  ask_for_commands: {
    label: 'Ask for commands',
    description: 'Reading and searching files inside this project run without asking. Commands, edits and anything outside it ask.',
  },
  ask_risky_only: {
    label: 'Ask only for risky actions',
    description: 'Also edits files inside this project without asking. Commands, deleting, moving, the web and anything outside it ask.',
  },
};

export interface CautionLevelViewProps {
  value: CautionLevel | undefined;
  onChange: (level: CautionLevel) => void;
  saving: boolean;
  /** The status line under the choices: saved, or why it wasn't. */
  status: { kind: 'saved' | 'error'; text: string } | undefined;
}

/** The three caution levels as radios, each with its one-line description, and a status line. */
export function CautionLevelView({ value, onChange, saving, status }: CautionLevelViewProps) {
  return (
    <PageSection title="Caution level" data-testid="caution-section">
      <Text id="caution-level-description">What the agent may do in this project without asking you. A change applies to the next request, never to one already shown.</Text>
      {value === undefined ? null : (
        <RadioGroup
          aria-label="Caution level"
          aria-describedby="caution-level-description"
          data-testid="caution-level"
          value={value}
          disabled={saving}
          onValueChange={(next) => {
            if ((CAUTION_LEVELS as readonly string[]).includes(next) && next !== value) onChange(next as CautionLevel);
          }}
        >
          {CAUTION_LEVELS.map((level) => (
            <RadioGroupOption key={level} id={`caution-${level}`} value={level} data-testid={`caution-${level}`} {...CAUTION_OPTIONS[level]} />
          ))}
        </RadioGroup>
      )}
      <Text variant="caption" role="status" data-testid="caution-status">
        {status?.kind === 'saved' ? status.text : ''}
      </Text>
      {status?.kind === 'error' ? (
        <Notice variant="blocked" role="alert" data-testid="caution-error">
          {status.text}
        </Notice>
      ) : null}
    </PageSection>
  );
}

/** Loads the level and saves each change at once. */
export function CautionLevelSection({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CautionLevelViewProps['status']>(undefined);
  const [chosen, setChosen] = useState<CautionLevel | undefined>(undefined);
  // Only the latest save's answer is shown: an earlier one landing late is ignored (review F4).
  const latest = useRef(createLatestGate()).current;

  const onChange = (level: CautionLevel) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(level);
    setStatus(undefined);
    updateCautionLevel(wsId, level).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, ['workspace-settings', wsId], saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'saved', text: `Saved: ${CAUTION_OPTIONS[saved.cautionLevel].label}.` });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The caution level couldn't be saved. Try again." });
      },
    );
  };

  const loadError = settings.error instanceof Error ? { kind: 'error' as const, text: settings.error.message } : undefined;
  return <CautionLevelView value={chosen ?? settings.data?.cautionLevel} onChange={onChange} saving={saving} status={status ?? loadError} />;
}

/** Loads the mode the project's new chats start in and saves each change at once (Skip all after its warning). */
export function DefaultPermissionModeSection({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  const { appearance } = useAppearance();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<DefaultPermissionModeViewProps['status']>(undefined);
  const [chosen, setChosen] = useState<PermissionMode | undefined>(undefined);
  const latest = useRef(createLatestGate()).current;

  const onChange = (mode: PermissionMode, confirmed: boolean) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(mode);
    setStatus(undefined);
    updateDefaultPermissionMode(wsId, mode, confirmed).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, ['workspace-settings', wsId], saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'saved', text: `Saved: new chats start in ${PERMISSION_MODE_LABELS[saved.defaultPermissionMode ?? 'ask']}.` });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The default permission mode couldn't be saved. Try again." });
      },
    );
  };

  const data = settings.data;
  return (
    <DefaultPermissionModeView
      value={chosen ?? (data === undefined ? undefined : (data.defaultPermissionMode ?? 'ask'))}
      notice={chosen === undefined ? data?.defaultPermissionModeNotice : undefined}
      developerMode={appearance.developerMode}
      onChange={onChange}
      saving={saving}
      status={status ?? (settings.error instanceof Error ? { kind: 'error', text: settings.error.message } : undefined)}
      testId="default-mode"
      title="New chats start in"
      description="The permission mode new chats in this project start in. Each chat can still switch its own. Unattended builds keep their own rules."
      confirmTitle="Start new chats in this project in Skip all?"
    />
  );
}

/** Loads the project's default agent and saves each change at once; another tab's change shows through the event stream. */
export function DefaultAgentSection({ wsId }: { wsId: string }) {
  const chatAgents = useChatAgents();
  const settings = useWorkspaceSettings(wsId);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<DefaultAgentViewProps['status']>(undefined);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const latest = useRef(createLatestGate()).current;
  const list = chatAgents.data;
  if (list === undefined) return null;
  const nameOf = (agentId: string) => list.agents.find((agent) => agent.agentId === agentId)?.displayName ?? agentId;

  const onChange = (agentId: string) => {
    const ticket = latest.next();
    setSaving(true);
    setChosen(agentId);
    setStatus(undefined);
    updateDefaultAgent(wsId, agentId).then(
      async (saved) => {
        if (!latest.isLatest(ticket)) return;
        await keepSaved(queryClient, ['workspace-settings', wsId], saved);
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'saved', text: `Saved: new chats start with ${nameOf(projectDefaultAgent(list, saved.defaultAgentId))}.` });
      },
      (failure: unknown) => {
        if (!latest.isLatest(ticket)) return;
        setSaving(false);
        setChosen(undefined);
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The default agent couldn't be saved. Try again." });
      },
    );
  };

  const value = chosen ?? (settings.data === undefined ? undefined : projectDefaultAgent(list, settings.data.defaultAgentId));
  return (
    <DefaultAgentView
      agents={list.agents}
      value={value}
      onChange={onChange}
      saving={saving}
      status={status ?? (settings.error instanceof Error ? { kind: 'error', text: settings.error.message } : undefined)}
      testId="default-agent"
      description="The agent new chats in this project start with. You can still pick another for each new chat."
    />
  );
}

/**
 * The project's own default model per agent (story 11): it wins over the
 * app's (Settings → Agents) for new chats in this project.
 */
export function ProjectModelsSection({ wsId }: { wsId: string }) {
  const chatAgents = useChatAgents();
  const settings = useWorkspaceSettings(wsId);
  const queryClient = useQueryClient();
  const list = chatAgents.data;
  if (list === undefined || settings.data === undefined) return null;
  const saved = settings.data.defaultModels ?? {};
  return (
    <DefaultModelsSection
      agents={list.agents}
      testId="project-models"
      description="The model new chats in this project start on, per agent. You can still switch each chat's model."
      valueOf={(agent) => saved[agent.agentId] ?? null}
      noneOf={(agent) => ({ label: `App default (${appDefaultWords(agent)})`, description: 'As set in Settings → Agents.' })}
      onChoose={async (agent, model) => {
        const next = await updateProjectDefaultModel(wsId, agent.agentId, model);
        await keepSaved(queryClient, ['workspace-settings', wsId], next);
      }}
    />
  );
}

export interface AlwaysAllowRulesViewProps {
  rules: readonly PermissionRule[] | undefined;
  name: string;
  onRemove: (rule: PermissionRule) => void;
  /** The rule being removed, if any. */
  removing: string | undefined;
  error: string | undefined;
}

/** The project's Always allow rules, oldest first, each with Remove. */
export function AlwaysAllowRulesView({ rules, name, onRemove, removing, error }: AlwaysAllowRulesViewProps) {
  return (
    <PageSection title="Always allow rules" data-testid="rules-section">
      <Text>Requests these rules cover run without asking. Remove a rule and the next such request asks again.</Text>
      {rules === undefined ? null : rules.length === 0 ? (
        <Text variant="caption" data-testid="rules-empty">
          No rules yet.
        </Text>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="rules-list">
          {rules.map((rule) => (
            <li key={rule.id} className="flex min-h-(--control-height) items-center justify-between gap-3" data-testid="rule-row">
              <Text as="span" variant="label" className="min-w-0 truncate">
                {rule.scope.kind === 'command_prefix' ? (
                  <Text as="code" variant="mono">
                    {rule.scope.label}
                  </Text>
                ) : (
                  rule.scope.label
                )}{' '}
                in {name}
              </Text>
              <Button
                variant="outline"
                size="sm"
                data-testid="rule-remove"
                aria-label={`Remove ${rule.scope.label} in ${name}`}
                aria-disabled={removing === rule.id}
                onClick={removing === rule.id ? undefined : () => onRemove(rule)}
              >
                {removing === rule.id ? 'Removing...' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="rules-error">
          {error}
        </Notice>
      )}
    </PageSection>
  );
}

/** Loads the rules; Remove undoes one and the list refreshes (also when it was already gone). */
function AlwaysAllowRulesSection({ wsId, name }: { wsId: string; name: string }) {
  const rules = usePermissionRules(wsId);
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const onRemove = (rule: PermissionRule) => {
    setRemoving(rule.id);
    setError(undefined);
    removePermissionRule(wsId, rule.id).then(
      () => {
        setRemoving(undefined);
        void queryClient.invalidateQueries({ queryKey: ['permission-rules', wsId] });
      },
      (failure: unknown) => {
        setRemoving(undefined);
        const gone = failure instanceof ChatApiError && failure.status === 404;
        setError(gone ? 'That rule was already removed.' : failure instanceof Error ? failure.message : "The rule couldn't be removed. Try again.");
        void queryClient.invalidateQueries({ queryKey: ['permission-rules', wsId] });
      },
    );
  };

  const loadError = rules.error instanceof Error ? rules.error.message : undefined;
  return <AlwaysAllowRulesView rules={rules.data} name={name} onRemove={onRemove} removing={removing} error={error ?? loadError} />;
}

/**
 * Delete history: every chat of this project goes; the project and every
 * other project stay. It confirms once with its consequence (EXPERIENCE.md
 * Interaction Rules); the server refuses while a chat is working or waiting,
 * and that refusal stays in the dialog.
 */
function DeleteHistorySection({ wsId, name }: { wsId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  const onConfirm = () => {
    setPending(true);
    setError(undefined);
    deleteHistory(wsId).then(
      () => {
        setPending(false);
        setOpen(false);
        setDone(true);
      },
      (failure: unknown) => {
        setPending(false);
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't delete the history. Try again.");
      },
    );
  };

  return (
    <PageSection title="History" data-testid="history-section">
      <Text>Delete every chat in this project. The folder and its files are not touched.</Text>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDone(false);
          else setError(undefined);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="self-start" data-testid="delete-history">
            <Trash aria-hidden />
            Delete history
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          data-testid="delete-history-confirm"
          title="Delete history?"
          description={`Deletes every chat in ${name}. This can't be undone.`}
          error={error}
        >
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogConfirm aria-disabled={pending} onClick={pending ? undefined : onConfirm}>
            {pending ? 'Deleting...' : 'Delete history'}
          </AlertDialogConfirm>
        </AlertDialogContent>
      </AlertDialog>
      {done ? (
        <Text variant="caption" role="status" data-testid="history-deleted">
          The history of {name} was deleted.
        </Text>
      ) : null}
    </PageSection>
  );
}
