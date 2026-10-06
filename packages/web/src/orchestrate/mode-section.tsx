import {
  ORCHESTRATION_AUTOMATIC_CONFIRM_BUTTON,
  ORCHESTRATION_AUTOMATIC_CONFIRM_TITLE,
  ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS,
  ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE,
  ORCHESTRATION_LIMIT_BOUNDS,
  ORCHESTRATION_MODE_INFO,
  ORCHESTRATION_MODES,
  type OrchestrationMode,
  type RunLimits,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { saveOrchestrationDefaults, saveProjectMode, useOrchestrationDefaults } from './mode-api';

/**
 * The orchestration mode in the settings (epic 15, 15.8): Approve each instruction (the default) or Dispatch automatically, plainly
 * labelled, changeable at any time, for a project and, with the limits of every run, for new projects. Dispatch automatically asks
 * once per project (the page asks only when the project has not confirmed before; the server refuses it without the confirmation
 * either way). The server enforces the mode; this only asks.
 */

/** The limits in one plain sentence. */
export const limitsSentence = (limits: RunLimits): string =>
  `A run stops at ${limits.maxInstructions} ${limits.maxInstructions === 1 ? 'instruction' : 'instructions'}, ${limits.maxDepth} ${limits.maxDepth === 1 ? 'step' : 'steps'} deep, or ${limits.maxMinutes} ${limits.maxMinutes === 1 ? 'minute' : 'minutes'}, whichever comes first.`;

export interface ModeChoiceViewProps {
  /** The mode in force; `undefined` while loading. */
  value: OrchestrationMode | undefined;
  /** Whether the user already confirmed Dispatch automatically for this scope, so it is not asked again. */
  confirmed: boolean;
  saving: boolean;
  error: string | undefined;
  /** Asks for `mode`; for Dispatch automatically with `confirmed` set when the user answered the question. */
  onChange: (mode: OrchestrationMode, confirmed: boolean) => void;
  /** Test ids and ids start with this. */
  testId: string;
  title: string;
  description: string;
  /** What the dialog's question is about (this project, or new projects). */
  confirmTitle?: string;
  /** A note under the choice (the install's default, the limits in force). */
  children?: React.ReactNode;
}

/** Two radios with their plain sentences, and the once only question before Dispatch automatically. */
export function ModeChoiceView({ value, confirmed, saving, error, onChange, testId, title, description, confirmTitle = ORCHESTRATION_AUTOMATIC_CONFIRM_TITLE, children }: ModeChoiceViewProps) {
  const [asking, setAsking] = useState(false);
  const choose = (mode: OrchestrationMode) => {
    if (saving || mode === value) return;
    if (mode === 'automatic' && !confirmed) setAsking(true);
    else onChange(mode, false);
  };
  return (
    <div className="flex flex-col gap-2" data-testid={`${testId}-section`}>
      <Text variant="label" id={`${testId}-title`}>
        {title}
      </Text>
      <Text variant="caption" id={`${testId}-description`}>
        {description}
      </Text>
      {value === undefined ? null : (
        <RadioGroup aria-labelledby={`${testId}-title`} aria-describedby={`${testId}-description`} data-testid={testId} value={value} disabled={saving} onValueChange={(next) => (ORCHESTRATION_MODES as readonly string[]).includes(next) && choose(next as OrchestrationMode)}>
          {ORCHESTRATION_MODES.map((mode) => (
            <RadioGroupOption key={mode} id={`${testId}-${mode}`} value={mode} data-testid={`${testId}-${mode}`} label={ORCHESTRATION_MODE_INFO[mode].label} description={ORCHESTRATION_MODE_INFO[mode].sentence} />
          ))}
        </RadioGroup>
      )}
      {children}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid={`${testId}-error`}>
          {error}
        </Notice>
      )}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent
          data-testid={`${testId}-confirm`}
          title={confirmTitle}
          description={ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(`${testId}-${value ?? 'approve_each'}`)?.focus();
          }}
        >
          <AlertDialogCancel data-testid={`${testId}-confirm-cancel`}>Cancel</AlertDialogCancel>
          <AlertDialogConfirm
            data-testid={`${testId}-confirm-button`}
            onClick={() => {
              setAsking(false);
              onChange('automatic', true);
            }}
          >
            {ORCHESTRATION_AUTOMATIC_CONFIRM_BUTTON}
          </AlertDialogConfirm>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The project's mode, under Orchestration in its settings. Each choice is saved at once; the server refuses one that breaks a rule and says why. */
export function ProjectMode({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  const defaults = useOrchestrationDefaults();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const onChange = (mode: OrchestrationMode, confirmed: boolean) => {
    setSaving(true);
    setError(undefined);
    saveProjectMode(wsId, mode, confirmed).then(
      async () => {
        await queryClient.invalidateQueries({ queryKey: ['workspace-settings', wsId] });
        await queryClient.invalidateQueries({ queryKey: ['orchestration-settings', wsId] });
        await queryClient.invalidateQueries({ queryKey: ['team-roster', wsId] });
        setSaving(false);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "The mode couldn't be saved. Try again.");
      },
    );
  };
  const value: OrchestrationMode | undefined = settings.data === undefined ? undefined : (settings.data.orchestrationMode ?? 'approve_each');
  const confirmed = settings.data?.orchestrationAutomaticConfirmed === true;
  const defaultIsAutomatic = defaults.data?.mode === 'automatic';
  return (
    <ModeChoiceView
      value={value}
      confirmed={confirmed}
      saving={saving}
      error={error ?? (settings.error instanceof Error ? settings.error.message : undefined)}
      onChange={onChange}
      testId="orchestration-mode"
      title="How instructions are sent"
      description="You can change this at any time. It applies to the next instruction, even in a run that has started."
    >
      {defaults.data === undefined ? null : (
        <Text variant="caption" data-testid="orchestration-limits">
          {limitsSentence(defaults.data.limits)} You can change the limits in Settings, under New projects.
        </Text>
      )}
      {defaultIsAutomatic && value === 'approve_each' && !confirmed ? (
        <Notice variant="info" infoGlyph role="status" data-testid="orchestration-default-automatic-note">
          {ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE}
        </Notice>
      ) : null}
    </ModeChoiceView>
  );
}

export interface DefaultsViewProps {
  mode: OrchestrationMode | undefined;
  limits: RunLimits | undefined;
  saving: boolean;
  error: string | undefined;
  saved: boolean;
  onMode: (mode: OrchestrationMode, confirmed: boolean) => void;
  onLimits: (limits: RunLimits) => void;
}

const LIMIT_FIELDS: ReadonlyArray<{ key: keyof RunLimits; label: string; description: string }> = [
  { key: 'maxInstructions', label: 'Most instructions in a run', description: `From ${ORCHESTRATION_LIMIT_BOUNDS.maxInstructions.min} to ${ORCHESTRATION_LIMIT_BOUNDS.maxInstructions.max}. The run stops after this many have been sent.` },
  { key: 'maxDepth', label: 'Most steps deep', description: `From ${ORCHESTRATION_LIMIT_BOUNDS.maxDepth.min} to ${ORCHESTRATION_LIMIT_BOUNDS.maxDepth.max}. How long a chain of steps that need each other may be.` },
  { key: 'maxMinutes', label: 'Most minutes in a run', description: `From ${ORCHESTRATION_LIMIT_BOUNDS.maxMinutes.min} to ${ORCHESTRATION_LIMIT_BOUNDS.maxMinutes.max}. The run stops when this time has passed.` },
];

/** The install's default mode for new projects, and the limits of every run, in Settings for new projects. */
export function DefaultsView({ mode, limits, saving, error, saved, onMode, onLimits }: DefaultsViewProps) {
  const [draft, setDraft] = useState<Partial<Record<keyof RunLimits, string>>>({});
  const shown = (key: keyof RunLimits): string => draft[key] ?? (limits === undefined ? '' : String(limits[key]));
  const changed = limits !== undefined && LIMIT_FIELDS.some(({ key }) => draft[key] !== undefined && draft[key] !== String(limits[key]));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (limits === undefined || saving) return;
    onLimits({ maxInstructions: Number(shown('maxInstructions')), maxDepth: Number(shown('maxDepth')), maxMinutes: Number(shown('maxMinutes')) });
    setDraft({});
  };
  return (
    <div className="flex flex-col gap-4" data-testid="orchestration-defaults">
      <ModeChoiceView
        value={mode}
        confirmed={false}
        saving={saving}
        error={error}
        onChange={onMode}
        testId="orchestration-default-mode"
        title="Offered to new projects"
        description="A project you add starts on Approve each instruction whatever you choose here. Each project asks you to confirm Dispatch automatically for itself, once."
        confirmTitle="Offer Dispatch automatically?"
      />
      {/* The server checks every limit against its bounds and says so in plain words, so the browser's own message stays out of the way. */}
      <form className="flex flex-col gap-3" noValidate onSubmit={submit} data-testid="orchestration-limits-form">
        <Text variant="label">Limits of every run</Text>
        <Text variant="caption">These are safety limits, not a budget. Nothing here tracks money.</Text>
        {LIMIT_FIELDS.map(({ key, label, description }) => (
          <Field key={key} id={`orchestration-limit-${key}`} label={label} description={description}>
            <Input
              id={`orchestration-limit-${key}`}
              data-testid={`orchestration-limit-${key}`}
              type="number"
              inputMode="numeric"
              min={ORCHESTRATION_LIMIT_BOUNDS[key].min}
              max={ORCHESTRATION_LIMIT_BOUNDS[key].max}
              value={shown(key)}
              disabled={saving || limits === undefined}
              aria-describedby={`orchestration-limit-${key}-description`}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
            />
          </Field>
        ))}
        <Button type="submit" className="self-start" data-testid="orchestration-limits-save" aria-disabled={saving || !changed}>
          Save limits
        </Button>
        <Text variant="caption" role="status" data-testid="orchestration-defaults-status">
          {saved ? 'Saved.' : ''}
        </Text>
      </form>
    </div>
  );
}

/** Loads and saves the install's defaults. */
export function OrchestrationDefaultsSection() {
  const query = useOrchestrationDefaults();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const save = (change: Parameters<typeof saveOrchestrationDefaults>[0]) => {
    setSaving(true);
    setError(undefined);
    setSaved(false);
    saveOrchestrationDefaults(change).then(
      async () => {
        await queryClient.invalidateQueries({ queryKey: ['orchestration-defaults'] });
        await queryClient.invalidateQueries({ queryKey: ['orchestration-settings'] });
        setSaving(false);
        setSaved(true);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "That couldn't be saved. Try again.");
      },
    );
  };
  if (query.data === undefined && query.error instanceof Error) {
    return (
      <Notice variant="blocked" role="alert" data-testid="orchestration-defaults-load-error">
        {query.error.message}
      </Notice>
    );
  }
  return (
    <DefaultsView
      mode={query.data?.mode}
      limits={query.data?.limits}
      saving={saving || query.data === undefined}
      error={error}
      saved={saved}
      onMode={(mode, confirmed) => save({ mode, ...(confirmed ? { confirm: true } : {}) })}
      onLimits={(limits) => save({ limits })}
    />
  );
}
