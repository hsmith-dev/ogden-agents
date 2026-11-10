import {
  BUILD_WAY_LABELS,
  COPY_PATTERNS_HINT,
  COPY_PATTERNS_LABEL,
  CopyPattern,
  DEFAULT_BUILD_AGENT_AUTOMATIC,
  DEFAULT_BUILD_AGENT_HINT,
  DEFAULT_BUILD_AGENT_LABEL,
  DEFAULT_BUILD_AGENT_SAVED,
  MAX_COPY_PATTERNS,
  MAX_SETUP_COMMAND_LENGTH,
  MAX_TEST_COMMAND_LENGTH,
  RUN_LIMIT_BOUNDS,
  RUN_LIMITS_LABEL,
  RUN_TIME_LIMIT_LABEL,
  SETUP_COMMAND_HINT,
  SETUP_COMMAND_LABEL,
  TEST_COMMAND_HINT,
  TEST_COMMAND_LABEL,
  type UpdateWorkspaceBuildSettingsRequest,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Textarea } from '@/ui/textarea';
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
 * One of the project's one-line commands: the test command (story 11.2), the
 * one the end checks re-run instead of the detected one, or the setup command
 * (epic 26), run in each build's copy before its agent. Saved with Save; an
 * empty field saves `null` (detect it, or run none).
 */
function CommandSetting({
  wsId,
  id,
  label,
  hint,
  what,
  maxLength,
  value,
  request,
  onSaved,
}: {
  wsId: string;
  id: string;
  label: string;
  hint: string;
  /** For the Save button's label: "the test command". */
  what: string;
  maxLength: number;
  value: string | null;
  request: (command: string | null) => UpdateWorkspaceBuildSettingsRequest;
  onSaved: (settings: Awaited<ReturnType<typeof saveBuildSettings>>) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  useEffect(() => setText(value ?? ''), [value]);
  const trimmed = text.trim();
  const dirty = trimmed !== (value ?? '');
  const valid = trimmed.length <= maxLength && !/[\r\n\0]/.test(text);
  const submit = () => {
    if (!dirty || !valid || state === 'saving') return;
    setState('saving');
    saveBuildSettings(wsId, request(trimmed === '' ? null : trimmed)).then(
      (saved) => {
        onSaved(saved);
        setState('saved');
      },
      (error: unknown) => setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Field id={id} label={label} description={hint}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          id={id}
          className="font-mono"
          value={text}
          maxLength={maxLength}
          aria-describedby={`${id}-description`}
          aria-invalid={valid ? undefined : true}
          data-testid={id}
          onChange={(event) => {
            setText(event.target.value);
            setState('idle');
          }}
        />
        <Button type="submit" variant="secondary" disabled={!valid || !dirty || state === 'saving'} aria-label={`Save ${what}`} data-testid={`${id}-save`}>
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
 * The ignored files copied into each build's copy (epic 26): one pattern a
 * line, checked as typed with the same rules the server applies; an empty
 * list copies nothing.
 */
function CopyPatternsSetting({ wsId, value, onSaved }: { wsId: string; value: readonly string[]; onSaved: (settings: Awaited<ReturnType<typeof saveBuildSettings>>) => void }) {
  const [text, setText] = useState(value.join('\n'));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  useEffect(() => setText(value.join('\n')), [value]);
  const patterns = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const problem = patterns.length > MAX_COPY_PATTERNS ? `A project can list at most ${MAX_COPY_PATTERNS} patterns.` : patterns.map((pattern) => CopyPattern.safeParse(pattern)).find((each) => !each.success)?.error?.issues[0]?.message;
  const dirty = patterns.join('\n') !== value.join('\n');
  const submit = () => {
    if (!dirty || problem !== undefined || state === 'saving') return;
    setState('saving');
    saveBuildSettings(wsId, { copyPatterns: [...new Set(patterns)] }).then(
      (saved) => {
        onSaved(saved);
        setState('saved');
      },
      (error: unknown) => setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Field id="copy-patterns" label={COPY_PATTERNS_LABEL} description={COPY_PATTERNS_HINT}>
      <form
        className="flex flex-col items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          id="copy-patterns"
          className="font-mono"
          value={text}
          placeholder={'.env\nnode_modules'}
          aria-describedby="copy-patterns-description"
          aria-invalid={problem === undefined ? undefined : true}
          data-testid="copy-patterns"
          onChange={(event) => {
            setText(event.target.value);
            setState('idle');
          }}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary" disabled={problem !== undefined || !dirty || state === 'saving'} aria-label="Save the files to copy" data-testid="copy-patterns-save">
            Save
          </Button>
          {state === 'saved' ? (
            <span role="status" className="text-caption text-muted-foreground" data-testid="copy-patterns-saved">
              Saved
            </span>
          ) : null}
        </div>
      </form>
      {problem !== undefined || typeof state === 'object' ? (
        <Notice variant="blocked" role="alert" data-testid="copy-patterns-error">
          {problem ?? (typeof state === 'object' ? state.error : '')}
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
    <Field id="default-build-agent" control="group" label={DEFAULT_BUILD_AGENT_LABEL} description={DEFAULT_BUILD_AGENT_HINT}>
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
  const onSaved = (saved: Awaited<ReturnType<typeof saveBuildSettings>>) => queryClient.setQueryData(['build-settings', wsId], saved);
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
      <DefaultBuildAgentSetting wsId={wsId} value={settings.data.defaultBuildAgentId} onSaved={onSaved} />
      <CommandSetting
        wsId={wsId}
        id="test-command"
        label={TEST_COMMAND_LABEL}
        hint={TEST_COMMAND_HINT}
        what="the test command"
        maxLength={MAX_TEST_COMMAND_LENGTH}
        value={settings.data.testCommand}
        request={(testCommand) => ({ testCommand })}
        onSaved={onSaved}
      />
      <CopyPatternsSetting wsId={wsId} value={settings.data.copyPatterns} onSaved={onSaved} />
      <CommandSetting
        wsId={wsId}
        id="setup-command"
        label={SETUP_COMMAND_LABEL}
        hint={SETUP_COMMAND_HINT}
        what="the setup command"
        maxLength={MAX_SETUP_COMMAND_LENGTH}
        value={settings.data.setupCommand}
        request={(setupCommand) => ({ setupCommand })}
        onSaved={onSaved}
      />
    </PageSection>
  );
}
