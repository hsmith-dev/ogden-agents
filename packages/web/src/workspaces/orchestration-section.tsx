import { ORCHESTRATION_PIECE } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { keepSaved } from '@/api/keep-saved';
import { updateOrchestrationEnabled } from '@/orchestrate/orchestrate-api';
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
}

/** The project's Orchestration switch (epic 15, 15.3): off by default, an advanced feature that adds an Orchestrate tab. */
export function OrchestrationSectionView({ enabled, saving, error, onChange }: OrchestrationSectionViewProps) {
  return (
    <PageSection title={ORCHESTRATION_PIECE.label} data-testid="orchestration-section">
      <Text>An advanced feature. A manager model plans the work and tells your other agents what to do, and you approve each instruction. Turn it off and the project stays a plain set of chats.</Text>
      {enabled === undefined ? null : (
        <Field id="orchestration-use" layout="inline" label="Use Orchestration in this project" description={ORCHESTRATION_PIECE.sentence}>
          <Switch id="orchestration-use" data-testid="orchestration-use" aria-describedby="orchestration-use-description" checked={enabled} disabled={saving} onCheckedChange={onChange} />
        </Field>
      )}
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
  return <OrchestrationSectionView enabled={settings.data === undefined ? undefined : settings.data.orchestrationEnabled === true} saving={saving} error={error ?? (settings.error instanceof Error ? settings.error.message : undefined)} onChange={onChange} />;
}
