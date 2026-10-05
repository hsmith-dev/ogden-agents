import type { WhileWorking } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { saveChatSettings, useChatSettings, WHILE_WORKING_OPTIONS } from '@/chat/send-mode';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { createLatestGate, updateWhileWorking, useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/** The project's choice: its own, or the app's (`app`). */
type ProjectChoice = WhileWorking | 'app';

const TITLE = 'While the agent is working, new messages';

export interface WhileWorkingViewProps {
  /** The section's id prefix, so the app's and a project's never clash. */
  idPrefix: string;
  /** The choices, in order, with their words. */
  options: ReadonlyArray<{ value: string; label: string; description: string }>;
  value: string | undefined;
  saving: boolean;
  status: { kind: 'saved' | 'error'; text: string } | undefined;
  description: string;
  onChange(value: string): void;
}

/** The choice as radios, each with its one-line description, and a status line (as the caution level). */
export function WhileWorkingView({ idPrefix, options, value, saving, status, description, onChange }: WhileWorkingViewProps) {
  return (
    <PageSection title={TITLE} data-testid={`${idPrefix}-section`}>
      <Text id={`${idPrefix}-description`}>{description}</Text>
      {value === undefined ? null : (
        <RadioGroup
          aria-label={TITLE}
          aria-describedby={`${idPrefix}-description`}
          data-testid={`${idPrefix}-choice`}
          value={value}
          disabled={saving}
          onValueChange={(next) => {
            if (next !== value && options.some((option) => option.value === next)) onChange(next);
          }}
        >
          {options.map((option) => (
            <RadioGroupOption key={option.value} id={`${idPrefix}-${option.value}`} value={option.value} data-testid={`${idPrefix}-${option.value}`} label={option.label} description={option.description} />
          ))}
        </RadioGroup>
      )}
      <Text variant="caption" role="status" data-testid={`${idPrefix}-status`}>
        {status?.kind === 'saved' ? status.text : ''}
      </Text>
      {status?.kind === 'error' ? (
        <Notice variant="blocked" role="alert" data-testid={`${idPrefix}-error`}>
          {status.text}
        </Notice>
      ) : null}
    </PageSection>
  );
}

const APP_OPTIONS = (['wait', 'now'] as const).map((value) => ({ value, ...WHILE_WORKING_OPTIONS[value] }));

/** Settings, Agents: the app-wide choice (send now or wait). */
export function AppWhileWorkingSection() {
  const settings = useChatSettings();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<WhileWorkingViewProps['status']>(undefined);
  return (
    <WhileWorkingView
      idPrefix="while-working"
      options={APP_OPTIONS}
      value={settings.data}
      saving={saving}
      status={status ?? (settings.isError ? { kind: 'error', text: settings.error.message } : undefined)}
      description="What happens to a message you send while the agent is still working. A project can choose its own in its settings. In a chat you can always do the other for one message."
      onChange={(next) => {
        const value = next as WhileWorking;
        setSaving(true);
        setStatus(undefined);
        saveChatSettings(value).then(
          (saved) => {
            setSaving(false);
            queryClient.setQueryData(['chat-settings'], saved);
            setStatus({ kind: 'saved', text: `Saved: ${WHILE_WORKING_OPTIONS[saved].label}.` });
          },
          (failure: unknown) => {
            setSaving(false);
            setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "That setting couldn't be saved. Try again." });
          },
        );
      }}
    />
  );
}

/** Workspace settings: the project's own choice, or the app's (send now or wait). */
export function ProjectWhileWorkingSection({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  const app = useChatSettings();
  const queryClient = useQueryClient();
  const [gate] = useState(createLatestGate);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<WhileWorkingViewProps['status']>(undefined);
  const appWords = app.data === undefined ? 'the app setting' : WHILE_WORKING_OPTIONS[app.data].label;
  const options = [
    { value: 'app', label: 'Use the app setting', description: `The app setting is ${appWords}. Change it in Settings, Agents.` },
    ...APP_OPTIONS,
  ];
  const value: ProjectChoice | undefined = settings.data === undefined ? undefined : (settings.data.whileWorking ?? 'app');
  return (
    <WhileWorkingView
      idPrefix="project-while-working"
      options={options}
      value={value}
      saving={saving}
      status={status}
      description="What happens to a message you send while the agent is still working in this project."
      onChange={(next) => {
        const choice = next as ProjectChoice;
        const ticket = gate.next();
        setSaving(true);
        setStatus(undefined);
        updateWhileWorking(wsId, choice === 'app' ? null : choice).then(
          (saved) => {
            if (!gate.isLatest(ticket)) return;
            setSaving(false);
            queryClient.setQueryData(['workspace-settings', wsId], saved);
            setStatus({ kind: 'saved', text: `Saved: ${saved.whileWorking === undefined ? 'the app setting' : WHILE_WORKING_OPTIONS[saved.whileWorking].label}.` });
          },
          (failure: unknown) => {
            if (!gate.isLatest(ticket)) return;
            setSaving(false);
            setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "That setting couldn't be saved. Try again." });
          },
        );
      }}
    />
  );
}
