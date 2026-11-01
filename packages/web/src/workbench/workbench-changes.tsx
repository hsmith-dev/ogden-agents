import {
  agentMidTurnText,
  agentStartedHereText,
  CHANGES_DIFFS_FETCHED,
  CHANGES_DIFFS_LOADING_TEXT,
  CHANGES_LOADING_TEXT,
  CHANGES_LATEST_TURN_LABEL,
  CHANGES_NO_TURNS_TEXT,
  CHANGES_TURN_PICKER_LABEL,
  CHANGES_VIEW_LABELS,
  CHANGES_VIEW_SWITCH_LABEL,
  changesEmptyText,
  chatName,
  COMMENTS_NOT_HANDED_TEXT,
  COMMENTS_OPEN_IN_CHAT_TEXT,
  NEW_CHAT_NAME,
  reviewCommentsText,
  SEND_TO_LABEL,
  sendCommentsLabel,
  changesMoreFilesText,
  fileActionName,
  HUNK_ACTION_LABELS,
  HUNK_REVERTED_LABEL,
  HUNK_ACTIONS_BY_VIEW,
  hunkActionName,
  PUT_BACK_TEXT,
  REVERT_CONFIRM_DESCRIPTION,
  REVERT_CONFIRM_TITLE,
  revertedText,
  turnPickerText,
  UNDO_GONE_TEXT,
  UNDO_LABEL,
  type ChangedFile,
  type ChangesView,
  type DiffHunk,
  type HunkAction,
  type TurnSummary,
} from '@ogden-agents/shared';
import { CaretDown } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { isApiError } from '@/api/http';
import { agentNameOf } from '@/chat/chat-api';
import { chatDraftKey, newChatDraftKey, readDraft, writeDraft } from '@/chat/drafts';
import { useChatAgents } from '@/chat/use-chat-agents';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { hunkRangeText } from '@/ui/diff/diff-file';
import { DiffFileList, DiffViewer, type DiffFileData, type DiffSlots, type DiffViewerHandle } from '@/ui/diff-viewer';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { withOpenInEditor } from './open-in-editor';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { Text } from '@/ui/typography';
import { isBusy, useSessions } from '@/workspaces/workspace-api';
import { useChanges, useFileDiffs, useHunkAction, useTurns, useUndoRevert, type ChangesTarget, type HunkActionBody } from './changes-api';
import { lineCommentsKey, useLineComments, type LineCommentsState } from './line-comments';
import { chatWorktree } from './chat-folder';
import { CommentsBar, useLineCommentSlots } from './line-comments-ui';
import { appendDraft } from './problems-api';
import { WorktreeCommit } from './worktree-commit';

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
 * worktree of its own, Commit these changes.
 *
 * Story 8.5: each hunk and each file has its view's actions (Stage and
 * Revert in Unstaged, Unstage in Staged, Revert in This turn, none in
 * Branch); Revert confirms once, then offers Undo while the panel is open.
 * Every action is disabled while an agent works in the panel's folder (the
 * chat's worktree, else the project); one that started since the click,
 * or a hunk that changed since it was shown, is said in the panel and the
 * diffs are read again.
 *
 * Story 8.6: a Comment button on every line; saved comments (kept in this
 * browser, per chat or for the project) collect in **Comments to send (N)**,
 * whose **Send to <agent>** (This turn: the panel's chat; else a Send to
 * picker of the project's chats and New chat) puts one composed message in
 * that chat's composer and opens it: the user reads it and sends it there.
 */
export function WorkbenchChanges({ wsId, view, session, turn, onNavigate }: WorkbenchChangesProps) {
  const views = viewsFor(session);
  const asked = view ?? (session === undefined ? 'unstaged' : 'turn');
  const shown: ChangesView = views.includes(asked) ? asked : 'unstaged';
  const target: ChangesTarget = { view: shown, session, turn: shown === 'turn' ? turn : undefined };
  const actions = useChangesActions(wsId, session);
  const comments = useLineComments(lineCommentsKey(wsId, session ?? 'project'));
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
      {session === undefined ? null : <WorktreeCommit wsId={wsId} session={session} />}
      {actions.panel}
      <ChangesList key={`${shown}\0${session ?? ''}\0${target.turn ?? ''}`} wsId={wsId} target={target} slotsFor={actions.slotsFor} comments={comments} />
    </div>
  );
}

/** The name of a file's last segment. */
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * The agent working in the panel's folder, by name: a local chat (never a
 * build, never a remote machine's) that is working or waiting in the same
 * worktree as the panel's chat, or in the project when it has none.
 */
function useBusyAgent(wsId: string, session: string | undefined): string | undefined {
  const { sessions } = useSessions(wsId);
  const agents = useChatAgents(wsId);
  if (sessions === undefined) return undefined;
  const folder = chatWorktree(sessions.find((one) => one.id === session));
  const busy = sessions.find((one) => one.kind !== 'build' && one.machineId === null && isBusy(one) && chatWorktree(one) === folder);
  return busy === undefined ? undefined : agentNameOf(agents.data, busy.agentId ?? undefined);
}

/** A hunk or file action waiting for Revert's confirmation. */
interface PendingRevert {
  target: ChangesTarget;
  file: ChangedFile;
  hunk?: DiffHunk | undefined;
  ids: string[];
}

/** The last revert, its Undo, and whether it was put back. */
interface RevertDone {
  target: ChangesTarget;
  path: string;
  /** The hunk ids it reverted (This turn keeps showing them). */
  ids: string[];
  text: string;
  undo: string;
  putBack: boolean;
}

/** A refusal said in the panel: an agent started here, or the server's own sentence. */
type Refusal = { kind: 'mid_turn' } | { kind: 'text'; text: string };

/** Hunk and file actions: each view's buttons as diff viewer slots, Revert's confirmation, the busy line, the notices and Undo. */
function useChangesActions(wsId: string, session: string | undefined) {
  const busyAgent = useBusyAgent(wsId, session);
  const hunkAction = useHunkAction(wsId);
  const undoRevert = useUndoRevert(wsId);
  const [confirm, setConfirm] = useState<PendingRevert | undefined>(undefined);
  const [done, setDone] = useState<RevertDone | undefined>(undefined);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  // This turn's hunks reverted while the panel is open, by view, chat, turn, file and hunk: the snapshots still show them.
  const [reverted, setReverted] = useState<ReadonlySet<string>>(() => new Set());
  const revertKey = (target: ChangesTarget, path: string, id: string) => JSON.stringify([target.view, target.session ?? '', target.turn ?? '', path, id]);
  const markReverted = (target: ChangesTarget, path: string, ids: readonly string[], on: boolean) =>
    setReverted((was) => {
      const next = new Set(was);
      for (const id of ids) {
        if (on) next.add(revertKey(target, path, id));
        else next.delete(revertKey(target, path, id));
      }
      return next;
    });
  const pending = hunkAction.isPending || undoRevert.isPending;
  const disabled = busyAgent !== undefined || pending;

  const refused = (error: unknown, gone?: string): void => {
    if (isApiError(error, 'agent_mid_turn')) setRefusal({ kind: 'mid_turn' });
    else if (gone !== undefined && isApiError(error, 'not_found')) setRefusal({ kind: 'text', text: gone });
    else setRefusal({ kind: 'text', text: error instanceof Error ? error.message : String(error) });
  };

  const run = (target: ChangesTarget, action: HunkAction, file: ChangedFile, hunk: DiffHunk | undefined, ids: string[]): void => {
    if (disabled) return;
    const request: HunkActionBody = {
      action,
      view: target.view,
      path: file.path,
      ...(hunk === undefined ? { hunkIds: ids } : { hunkId: hunk.id }),
      ...(target.session === undefined ? {} : { session: target.session }),
      ...(target.view === 'turn' && target.turn !== undefined ? { turn: target.turn } : {}),
    };
    setRefusal(undefined);
    hunkAction.mutate(request, {
      onSuccess: (answer) => {
        if (action === 'revert' && answer.undo !== undefined) {
          const done = hunk === undefined ? ids : [hunk.id];
          if (target.view === 'turn') markReverted(target, file.path, done, true);
          setDone({ target, path: file.path, ids: done, text: revertedText(nameOf(file.path), hunk === undefined ? undefined : hunkRangeText(hunk)), undo: answer.undo, putBack: false });
        }
      },
      onError: (error) => refused(error),
      onSettled: () => setConfirm(undefined),
    });
  };

  const undo = (): void => {
    if (done === undefined || done.putBack || disabled) return;
    setRefusal(undefined);
    undoRevert.mutate(
      { undo: done.undo, path: done.path, view: done.target.view, ...(done.target.session === undefined ? {} : { session: done.target.session }) },
      {
        onSuccess: () => {
          markReverted(done.target, done.path, done.ids, false);
          setDone({ ...done, putBack: true });
        },
        onError: (error) => {
          if (isApiError(error, 'not_found')) setDone(undefined);
          refused(error, UNDO_GONE_TEXT);
        },
      },
    );
  };

  const ask = (target: ChangesTarget, action: HunkAction, file: ChangedFile, hunk: DiffHunk | undefined, ids: string[]): void => {
    if (disabled) return;
    if (action === 'revert') setConfirm({ target, file, hunk, ids });
    else run(target, action, file, hunk, ids);
  };

  /** The viewer's slots for `target`'s files (`data`: their hunks, for a whole file's ids). */
  const slotsFor = (target: ChangesTarget, data: readonly DiffFileData[]): DiffSlots => {
    const offered = HUNK_ACTIONS_BY_VIEW[target.view];
    if (offered.length === 0) return {};
    const hunksOf = new Map(data.map((entry) => [entry.file.path, entry.hunks]));
    const button = (action: HunkAction, name: string, onClick: () => void, testId: string) => (
      <Button
        key={action}
        type="button"
        size="sm"
        variant={action === 'revert' ? 'destructive' : 'outline'}
        aria-label={name}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        data-action={action}
        onClick={onClick}
      >
        {HUNK_ACTION_LABELS[action]}
      </Button>
    );
    return {
      fileActions: (file) => {
        const hunks = hunksOf.get(file.path) ?? [];
        if (file.binary || file.tooLarge || hunks.length === 0) return null;
        const ids = hunks.map((hunk) => hunk.id);
        // A file with a hunk already reverted offers no whole-file Revert (it would refuse).
        if (ids.some((id) => reverted.has(revertKey(target, file.path, id)))) return null;
        return offered.map((action) => button(action, fileActionName(action, nameOf(file.path)), () => ask(target, action, file, undefined, ids), 'changes-file-action'));
      },
      hunkActions: (file, hunk) =>
        reverted.has(revertKey(target, file.path, hunk.id)) ? (
          <span className="font-sans text-caption text-muted-foreground" data-testid="changes-hunk-reverted">
            {HUNK_REVERTED_LABEL}
          </span>
        ) : (
          offered.map((action) => button(action, hunkActionName(action, hunkRangeText(hunk)), () => ask(target, action, file, hunk, []), 'changes-hunk-action'))
        ),
    };
  };

  const panel = (
    <>
      {busyAgent === undefined ? null : (
        <Text variant="caption" data-testid="changes-busy">
          {agentMidTurnText(busyAgent)}
        </Text>
      )}
      {refusal === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="changes-action-error">
          {refusal.kind === 'mid_turn' ? agentStartedHereText(busyAgent ?? 'An agent') : refusal.text}
        </Notice>
      )}
      {done === undefined ? null : (
        <Notice
          data-testid="changes-reverted"
          action={
            done.putBack ? undefined : (
              <Button type="button" size="sm" variant="outline" aria-disabled={disabled || undefined} onClick={undo} data-testid="changes-undo">
                {UNDO_LABEL}
              </Button>
            )
          }
        >
          <span role="status">{done.putBack ? PUT_BACK_TEXT : done.text}</span>
        </Notice>
      )}
      <AlertDialog
        open={confirm !== undefined}
        onOpenChange={(open) => {
          if (!open && !hunkAction.isPending) setConfirm(undefined);
        }}
      >
        {confirm === undefined ? null : (
          <AlertDialogContent data-testid="changes-revert-confirm" title={REVERT_CONFIRM_TITLE} description={REVERT_CONFIRM_DESCRIPTION}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogConfirm
              aria-disabled={disabled || undefined}
              data-testid="changes-revert-confirm-button"
              onClick={() => run(confirm.target, 'revert', confirm.file, confirm.hunk, confirm.ids)}
            >
              {HUNK_ACTION_LABELS.revert}
            </AlertDialogConfirm>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );

  return { panel, slotsFor };
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

/**
 * Send to: the composed comments appended to a chat's composer draft (or the
 * new-chat one), then that chat opened, where the user reads and sends them.
 * Comments are cleared only once the draft holds them.
 */
function useSendComments({ wsId, session, view, comments, onNotice }: { wsId: string; session: string | undefined; view: ChangesView; comments: LineCommentsState; onNotice: (text: string | undefined) => void }) {
  const navigate = useNavigate();
  const { sessions } = useSessions(wsId);
  const agents = useChatAgents(wsId);
  const [picking, setPicking] = useState(false);
  const describedBy = useId();
  const chats = (sessions ?? []).filter((one) => one.kind === 'chat');

  const send = (to: string | undefined): void => {
    if (comments.comments.length === 0) return;
    const key = to === undefined ? newChatDraftKey(wsId) : chatDraftKey(wsId, to);
    const next = appendDraft(readDraft(key), reviewCommentsText(comments.comments));
    writeDraft(key, next);
    if (readDraft(key) !== next) {
      onNotice(COMMENTS_NOT_HANDED_TEXT);
      return;
    }
    comments.clear();
    onNotice(undefined);
    if (to === undefined) void navigate({ to: '/w/$wsId/new', params: { wsId } });
    else void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: to } });
  };

  const direct = view === 'turn' && session !== undefined;
  const hint = (
    <Text variant="caption" id={describedBy}>
      {COMMENTS_OPEN_IN_CHAT_TEXT}
    </Text>
  );
  let control: ReactNode;
  if (direct) {
    const agent = agentNameOf(agents.data, sessions?.find((one) => one.id === session)?.agentId ?? undefined);
    control = (
      <Button type="button" aria-describedby={describedBy} data-testid="comments-send" onClick={() => send(session)}>
        {sendCommentsLabel(agent)}
      </Button>
    );
  } else {
    control = (
      <DropdownMenu open={picking} onOpenChange={setPicking}>
        <DropdownMenuTrigger asChild>
          <Button type="button" aria-describedby={describedBy} data-testid="comments-send-to">
            {SEND_TO_LABEL}
            <CaretDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="comments-send-to-menu" className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
          <DropdownMenuLabel>{SEND_TO_LABEL}</DropdownMenuLabel>
          {chats.map((chat) => (
            <DropdownMenuChoiceItem
              key={chat.id}
              checked={false}
              data-testid="comments-send-to-chat"
              data-session={chat.id}
              label={chatName(chat)}
              description={agentNameOf(agents.data, chat.agentId ?? undefined)}
              onSelect={() => send(chat.id)}
            />
          ))}
          <DropdownMenuChoiceItem checked={false} data-testid="comments-send-to-new" label={NEW_CHAT_NAME} description={agentNameOf(agents.data, undefined)} onSelect={() => send(undefined)} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return {
    control: (
      <>
        {control}
        {hint}
      </>
    ),
    onSend: () => (direct ? send(session) : setPicking(true)),
  };
}

/** The view's files and their diffs. */
function ChangesList({
  wsId,
  target,
  slotsFor,
  comments,
}: {
  wsId: string;
  target: ChangesTarget;
  slotsFor: (target: ChangesTarget, data: readonly DiffFileData[]) => DiffSlots;
  comments: LineCommentsState;
}) {
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
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // Outdated is only judged once every fetched diff has answered.
  const settled = changes.isSuccess && diffs.every((diff) => !diff.isPending);
  const commentSlots = useLineCommentSlots({ comments, data: settled ? loaded : undefined, origin: { view: target.view, turn: diffTarget.turn }, onNotice: setNotice });
  const sender = useSendComments({ wsId, session: target.session, view: target.view, comments, onNotice: setNotice });
  const bar = <CommentsBar comments={comments} outdated={commentSlots.outdated} notice={notice} onNotice={setNotice} send={sender.control} onSend={sender.onSend} />;
  // The view's own file actions, then Open in editor (8.10).
  const withEditor = (slots: DiffSlots): DiffSlots => ({ ...slots, fileActions: withOpenInEditor(wsId, target.session, loaded, slots.fileActions) });
  const body = listBody();
  return (
    <>
      {body}
      {bar}
    </>
  );

  function listBody(): ReactNode {
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
          <div className="flex min-w-0 flex-col" onFocus={commentSlots.onFocus} onKeyDownCapture={commentSlots.onKeyDownCapture}>
            <DiffViewer ref={viewer} files={loaded} label={CHANGES_VIEW_LABELS[target.view]} {...withEditor(slotsFor(diffTarget, loaded))} {...commentSlots.slots} />
          </div>
        )}
      </div>
    );
  }
}
