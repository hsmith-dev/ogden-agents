import {
  DELETE_AND_DISCARD_LABEL,
  TRIAL_DELETE_DESCRIPTION,
  TRIAL_DELETE_LABEL,
  TRIAL_KEEP_CONFIRM_LABEL,
  TRIAL_OTHERS_LABEL,
  TRIAL_PUT_AWAY_DESCRIPTION,
  TRIAL_PUT_AWAY_LABEL,
  trialDeleteUncommittedText,
  trialIgnoredFilesTitle,
  trialKeepTitle,
  type Trial,
  type TrialOthers,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { isApiError } from '@/api/http';
import { CopyIgnoredFiles } from '@/chat/copy-ignored-files';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { GroupLabel } from '@/ui/label';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { useChanges } from '@/workbench/changes-api';
import { keepTrial, trialsQueryKey } from './trials-api';

/** One of the other chats, as the keep dialog names it. */
export interface KeepOther {
  sessionId: string;
  agentName: string;
  /** Its copy is there to be read (not put away, not gone). */
  hasCopy: boolean;
  /** Saved changes, when its copy is put away (they go with a delete). */
  savedFiles: number;
}

export interface KeepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  trial: Trial;
  sessionId: string;
  agentName: string;
  others: readonly KeepOther[];
  /** The put-away list has settled: each put-away copy's saved changes are known. */
  putAwayLoaded: boolean;
  onKept: (trial: Trial) => void;
}

/**
 * Keep this one (27.8; EXPERIENCE.md): asks once, the user choosing what
 * happens to the others: Put away (restorable, the default) or Delete
 * (27.3's Delete chat: each copy's ignored files are listed, and copies with
 * changes not committed are named, and only their ids are sent as
 * `discard`; Confirm waits until every copy has been read). Nothing is merged. A refusal (another agent still
 * working, a copy changed since) stays in the dialog.
 */
export function KeepDialog(props: KeepDialogProps) {
  return <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>{props.open ? <KeepDialogBody {...props} /> : null}</AlertDialog>;
}

function KeepDialogBody({ wsId, trial, sessionId, agentName, others, putAwayLoaded, onKept, onOpenChange }: KeepDialogProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<TrialOthers>('put_away');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** Each other copy's uncommitted changes, as read for the delete (`true`: some, or unreadable; absent: still reading). */
  const [dirty, setDirty] = useState<Readonly<Record<string, boolean | undefined>>>({});
  /** The server said a copy changed after all (409 `uncommitted_changes`): every other one is named. */
  const [fallback, setFallback] = useState(false);
  const deleting = choice === 'delete';
  const namedOthers = fallback ? others : others.filter((other) => dirty[other.sessionId] === true || other.savedFiles > 0);
  const named = namedOthers.map((other) => other.agentName);
  // Only the chats the confirmation names lose their changes; any other changed copy is refused by the server.
  const discardIds = deleting ? namedOthers.map((other) => other.sessionId) : [];
  const discard = discardIds.length > 0;
  // A delete is confirmed only once every copy was read and the put-away list is known: nothing unnamed is discarded.
  const settled = !deleting || (putAwayLoaded && others.every((other) => !other.hasCopy || dirty[other.sessionId] !== undefined));
  const blocked = pending || !settled;

  const onConfirm = () => {
    if (blocked) return;
    setPending(true);
    setError(undefined);
    keepTrial(wsId, trial.id, { sessionId, others: choice, discard: discardIds }).then(
      (done) => {
        setPending(false);
        void queryClient.invalidateQueries({ queryKey: trialsQueryKey(wsId) });
        onOpenChange(false);
        onKept(done);
      },
      (failure: unknown) => {
        setPending(false);
        if (deleting && !discard && isApiError(failure, 'uncommitted_changes')) {
          setFallback(true);
          return;
        }
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't keep that chat. Try again.");
      },
    );
  };

  return (
    <AlertDialogContent
      data-testid="trial-keep-confirm"
      data-choice={choice}
      title={trialKeepTitle(agentName)}
      description={deleting ? TRIAL_DELETE_DESCRIPTION : TRIAL_PUT_AWAY_DESCRIPTION}
      details={
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <GroupLabel id={`${id}-others`}>{TRIAL_OTHERS_LABEL}</GroupLabel>
            <RadioGroup aria-labelledby={`${id}-others`} value={choice} onValueChange={(next) => setChoice(next === 'delete' ? 'delete' : 'put_away')}>
              <RadioGroupOption id={`${id}-put-away`} value="put_away" label={TRIAL_PUT_AWAY_LABEL} data-testid="trial-keep-put-away" />
              <RadioGroupOption id={`${id}-delete`} value="delete" label={TRIAL_DELETE_LABEL} data-testid="trial-keep-delete" />
            </RadioGroup>
          </div>
          {deleting ? (
            <>
              {others.map((other) =>
                other.hasCopy ? <OtherCopy key={other.sessionId} wsId={wsId} other={other} onDirty={(changed) => setDirty((current) => (current[other.sessionId] === changed ? current : { ...current, [other.sessionId]: changed }))} /> : null,
              )}
              {named.length === 0 ? null : (
                <p className="m-0 text-label text-destructive" data-testid="trial-keep-uncommitted">
                  {trialDeleteUncommittedText(named)}
                </p>
              )}
            </>
          ) : null}
        </div>
      }
      error={error}
    >
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogConfirm aria-disabled={blocked || undefined} onClick={onConfirm} data-testid="trial-keep-confirm-button">
        {pending ? 'Keeping...' : discard ? DELETE_AND_DISCARD_LABEL : TRIAL_KEEP_CONFIRM_LABEL}
      </AlertDialogConfirm>
    </AlertDialogContent>
  );
}

/** One other copy a delete removes: its ignored files, and whether it has changes not committed (staged or not). */
function OtherCopy({ wsId, other, onDirty }: { wsId: string; other: KeepOther; onDirty: (changed: boolean | undefined) => void }) {
  const unstaged = useChanges(wsId, { view: 'unstaged', session: other.sessionId });
  const staged = useChanges(wsId, { view: 'staged', session: other.sessionId });
  // Unreadable counts as changed, as the server counts it.
  // Absent until both views have settled.
  const changed = unstaged.isPending || staged.isPending ? undefined :
    unstaged.isError || staged.isError || (unstaged.data !== undefined && (unstaged.data.files.length > 0 || unstaged.data.truncated)) || (staged.data !== undefined && (staged.data.files.length > 0 || staged.data.truncated));
  useEffect(() => onDirty(changed), [changed, onDirty]);
  return (
    <div className="flex flex-col gap-1" data-testid="trial-keep-copy" data-session={other.sessionId}>
      <Text variant="label">{trialIgnoredFilesTitle(other.agentName)}</Text>
      <CopyIgnoredFiles wsId={wsId} sesId={other.sessionId} enabled />
    </div>
  );
}
