import {
  agentMidTurnText,
  CHANGES_DIFFS_FETCHED,
  CHANGES_DIFFS_LOADING_TEXT,
  CHANGES_LOADING_TEXT,
  CHANGES_LATEST_TURN_LABEL,
  CHANGES_NO_TURNS_TEXT,
  CHANGES_TURN_PICKER_LABEL,
  CHANGES_VIEW_LABELS,
  CHANGES_VIEW_SWITCH_LABEL,
  changesEmptyText,
  changesMoreFilesText,
  COMMIT_MESSAGE_LABEL,
  COMMIT_WORKTREE_LABEL,
  committedText,
  MAX_COMMIT_MESSAGE_CHARS,
  turnPickerText,
  WORKTREE_NEVER_PUSHED_TEXT,
  type ChangesView,
  type TurnSummary,
} from '@ogden-agents/shared';
import { CaretDown } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { fetchSession } from '@/chat/chat-api';
import { Button } from '@/ui/button';
import { DiffFileList, DiffViewer, type DiffFileData, type DiffViewerHandle } from '@/ui/diff-viewer';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Textarea } from '@/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { Text } from '@/ui/typography';
import { useChanges, useCommitWorktree, useFileDiffs, useTurns, type ChangesTarget } from './changes-api';

/** Where the panel goes next: a view, and for This turn the turn picked. */
export interface ChangesNavigation {
  view: ChangesView;
  turn?: string | undefined;
}

export interface WorkbenchChangesProps {
  wsId: string;
  /** The view asked for (`?view=`); absent: This turn for a chat, else Unstaged. */
  view?: ChangesView | undefined;
  /** The chat (`?session=`): its folder's changes, This turn, and its worktree's Commit. */
  session?: string | undefined;
  /** This turn's turn (`?turn=`); absent: the latest. */
  turn?: string | undefined;
  onNavigate: (next: ChangesNavigation) => void;
}

/** The views a panel offers: This turn only for a chat. */
const viewsFor = (session: string | undefined): ChangesView[] => (session === undefined ? ['unstaged', 'staged', 'branch'] : ['turn', 'unstaged', 'staged', 'branch']);

/** A turn's time in the picker, to the second (two quick turns stay apart). */
const timeOf = (at: string): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The Workbench's Changes panel (AD-37; story 8.4, EXPERIENCE.md Changes):
 * the view switch (This turn for a chat, Unstaged, Staged, Branch), the
 * turn picker for This turn, the view's files (each a button that jumps to
 * its diff) over the shared diff viewer, the first
 * {@link CHANGES_DIFFS_FETCHED} files' diffs fetched, and, for a chat with a
 * worktree of its own, Commit these changes. No hunk action yet (8.5).
 */
export function WorkbenchChanges({ wsId, view, session, turn, onNavigate }: WorkbenchChangesProps) {
  const views = viewsFor(session);
  const asked = view ?? (session === undefined ? 'unstaged' : 'turn');
  const shown: ChangesView = views.includes(asked) ? asked : 'unstaged';
  const target: ChangesTarget = { view: shown, session, turn: shown === 'turn' ? turn : undefined };
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="workbench-changes" data-view={shown}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          aria-label={CHANGES_VIEW_SWITCH_LABEL}
          value={shown}
          onValueChange={(value) => {
            const next = views.find((candidate) => candidate === value);
            if (next !== undefined) onNavigate({ view: next });
          }}
          className="h-auto flex-wrap"
          data-testid="changes-view"
        >
          {views.map((value) => (
            <ToggleGroupItem key={value} value={value} data-testid={`changes-view-${value}`}>
              {CHANGES_VIEW_LABELS[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {shown === 'turn' && session !== undefined ? <TurnPicker wsId={wsId} session={session} turn={turn} onPick={(picked) => onNavigate({ view: 'turn', turn: picked })} /> : null}
      </div>
      {session === undefined ? null : <WorktreeCommit wsId={wsId} sesId={session} />}
      <ChangesList key={`${shown}\0${session ?? ''}\0${target.turn ?? ''}`} wsId={wsId} target={target} />
    </div>
  );
}

/** This turn's turn: the latest, or one picked from the chat's recorded turns (newest first). */
function TurnPicker({ wsId, session, turn, onPick }: { wsId: string; session: string; turn: string | undefined; onPick: (turn: string) => void }) {
  const turns = useTurns(wsId, session);
  const list: TurnSummary[] = turns.data?.turns ?? [];
  if (list.length === 0) return null;
  const selected = list.find((one) => one.id === turn) ?? list[0]!;
  const label = selected === list[0] && turn === undefined ? CHANGES_LATEST_TURN_LABEL : turnPickerText(timeOf(selected.at), selected.files);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="changes-turn-picker" data-turn={selected.id} className="min-w-0 max-w-full">
          <span className="text-muted-foreground">{CHANGES_TURN_PICKER_LABEL}</span>
          <span className="truncate">{label}</span>
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="changes-turn-picker-menu" className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
        <DropdownMenuLabel>{CHANGES_TURN_PICKER_LABEL}</DropdownMenuLabel>
        {list.map((one) => (
          <DropdownMenuChoiceItem
            key={one.id}
            data-testid="changes-turn-option"
            data-turn={one.id}
            checked={one.id === selected.id}
            label={turnPickerText(timeOf(one.at), one.files)}
            description={`+${one.additions} -${one.deletions}`}
            onSelect={() => onPick(one.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The view's files and their diffs. */
function ChangesList({ wsId, target }: { wsId: string; target: ChangesTarget }) {
  const changes = useChanges(wsId, target);
  const files = useMemo(() => changes.data?.files ?? [], [changes.data]);
  // This turn's diffs are read for the turn the list is of (the latest, when none was named).
  const diffTarget: ChangesTarget = { ...target, turn: changes.data?.turn ?? target.turn };
  const fetched = useMemo(() => files.slice(0, CHANGES_DIFFS_FETCHED).map((file) => file.path), [files]);
  const diffs = useFileDiffs(wsId, diffTarget, fetched);
  const viewer = useRef<DiffViewerHandle>(null);
  const loaded: DiffFileData[] = useMemo(() => diffs.flatMap((diff) => (diff.data === undefined ? [] : [{ file: diff.data.file, hunks: diff.data.hunks }])), [diffs]);
  const items = useMemo(() => {
    const byPath = new Set(loaded.map(({ file }) => file.path));
    return files.map((file) => ({ path: file.path, change: file.change, additions: file.additions, deletions: file.deletions, jumpable: byPath.has(file.path) }));
  }, [files, loaded]);

  if (changes.isError) {
    return (
      <Notice variant="blocked" data-testid="changes-error">
        {changes.error.message}
      </Notice>
    );
  }
  if (!changes.isSuccess) {
    return (
      <div className="flex flex-col gap-2" data-testid="changes-loading">
        <span role="status" className="sr-only">
          {CHANGES_LOADING_TEXT}
        </span>
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (target.view === 'turn' && changes.data.turn === undefined) {
    return (
      <Text variant="caption" data-testid="changes-empty">
        {CHANGES_NO_TURNS_TEXT}
      </Text>
    );
  }
  if (files.length === 0) {
    return (
      <Text variant="caption" data-testid="changes-empty">
        {changesEmptyText(target.view, changes.data.base)}
      </Text>
    );
  }
  const failed = diffs.find((diff) => diff.isError);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="changes-files">
      <DiffFileList items={items} onSelect={(path) => viewer.current?.jumpTo(path)} data-testid="changes-file-list" />
      {changes.data.truncated || files.length > CHANGES_DIFFS_FETCHED ? (
        <Text variant="caption" data-testid="changes-more">
          {changesMoreFilesText(Math.min(files.length, CHANGES_DIFFS_FETCHED))}
        </Text>
      ) : null}
      {failed?.error ? (
        <Notice variant="blocked" data-testid="changes-diff-error">
          {failed.error.message}
        </Notice>
      ) : null}
      {loaded.length === 0 ? (
        <div className="flex flex-col gap-2">
          <span role="status" className="sr-only">
            {CHANGES_DIFFS_LOADING_TEXT}
          </span>
          <Skeleton />
        </div>
      ) : (
        <DiffViewer ref={viewer} files={loaded} label={CHANGES_VIEW_LABELS[target.view]} />
      )}
    </div>
  );
}

/** Commit these changes, for a chat working in its own worktree: on its own branch, never pushed. */
function WorktreeCommit({ wsId, sesId }: { wsId: string; sesId: string }) {
  const session = useQuery({
    queryKey: ['session', wsId, sesId],
    queryFn: () => fetchSession(wsId, sesId),
    retry: false,
    // While its agent works, the state is read again so Commit comes back once it is done.
    refetchInterval: (query) => (query.state.data?.session.state === 'working' || query.state.data?.session.state === 'waiting' ? 2000 : false),
  });
  const commit = useCommitWorktree(wsId, sesId);
  const [message, setMessage] = useState('');
  const found = session.data?.session;
  if (found === undefined || found.worktreePath === null) return null;
  const busy = found.state === 'working' || found.state === 'waiting';
  const empty = message.trim() === '';
  return (
    <form
      className="flex min-w-0 flex-col gap-2"
      data-testid="worktree-commit"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || empty || commit.isPending) return;
        commit.mutate(message.trim(), { onSuccess: () => setMessage('') });
      }}
    >
      <Field id="worktree-commit-message" label={COMMIT_MESSAGE_LABEL} description={WORKTREE_NEVER_PUSHED_TEXT}>
        <Textarea
          id="worktree-commit-message"
          aria-describedby="worktree-commit-message-description"
          value={message}
          maxLength={MAX_COMMIT_MESSAGE_CHARS}
          onChange={(event) => setMessage(event.target.value)}
          data-testid="worktree-commit-message"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" aria-disabled={busy || empty || commit.isPending || undefined} data-testid="worktree-commit-button">
          {COMMIT_WORKTREE_LABEL}
        </Button>
        {busy ? (
          <Text variant="caption" data-testid="worktree-commit-busy">
            {agentMidTurnText('The agent')}
          </Text>
        ) : null}
        {commit.isSuccess ? (
          <Text variant="caption" role="status" data-testid="worktree-committed">
            {committedText(commit.data.files)}
          </Text>
        ) : null}
      </div>
      {commit.isError ? (
        <Notice variant="blocked" data-testid="worktree-commit-error">
          {commit.error.message}
        </Notice>
      ) : null}
    </form>
  );
}
