import {
  MAX_PROJECT_COMMAND_CHARS,
  WORKTREE_SETUP_COMMAND_ID,
  WORKTREE_SETUP_COMMAND_LABEL,
  WORKTREE_SETUP_HINT,
  WORKTREE_SETUP_LABEL,
  WORKTREE_SETUP_REMOVE_LABEL,
  WORKTREE_SETUP_REMOVED_TEXT,
  WORKTREE_SETUP_SAVE_LABEL,
  WORKTREE_SETUP_SAVED_TEXT,
  WORKTREE_SETUP_TITLE,
  WORKTREE_SETUP_UNTRUSTED_TEXT,
  type ProjectCommandInput,
  type ProjectCommandsResponse,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isApiError } from '@/api/http';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { keptInput, projectCommandsKey, saveProjectCommands, useProjectCommands } from '@/workbench/problems-api';
import { ProblemsTrust } from '@/workbench/workbench-problems';

/** The commands with the setup command set to `text`, or without it (`null`); every other command kept as it is. */
export function withSetup(data: ProjectCommandsResponse, text: string | null): ProjectCommandInput[] {
  const others = data.declared.filter((command) => command.id !== WORKTREE_SETUP_COMMAND_ID).map(keptInput);
  return text === null ? others : [...others, { id: WORKTREE_SETUP_COMMAND_ID, label: WORKTREE_SETUP_LABEL, command: text, source: 'settings', confirmedText: text }];
}

type Status = { kind: 'saved' | 'error'; text: string } | undefined;

/** The section's body: the command field with Save and Remove, or the trust prompt in a project not trusted yet. */
function WorktreeSetupView({
  wsId,
  current,
  untrusted,
  saving,
  status,
  onSave,
  onRemove,
  onTrusted,
}: {
  wsId: string;
  /** The declared setup command's text, `null` when none; `undefined` while it loads. */
  current: string | null | undefined;
  untrusted: boolean;
  saving: boolean;
  status: Status;
  onSave: (text: string) => void;
  onRemove: () => void;
  onTrusted: () => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const text = draft ?? current ?? '';
  const empty = text.trim() === '';
  return (
    <PageSection title={WORKTREE_SETUP_TITLE} data-testid="worktree-setup-section">
      <Text>{WORKTREE_SETUP_HINT}</Text>
      {untrusted ? (
        <ProblemsTrust wsId={wsId} onTrusted={onTrusted} text={WORKTREE_SETUP_UNTRUSTED_TEXT} testId="worktree-setup-trust" />
      ) : current === undefined ? null : (
        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (empty || saving) return;
            onSave(text.trim());
            setDraft(undefined);
          }}
        >
          <Field id="worktree-setup-command" label={WORKTREE_SETUP_COMMAND_LABEL}>
            <Input
              id="worktree-setup-command"
              className="font-mono"
              value={text}
              maxLength={MAX_PROJECT_COMMAND_CHARS}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setDraft(event.target.value)}
              data-testid="worktree-setup-input"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" aria-disabled={empty || saving || undefined} data-testid="worktree-setup-save">
              {WORKTREE_SETUP_SAVE_LABEL}
            </Button>
            {current === null ? null : (
              <Button
                type="button"
                variant="outline"
                aria-disabled={saving || undefined}
                data-testid="worktree-setup-remove"
                onClick={() => {
                  if (saving) return;
                  setDraft(undefined);
                  onRemove();
                }}
              >
                {WORKTREE_SETUP_REMOVE_LABEL}
              </Button>
            )}
          </div>
        </form>
      )}
      {status === undefined ? null : (
        <Text variant="caption" role={status.kind === 'error' ? 'alert' : 'status'} data-testid="worktree-setup-status">
          {status.text}
        </Text>
      )}
    </PageSection>
  );
}

/** Workspace settings' Worktree setup (27.7): the project's setup command, stored with its test and lint commands. */
export function WorktreeSetupSection({ wsId }: { wsId: string }) {
  const commands = useProjectCommands(wsId);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(undefined);
  const untrusted = commands.isError && isApiError(commands.error, 'scripts_not_trusted');
  const declared = commands.data?.declared.find((command) => command.id === WORKTREE_SETUP_COMMAND_ID);
  const current = commands.data === undefined ? undefined : (declared?.command ?? null);

  const save = (text: string | null) => {
    const data = commands.data;
    if (data === undefined || saving) return;
    setSaving(true);
    setStatus(undefined);
    saveProjectCommands(wsId, withSetup(data, text)).then(
      (saved) => {
        queryClient.setQueryData(projectCommandsKey(wsId), saved);
        setSaving(false);
        setStatus({ kind: 'saved', text: text === null ? WORKTREE_SETUP_REMOVED_TEXT : WORKTREE_SETUP_SAVED_TEXT });
      },
      (failure: unknown) => {
        setSaving(false);
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The setup command couldn't be saved. Try again." });
        void queryClient.invalidateQueries({ queryKey: projectCommandsKey(wsId) });
      },
    );
  };

  const loadError = commands.isError && !untrusted ? commands.error.message : undefined;
  return (
    <WorktreeSetupView
      wsId={wsId}
      current={current}
      untrusted={untrusted}
      saving={saving}
      status={status ?? (loadError === undefined ? undefined : { kind: 'error', text: loadError })}
      onSave={(text) => save(text)}
      onRemove={() => save(null)}
      onTrusted={() => void commands.refetch()}
    />
  );
}
