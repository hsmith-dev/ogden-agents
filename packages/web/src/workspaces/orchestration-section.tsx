import { ORCHESTRATION_PIECE, type LocalEndpointId, type LocalEndpointModelsResponse, type LocalEndpointView, type TeamRoster } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { keepSaved } from '@/api/keep-saved';
import { fetchEndpointModels, useLocalEndpoints } from '@/agents/local-endpoints-api';
import { updateManagerModel, updateOrchestrationEnabled } from '@/orchestrate/orchestrate-api';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Switch } from '@/ui/switch';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

export interface OrchestrationSectionViewProps {
  /** Whether the piece is on; `undefined` while the settings load. */
  enabled: boolean | undefined;
  saving: boolean;
  /** Why the last change failed, in plain words. */
  error: string | undefined;
  onChange: (enabled: boolean) => void;
  /** The manager model picker; shown only while the piece is on. */
  manager?: ReactNode;
}

/** The project's Orchestration switch (epic 15, 15.3): off by default, an advanced feature that adds an Orchestrate tab. */
export function OrchestrationSectionView({ enabled, saving, error, onChange, manager }: OrchestrationSectionViewProps) {
  return (
    <PageSection title={ORCHESTRATION_PIECE.label} data-testid="orchestration-section">
      <Text>An advanced feature. A manager model plans the work and tells your other agents what to do, and you approve each instruction. Turn it off and the project stays a plain set of chats.</Text>
      {enabled === undefined ? null : (
        <Field id="orchestration-use" layout="inline" label="Use Orchestration in this project" description={ORCHESTRATION_PIECE.sentence}>
          <Switch id="orchestration-use" data-testid="orchestration-use" aria-describedby="orchestration-use-description" checked={enabled} disabled={saving} onCheckedChange={onChange} />
        </Field>
      )}
      {enabled === true ? manager : null}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="orchestration-error">
          {error}
        </Notice>
      )}
    </PageSection>
  );
}

/** Loads the switch and saves each change at once. */
export function OrchestrationSection({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const onChange = (enabled: boolean) => {
    setSaving(true);
    setError(undefined);
    updateOrchestrationEnabled(wsId, enabled).then(
      async (saved) => {
        await keepSaved(queryClient, ['workspace-settings', wsId], saved);
        setSaving(false);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "Orchestration couldn't be changed. Try again.");
      },
    );
  };
  return (
    <OrchestrationSectionView
      enabled={settings.data === undefined ? undefined : settings.data.orchestrationEnabled === true}
      saving={saving}
      error={error ?? (settings.error instanceof Error ? settings.error.message : undefined)}
      onChange={onChange}
      manager={<ManagerModel wsId={wsId} />}
    />
  );
}

export interface ManagerModelViewProps {
  /** The model chosen as the manager, with the name of the server it is on, or `null` when none is chosen. */
  chosen: { model: string; serverLabel: string | undefined } | null;
  servers: readonly LocalEndpointView[] | undefined;
  /** The models of the server being read, once read. */
  models: { endpointId: LocalEndpointId; answer: LocalEndpointModelsResponse } | undefined;
  loading: LocalEndpointId | undefined;
  saving: boolean;
  error: string | undefined;
  onShowModels: (endpointId: LocalEndpointId) => void;
  onChoose: (endpointId: LocalEndpointId, model: string) => void;
  onClear: () => void;
}

/** The project's manager model (epic 15, 15.4): which model on which of your servers plans the work. The manager is a model, never an agent. */
export function ManagerModelView({ chosen, servers, models, loading, saving, error, onShowModels, onChoose, onClear }: ManagerModelViewProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="manager-model">
      <Text variant="label">Manager model</Text>
      <Text variant="caption" data-testid="manager-model-current">
        {chosen === null ? 'No manager is chosen yet.' : `The manager is ${chosen.model}${chosen.serverLabel === undefined ? ', on a server that is not set up any more' : ` on ${chosen.serverLabel}`}.`}
      </Text>
      <Text variant="caption">Pick a model on one of your servers. A model on another computer gets your goal and short summaries of the work, so you confirm that server first in Settings, under Agents. You can test a model there too.</Text>
      {servers === undefined ? null : servers.length === 0 ? (
        <Text variant="caption" data-testid="manager-model-no-servers">
          You have no server yet. Add one in Settings, under Agents, to choose a manager.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((server) => (
            <li key={server.id} className="flex flex-col gap-2 rounded-md bg-muted p-2" data-testid={`manager-server-${server.id}`}>
              <Text variant="caption" className="break-words">
                {server.label} ({server.loopback ? 'on this computer' : 'on another computer'})
              </Text>
              <Button variant="outline" className="self-start" aria-label={`Choose a model on ${server.label}`} aria-disabled={loading !== undefined || saving} onClick={loading !== undefined || saving ? undefined : () => onShowModels(server.id)} data-testid="manager-show-models">
                {loading === server.id ? 'Reading...' : 'Choose a model'}
              </Button>
              {models?.endpointId !== server.id ? null : models.answer.models.length === 0 ? (
                <Text variant="caption" role="status" data-testid="manager-models-state">
                  {models.answer.message}
                </Text>
              ) : (
                <ul className="flex flex-col gap-1">
                  {models.answer.models.map((model) => (
                    <li key={model.id} className="flex items-center justify-between gap-2">
                      <Text variant="caption" className="break-words">
                        {model.id}
                      </Text>
                      <Button variant="secondary" aria-label={`Use ${model.id} as the manager`} aria-disabled={saving} onClick={saving ? undefined : () => onChoose(server.id, model.id)} data-testid={`manager-use-${model.id}`}>
                        Use as the manager
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {chosen === null ? null : (
        <Button variant="ghost" className="self-start" aria-disabled={saving} onClick={saving ? undefined : onClear} data-testid="manager-clear">
          Clear the manager
        </Button>
      )}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="manager-model-error">
          {error}
        </Notice>
      )}
    </div>
  );
}

/** Loads the servers, reads one server's models on request, and saves the choice at once, keeping the other roles of the roster. */
function ManagerModel({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  const endpoints = useLocalEndpoints();
  const queryClient = useQueryClient();
  const [models, setModels] = useState<ManagerModelViewProps['models']>(undefined);
  const [loading, setLoading] = useState<LocalEndpointId | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const roster: TeamRoster = settings.data?.orchestrationRoster ?? { manager: null, planner: null, worker: null, reviewer: null };
  const manager = roster.manager?.kind === 'model' ? roster.manager : null;
  const servers = endpoints.data?.endpoints;
  const loaded = settings.data !== undefined;
  const save = (next: { endpointId: string; model: string } | null) => {
    if (!loaded) return;
    setSaving(true);
    setError(undefined);
    updateManagerModel(wsId, roster, next).then(
      async (saved) => {
        await keepSaved(queryClient, ['workspace-settings', wsId], saved);
        setSaving(false);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "The manager couldn't be chosen. Try again.");
      },
    );
  };
  const show = (endpointId: LocalEndpointId) => {
    setLoading(endpointId);
    setError(undefined);
    fetchEndpointModels(endpointId).then(
      (answer) => {
        setModels({ endpointId, answer });
        setLoading(undefined);
      },
      (failure: unknown) => {
        setLoading(undefined);
        setError(failure instanceof Error ? failure.message : "That server's models couldn't be read. Try again.");
      },
    );
  };
  return (
    <ManagerModelView
      chosen={manager === null ? null : { model: manager.model, serverLabel: servers?.find((server) => server.id === manager.endpointId)?.label }}
      servers={servers}
      models={models}
      loading={loading}
      saving={saving || !loaded}
      error={error}
      onShowModels={show}
      onChoose={(endpointId, model) => save({ endpointId, model })}
      onClear={() => save(null)}
    />
  );
}
