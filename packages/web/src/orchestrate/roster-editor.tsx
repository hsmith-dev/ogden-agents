import {
  sameAssignee,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_SENTENCES,
  type LocalEndpointId,
  type LocalEndpointModelsResponse,
  type LocalEndpointView,
  type RosterOption,
  type RosterRoleView,
  type RosterView,
  type TeamAssignee,
  type TeamRole,
  type TeamRoster,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchEndpointModels, useLocalEndpoints } from '@/agents/local-endpoints-api';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { saveDefaultRoster, saveProjectRoster, useDefaultRoster, useProjectRoster } from './roster-api';

/** The value of the option that means "use the default". */
const DEFAULT_VALUE = 'default';

/** A stable value for an assignee, for the radio group. */
export const assigneeKey = (assignee: TeamAssignee): string => (assignee.kind === 'agent' ? `agent:${assignee.agentId}` : `model:${assignee.endpointId}:${assignee.model}`);

/** Roles a model can hold: all but the worker. */
const holdsModels = (role: TeamRole): boolean => role !== 'worker';

const optionDescription = (option: RosterOption): string => {
  const parts: string[] = [];
  if (option.where !== undefined) parts.push(`A model ${option.where}.`);
  if (!option.available && option.reason !== undefined) parts.push(`Not available: ${option.reason}`);
  if (option.available && option.note !== undefined) parts.push(option.note);
  return parts.join(' ');
};

export interface ChooserState {
  /** The role a model is being chosen for. */
  role: TeamRole;
  servers: readonly LocalEndpointView[] | undefined;
  /** The models of the server last read. */
  models: { endpointId: LocalEndpointId; answer: LocalEndpointModelsResponse } | undefined;
  loading: LocalEndpointId | undefined;
}

export interface RosterEditorViewProps {
  roster: RosterView;
  saving: boolean;
  /** Why the last change failed, in plain words. */
  error: string | undefined;
  /** A short name for the screen's test ids and labels ("project" or "defaults"). */
  scope: string;
  onSet: (role: TeamRole, assignee: TeamAssignee | null) => void;
  chooser: ChooserState | undefined;
  onOpenChooser: (role: TeamRole) => void;
  onCloseChooser: () => void;
  onShowModels: (endpointId: LocalEndpointId) => void;
}

function Chooser({ chooser, saving, onSet, onClose, onShowModels }: { chooser: ChooserState; saving: boolean; onSet: RosterEditorViewProps['onSet']; onClose: () => void; onShowModels: (id: LocalEndpointId) => void }) {
  const { role, servers, models, loading } = chooser;
  const name = TEAM_ROLE_LABELS[role].toLowerCase();
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted p-2" data-testid={`roster-chooser-${role}`}>
      <Text variant="caption">Pick a model on one of your servers. A model on another computer gets your goal and short summaries of the work, so confirm that server first in Settings, under Agents.</Text>
      {servers === undefined ? null : servers.length === 0 ? (
        <Text variant="caption" data-testid="roster-no-servers">
          You have no server yet. Add one in Settings, under Agents.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((server) => (
            <li key={server.id} className="flex flex-col gap-2" data-testid={`roster-server-${server.id}`}>
              <Text variant="caption" className="break-words">
                {server.label} ({server.loopback ? 'on this computer' : 'on another computer'})
              </Text>
              <Button variant="outline" className="self-start" aria-label={`Choose a model on ${server.label} for the ${name}`} aria-disabled={loading !== undefined || saving} onClick={loading !== undefined || saving ? undefined : () => onShowModels(server.id)} data-testid="roster-show-models">
                {loading === server.id ? 'Reading...' : 'Show its models'}
              </Button>
              {models?.endpointId !== server.id ? null : models.answer.models.length === 0 ? (
                <Text variant="caption" role="status" data-testid="roster-models-state">
                  {models.answer.message}
                </Text>
              ) : (
                <ul className="flex flex-col gap-1">
                  {models.answer.models.map((model) => (
                    <li key={model.id} className="flex items-center justify-between gap-2">
                      <Text variant="caption" className="break-words">
                        {model.id}
                      </Text>
                      <Button variant="secondary" aria-label={`Use ${model.id} as the ${name}`} aria-disabled={saving} onClick={saving ? undefined : () => onSet(role, { kind: 'model', endpointId: server.id, model: model.id })} data-testid={`roster-use-${role}-${model.id}`}>
                        {`Use as the ${name}`}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" className="self-start" onClick={onClose} data-testid="roster-chooser-close">
        Done choosing
      </Button>
    </div>
  );
}

function RoleCard({ view, props }: { view: RosterRoleView; props: RosterEditorViewProps }) {
  const { role } = view;
  const name = TEAM_ROLE_LABELS[role];
  const value = view.chosen === null ? DEFAULT_VALUE : assigneeKey(view.chosen);
  const sourceWords = view.source === 'chosen' ? 'your choice' : 'the default';
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-(--panel-padding)" data-testid={`roster-role-${role}`}>
      <Text variant="label" as="h3">
        {name}
      </Text>
      <Text variant="caption">{TEAM_ROLE_SENTENCES[role]}</Text>
      <Text variant="caption" data-testid={`roster-holder-${role}`}>
        {view.label === null ? (view.empty ?? 'Nobody holds this role.') : `${view.label} (${sourceWords}).`}
      </Text>
      {view.problem === undefined ? null : (
        <Notice variant="blocked" role="status" data-testid={`roster-problem-${role}`}>
          {`${view.label ?? name} cannot be the ${name.toLowerCase()} right now. ${view.problem}`}
        </Notice>
      )}
      {view.note === undefined ? null : (
        <Text variant="caption" data-testid={`roster-note-${role}`}>
          {view.note}
        </Text>
      )}
      <RadioGroup value={value} aria-label={`Who is the ${name.toLowerCase()}`} data-testid={`roster-group-${role}`} onValueChange={(next) => {
          if (next === DEFAULT_VALUE) return props.onSet(role, null);
          const found = view.options.find((option) => assigneeKey(option.assignee) === next);
          if (found !== undefined) props.onSet(role, found.assignee);
        }}>
        <RadioGroupOption
          id={`roster-${props.scope}-${role}-default`}
          value={DEFAULT_VALUE}
          label="Use the default"
          description="The first one that is ready fits the role."
          disabled={props.saving}
          data-testid={`roster-option-${role}-default`}
        />
        {view.options.map((option) => {
          const key = assigneeKey(option.assignee);
          return (
            <RadioGroupOption
              key={key}
              id={`roster-${props.scope}-${role}-${key}`}
              value={key}
              label={option.label}
              description={optionDescription(option) || undefined}
              disabled={props.saving || (!option.available && !(view.chosen !== null && sameAssignee(option.assignee, view.chosen)))}
              data-testid={`roster-option-${role}-${key}`}
            />
          );
        })}
      </RadioGroup>
      {!holdsModels(role) ? null : props.chooser?.role === role ? (
        <Chooser chooser={props.chooser} saving={props.saving} onSet={props.onSet} onClose={props.onCloseChooser} onShowModels={props.onShowModels} />
      ) : (
        <Button variant="outline" className="self-start" aria-disabled={props.saving} onClick={props.saving ? undefined : () => props.onOpenChooser(role)} data-testid={`roster-choose-model-${role}`}>
          Choose another model
        </Button>
      )}
    </li>
  );
}

/** The four roles of a team, each with who holds it, why others cannot, and the choice. */
export function RosterEditorView(props: RosterEditorViewProps) {
  const { roster } = props;
  return (
    <div className="flex flex-col gap-3" data-testid={`roster-${props.scope}`}>
      <Text variant="caption">
        {roster.mode === 'automatic' ? 'This project dispatches automatically.' : 'This team works with Approve each instruction.'} One agent or model can hold several roles. A role left on the default uses the first one that is ready.
      </Text>
      <Text variant="caption" data-testid="roster-workers">
        {roster.workers.length === 0
          ? 'The manager has no worker to address yet.'
          : `The manager may address: ${roster.workers.map((worker) => `${worker.label} (${TEAM_ROLE_LABELS[worker.role].toLowerCase()}${worker.ready ? '' : ', not ready'})`).join(', ')}.`}
      </Text>
      <ul className="flex flex-col gap-3">
        {roster.roles.map((view) => (
          <RoleCard key={view.role} view={view} props={props} />
        ))}
      </ul>
      {props.error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="roster-error">
          {props.error}
        </Notice>
      )}
    </div>
  );
}

/** What the containers share: choosing a role saves the whole roster at once, and the chooser reads a server's models on request. */
function useRosterEditing(stored: TeamRoster | undefined, save: (roster: TeamRoster) => Promise<unknown>) {
  const endpoints = useLocalEndpoints();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [chooser, setChooser] = useState<{ role: TeamRole; models: ChooserState['models']; loading: LocalEndpointId | undefined } | undefined>(undefined);
  const onSet = (role: TeamRole, assignee: TeamAssignee | null) => {
    if (stored === undefined) return;
    setSaving(true);
    setError(undefined);
    save({ ...stored, [role]: assignee }).then(
      () => {
        setSaving(false);
        setChooser(undefined);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "The team couldn't be saved. Try again.");
      },
    );
  };
  const onShowModels = (endpointId: LocalEndpointId) => {
    setChooser((current) => (current === undefined ? current : { ...current, loading: endpointId }));
    setError(undefined);
    fetchEndpointModels(endpointId).then(
      (answer) => setChooser((current) => (current === undefined ? current : { ...current, models: { endpointId, answer }, loading: undefined })),
      (failure: unknown) => {
        setChooser((current) => (current === undefined ? current : { ...current, loading: undefined }));
        setError(failure instanceof Error ? failure.message : "That server's models couldn't be read. Try again.");
      },
    );
  };
  return {
    saving: saving || stored === undefined,
    error,
    onSet,
    onShowModels,
    chooser: chooser === undefined ? undefined : { role: chooser.role, servers: endpoints.data?.endpoints, models: chooser.models, loading: chooser.loading },
    onOpenChooser: (role: TeamRole) => setChooser({ role, models: undefined, loading: undefined }),
    onCloseChooser: () => setChooser(undefined),
  };
}

/** The project's team under Orchestration in its settings (epic 15, 15.5). Each choice is saved at once; the server refuses one that breaks a rule and says why. */
export function ProjectRoster({ wsId }: { wsId: string }) {
  const query = useProjectRoster(wsId);
  const queryClient = useQueryClient();
  const editing = useRosterEditing(query.data?.stored, async (roster) => {
    await saveProjectRoster(wsId, roster);
    await queryClient.invalidateQueries({ queryKey: ['team-roster', wsId] });
    await queryClient.invalidateQueries({ queryKey: ['workspace-settings', wsId] });
    await queryClient.invalidateQueries({ queryKey: ['orchestration-settings', wsId] });
  });
  if (query.data === undefined) {
    return query.error instanceof Error ? (
      <Notice variant="blocked" role="alert" data-testid="roster-load-error">
        {query.error.message}
      </Notice>
    ) : null;
  }
  return <RosterEditorView roster={query.data.roster} scope="project" {...editing} />;
}

/** The team new projects start with, in Settings for new projects. */
export function DefaultRoster() {
  const query = useDefaultRoster();
  const queryClient = useQueryClient();
  const editing = useRosterEditing(query.data?.stored, async (roster) => {
    await saveDefaultRoster(roster);
    await queryClient.invalidateQueries({ queryKey: ['team-roster-default'] });
  });
  if (query.data === undefined) {
    return query.error instanceof Error ? (
      <Notice variant="blocked" role="alert" data-testid="roster-load-error">
        {query.error.message}
      </Notice>
    ) : null;
  }
  return <RosterEditorView roster={query.data.roster} scope="defaults" {...editing} />;
}
