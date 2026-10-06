import { BUILD_WAY_LABELS, DEFAULT_BUILD_AGENT_AUTOMATIC, DEFAULT_BUILD_AGENT_HINT, DEFAULT_BUILD_AGENT_LABEL, DEFAULT_BUILD_AGENT_SAVED, MAX_TEST_COMMAND_LENGTH, RUN_LIMIT_BOUNDS, RUN_LIMITS_LABEL, RUN_TIME_LIMIT_LABEL, TEST_COMMAND_HINT, TEST_COMMAND_LABEL } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { fetchBuildAgents, fetchBuildSettings, fetchRunLimits, saveBuildSettings, saveRunLimits } from './builds-api';

/** One whole-number setting: its field, a Save button that waits for a changed valid value, and what happened. */
function NumberSetting({
  id,
  label,
  description,
  value,
  bounds,
  save,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  bounds: { min: number; max: number };
  save: (value: number) => Promise<unknown>;
}) {
  const [text, setText] = useState(String(value));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  // The saved value follows the server (another tab may change it).
  useEffect(() => setText(String(value)), [value]);
  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(parsed) && parsed >= bounds.min && parsed <= bounds.max;
  const dirty = parsed !== value;
  const submit = () => {
    if (!valid || !dirty || state === 'saving') return;
    setState('saving');
    save(parsed).then(
      () => setState('saved'),
      (error: unknown) => setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Field id={id} label={label} description={`${description} A whole number from ${bounds.min} to ${bounds.max}.`}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          className="w-28"
          min={bounds.min}
          max={bounds.max}
          value={text}
          aria-describedby={`${id}-description`}
          aria-invalid={valid ? undefined : true}
          data-testid={id}
          onChange={(event) => {
            setText(event.target.value);
            setState('idle');
          }}
        />
        <Button type="submit" variant="secondary" disabled={!valid || !dirty || state === 'saving'} data-testid={`${id}-save`}>
          Save
        </Button>
        {state === 'saved' ? (
          <span role="status" className="text-caption text-muted-foreground" data-testid={`${id}-saved`}>
            Saved
          </span>
        ) : null}
      </form>
      {typeof state === 'object' ? (
        <Notice variant="blocked" role="alert" data-testid={`${id}-error`}>
          {state.error}
        </Notice>
      ) : null}
    </Field>
  );
}

/**
 * The project's test command (story 11.2): the one the end checks re-run
 * instead of the detected one. Empty uses the detected command. Saved with
 * Save; an empty field saves `null`.
 */
function TestCommandSetting({ wsId, value, onSaved }: { wsId: string; value: string | null; onSaved: (settings: Awaited<ReturnType<typeof saveBuildSettings>>) => void }) {
  const [text, setText] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  useEffect(() => setText(value ?? ''), [value]);
  const trimmed = text.trim();
  const dirty = trimmed !== (value ?? '');
  const valid = trimmed.length <= MAX_TEST_COMMAND_LENGTH && !/[\r\n\0]/.test(text);
  const submit = () => {
    if (!dirty || !valid || state === 'saving') return;
    setState('saving');
    saveBuildSettings(wsId, { testCommand: trimmed === '' ? null : trimmed }).then(
      (saved) => {
        onSaved(saved);
        setState('saved');
      },
      (error: unknown) => setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Field id="test-command" label={TEST_COMMAND_LABEL} description={TEST_COMMAND_HINT}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          id="test-command"
          className="font-mono"
          value={text}
          maxLength={MAX_TEST_COMMAND_LENGTH}
          aria-describedby="test-command-description"
          aria-invalid={valid ? undefined : true}
          data-testid="test-command"
          onChange={(event) => {
            setText(event.target.value);
            setState('idle');
          }}
        />
        <Button type="submit" variant="secondary" disabled={!valid || !dirty || state === 'saving'} aria-label="Save the test command" data-testid="test-command-save">
          Save
        </Button>
        {state === 'saved' ? (
          <span role="status" className="text-caption text-muted-foreground" data-testid="test-command-saved">
            Saved
          </span>
        ) : null}
      </form>
      {typeof state === 'object' ? (
        <Notice variant="blocked" role="alert" data-testid="test-command-error">
          {state.error}
        </Notice>
      ) : null}
    </Field>
  );
}

/**
 * Workspace settings, Builds (epic 17): the agent a Build uses when the person picks none. Automatic follows the project's default
 * chat agent when it can build, else Claude Code. Each agent says how it would build here; one that is not ready cannot be chosen.
 */
function DefaultBuildAgentSetting({ wsId, value, onSaved }: { wsId: string; value: string | null; onSaved: (saved: Awaited<ReturnType<typeof saveBuildSettings>>) => void }) {
  const agents = useQuery({ queryKey: ['build-agents', wsId], queryFn: () => fetchBuildAgents(wsId), retry: false });
  const [state, setState] = useState<'idle' | 'saved' | { error: string }>('idle');
  // Nothing to choose between with one agent (or when the list can't be read).
  if (agents.data === undefined || agents.data.agents.length < 2) return null;
  const AUTOMATIC = 'automatic';
  const choose = (next: string) => {
    setState('idle');
    saveBuildSettings(wsId, { defaultBuildAgentId: next === AUTOMATIC ? null : next }).then(
      (saved) => {
        onSaved(saved);
        setState('saved');
      },
      (error: unknown) => setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Field id="default-build-agent" label={DEFAULT_BUILD_AGENT_LABEL} description={DEFAULT_BUILD_AGENT_HINT}>
      <RadioGroup value={value ?? AUTOMATIC} onValueChange={choose} aria-labelledby="default-build-agent-label" data-testid="default-build-agent">
        <RadioGroupOption id="default-build-agent-automatic" value={AUTOMATIC} label={DEFAULT_BUILD_AGENT_AUTOMATIC} data-testid="default-build-agent-automatic" />
        {agents.data.agents.map((agent) => (
          <RadioGroupOption
            key={agent.agentId}
            id={`default-build-agent-${agent.agentId}`}
            value={agent.agentId}
            disabled={agent.way === 'unavailable'}
            label={agent.displayName}
            description={`${BUILD_WAY_LABELS[agent.way]}${agent.reason === null ? '' : `. ${agent.reason}`}`}
            data-testid={`default-build-agent-${agent.agentId}`}
          />
        ))}
      </RadioGroup>
      {state === 'saved' ? (
        <span role="status" className="text-caption text-muted-foreground" data-testid="default-build-agent-saved">
          {DEFAULT_BUILD_AGENT_SAVED}
        </span>
      ) : null}
      {typeof state === 'object' ? (
        <Notice variant="blocked" role="alert" data-testid="default-build-agent-error">
          {state.error}
        </Notice>
      ) : null}
    </Field>
  );
}

/** Settings, Builds (story 5.8): how many builds run at once in the whole install, and how long one may take. */
export function InstallBuildLimits() {
  const queryClient = useQueryClient();
  const limits = useQuery({ queryKey: ['run-limits'], queryFn: () => fetchRunLimits(), retry: false });
  if (limits.data === undefined) {
    return limits.error === null ? null : (
      <Notice variant="blocked" role="alert" data-testid="run-limits-error">
        {limits.error.message}
      </Notice>
    );
  }
  const saveLimits = async (request: Parameters<typeof saveRunLimits>[0]) => {
    const saved = await saveRunLimits(request);
    queryClient.setQueryData(['run-limits'], saved);
  };
  return (
    <PageSection aria-label="Build limits" data-testid="run-limits">
      <NumberSetting
        id="run-limit-install"
        label={`${RUN_LIMITS_LABEL} (all projects)`}
        description="More builds wait their turn."
        value={limits.data.maxConcurrentRunsPerInstall}
        bounds={RUN_LIMIT_BOUNDS.maxConcurrentRunsPerInstall}
        save={(value) => saveLimits({ maxConcurrentRunsPerInstall: value })}
      />
      <NumberSetting
        id="run-limit-minutes"
        label={RUN_TIME_LIMIT_LABEL}
        description="A build still going after this long is stopped, and you can retry it."
        value={limits.data.maxRunMinutes}
        bounds={RUN_LIMIT_BOUNDS.maxRunMinutes}
        save={(value) => saveLimits({ maxRunMinutes: value })}
      />
    </PageSection>
  );
}

/** Workspace settings, Builds (story 5.8): how many of this project's builds run at once. Shown only with Unattended builds on. */
export function ProjectBuildLimit({ wsId }: { wsId: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['build-settings', wsId], queryFn: () => fetchBuildSettings(wsId), retry: false });
  if (settings.data === undefined) {
    return settings.error === null ? null : (
      <Notice variant="blocked" role="alert" data-testid="build-settings-error">
        {settings.error.message}
      </Notice>
    );
  }
  return (
    <PageSection title="Builds" data-testid="build-settings-section">
      <NumberSetting
        id="run-limit-project"
        label={`${RUN_LIMITS_LABEL} in this project`}
        description="More builds wait their turn."
        value={settings.data.maxConcurrentRuns}
        bounds={RUN_LIMIT_BOUNDS.maxConcurrentRunsPerWorkspace}
        save={async (value) => queryClient.setQueryData(['build-settings', wsId], await saveBuildSettings(wsId, { maxConcurrentRuns: value }))}
      />
      <DefaultBuildAgentSetting wsId={wsId} value={settings.data.defaultBuildAgentId} onSaved={(saved) => queryClient.setQueryData(['build-settings', wsId], saved)} />
      <TestCommandSetting wsId={wsId} value={settings.data.testCommand} onSaved={(saved) => queryClient.setQueryData(['build-settings', wsId], saved)} />
    </PageSection>
  );
}
