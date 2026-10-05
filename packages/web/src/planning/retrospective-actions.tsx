import { ADD_LESSONS_FAILED, EPIC_SLUG_PATTERN, LESSONS_SAVED_TEXT, SAVE_LESSONS_FAILED, RETROSPECTIVE_FILE_SUFFIX, SAVE_LESSONS_LABEL, SAVE_LESSONS_NOTE, type Session } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { fetchCatalog, saveLessons, startRetrospectiveStep } from './planning-api';

/**
 * The epic a retrospective document belongs to: the name of the folder it is
 * in (`<output>/<initiative>/<epic>/<name>-retrospective.md`), or `undefined`
 * for any other document.
 */
export function retrospectiveEpicOf(path: string): string | undefined {
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined;
  const name = parts.at(-1) ?? '';
  const epic = parts.at(-2);
  if (!name.endsWith(RETROSPECTIVE_FILE_SUFFIX) || name.length === RETROSPECTIVE_FILE_SUFFIX.length || epic === undefined || !EPIC_SLUG_PATTERN.test(epic)) return undefined;
  return epic;
}

/**
 * What a retrospective's document card adds (epic 7, story 7.5; EXPERIENCE.md
 * Planning session): the look-back action's further next steps, each an agent
 * conversation the user approves (the catalog gives their labels), and Save
 * the lessons for later builds with one line saying later builds will follow
 * them. Shown only with Retrospectives on. A refusal says why in the server's
 * plain words; the agent edits AGENTS.md and the tickets, Ogden Agents only
 * commits on the click.
 */
export function RetrospectiveActions({ wsId, epic, onStarted }: { wsId: string; epic: string; onStarted: (session: Session) => void }) {
  const on = useWorkspaceSettings(wsId).data?.bmadPieces.includes('retrospectives') === true;
  const catalog = useQuery({ queryKey: ['catalog', wsId], queryFn: () => fetchCatalog(wsId), enabled: on, retry: false });
  const [busy, setBusy] = useState<'step' | 'save' | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  if (!on) return null;
  const nexts = catalog.data?.skills.find((skill) => skill.scope === 'epic')?.nexts ?? [];

  const run = (kind: 'step' | 'save', work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    setError(undefined);
    setSaved(false);
    work()
      .catch((failure: unknown) => setError(failure instanceof Error && failure.message !== '' ? failure.message : `${kind === 'save' ? SAVE_LESSONS_FAILED : ADD_LESSONS_FAILED}. Try again.`))
      .finally(() => {
        pending.current = false;
        setBusy(undefined);
      });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="retrospective-actions">
      <div className="flex flex-wrap items-center gap-2">
        {nexts.map((step) => (
          <Button
            key={step.skill}
            variant="outline"
            aria-disabled={busy !== undefined || undefined}
            data-testid="retrospective-step"
            data-skill={step.skill}
            onClick={() => (busy === undefined ? run('step', async () => onStarted(await startRetrospectiveStep(wsId, epic, step.skill))) : undefined)}
          >
            {step.label}
          </Button>
        ))}
        <Button
          variant="outline"
          aria-disabled={busy !== undefined || undefined}
          aria-busy={busy === 'save' || undefined}
          data-testid="retrospective-save"
          onClick={() =>
            busy === undefined
              ? run('save', async () => {
                  await saveLessons(wsId, epic);
                  setSaved(true);
                })
              : undefined
          }
        >
          {SAVE_LESSONS_LABEL}
        </Button>
      </div>
      <Text variant="caption" tone="muted" role="status" data-testid="retrospective-save-note">
        {saved ? LESSONS_SAVED_TEXT : SAVE_LESSONS_NOTE}
      </Text>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="retrospective-error">
          {error}
        </Text>
      )}
    </div>
  );
}
