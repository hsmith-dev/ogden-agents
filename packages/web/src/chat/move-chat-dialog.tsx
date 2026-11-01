import {
  HANDOFF_CONFIRM_LABEL,
  HANDOFF_CONFIRM_TITLE,
  HANDOFF_FAILED_TEXT,
  HANDOFF_TO_THIS_FOLDER_DESCRIPTION,
  HANDOFF_TO_WORKTREE_DESCRIPTION,
  HANDOFF_FOLDER_BUSY_TEXT,
  handOffConflictText,
  handOffWorktreeConflictText,
  type ChatLocation,
  type Session,
} from '@ogden-agents/shared';
import { useState } from 'react';
import { isApiError } from '@/api/http';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { handOffChat } from './chat-api';
import { CopyIgnoredFiles } from './copy-ignored-files';

export interface MoveChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  sesId: string;
  /** Where the chat moves. */
  to: ChatLocation;
  /** Called with the chat as it is once it moved. */
  onMoved: (session: Session) => void;
}

/**
 * Move this chat (Hand off's confirmation, 27.4; renamed in 27.9 from `hand-off-dialog.tsx`, one hyphen from Continue with another agent's `handoff-dialog.tsx`; EXPERIENCE.md State Patterns: confirm once,
 * the consequence in one sentence): the item's own line. A refusal stays in
 * the dialog in plain words: the other place's own changes to the same
 * files (409 `handoff_conflict`, with how many: this folder's own, or the
 * chat's kept branch when moving to its worktree), the agents working in
 * the folder (409 `agent_mid_turn`), or the server's sentence; nothing moved.
 * Moving to this folder lists the copy's ignored files it loses.
 */
export function MoveChatDialog({ open, onOpenChange, wsId, sesId, to, onMoved }: MoveChatDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const onConfirm = () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    handOffChat(wsId, sesId, to).then(
      (session) => {
        setPending(false);
        onOpenChange(false);
        onMoved(session);
      },
      (failure: unknown) => {
        setPending(false);
        if (isApiError(failure, 'handoff_conflict')) {
          const files = failure.details?.files;
          const count = typeof files === 'number' && Number.isInteger(files) && files > 0 ? files : 1;
          // Into this folder the clash is the folder's own changes; into its worktree, the chat's kept branch.
          setError(to === 'worktree' ? handOffWorktreeConflictText(count) : handOffConflictText(count));
          return;
        }
        if (isApiError(failure, 'agent_mid_turn')) {
          // The item is offered only while this chat is idle: what holds it now is a chat working in the folder.
          setError(HANDOFF_FOLDER_BUSY_TEXT);
          return;
        }
        setError(failure instanceof Error && failure.message !== '' ? failure.message : HANDOFF_FAILED_TEXT);
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(undefined);
      }}
    >
      <AlertDialogContent
        data-testid="hand-off-confirm"
        data-to={to}
        title={HANDOFF_CONFIRM_TITLE}
        description={to === 'worktree' ? HANDOFF_TO_WORKTREE_DESCRIPTION : HANDOFF_TO_THIS_FOLDER_DESCRIPTION}
        // Moving back removes the copy: its ignored files (a .env) are listed first (user decision 2026-11-01).
        details={<CopyIgnoredFiles wsId={wsId} sesId={sesId} enabled={open && to === 'this_folder'} />}
        error={error}
      >
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogConfirm aria-disabled={pending} onClick={onConfirm} data-testid="hand-off-confirm-button">
          {pending ? 'Moving...' : HANDOFF_CONFIRM_LABEL}
        </AlertDialogConfirm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
