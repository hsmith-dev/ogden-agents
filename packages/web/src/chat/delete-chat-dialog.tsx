import { DELETE_AND_DISCARD_LABEL, DELETE_CHAT_CONFIRM_TITLE, DELETE_CHAT_LABEL, DELETE_CHAT_UNCOMMITTED_TEXT, deleteChatConfirmText } from '@ogden-agents/shared';
import { useState } from 'react';
import { isApiError } from '@/api/http';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { deleteChat } from './chat-api';
import { CopyIgnoredFiles } from './copy-ignored-files';

export interface DeleteChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  sesId: string;
  /** The chat's branch when it has its own worktree (its copy goes, the branch stays when it has commits). */
  branch: string | null;
  /** Called once the chat is deleted. */
  onDeleted: () => void;
}

/**
 * Delete chat's confirmation (27.3; EXPERIENCE.md State Patterns: confirm
 * once, the consequence in one sentence). A worktree chat's sentence names
 * its copy with any changes not committed, so its one confirmation sends
 * `discardUncommitted`. Only as a fallback (a 409 `uncommitted_changes` all
 * the same) does the dialog name the changes and ask again. Any other
 * refusal stays in the dialog. A worktree chat's dialog lists the copy's
 * ignored files it loses.
 */
export function DeleteChatDialog({ open, onOpenChange, wsId, sesId, branch, onDeleted }: DeleteChatDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [uncommitted, setUncommitted] = useState(false);

  const onConfirm = () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    deleteChat(wsId, sesId, branch !== null || uncommitted).then(
      () => {
        setPending(false);
        onOpenChange(false);
        onDeleted();
      },
      (failure: unknown) => {
        setPending(false);
        if (!uncommitted && isApiError(failure, 'uncommitted_changes')) {
          setUncommitted(true);
          return;
        }
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't delete this chat. Try again.");
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setError(undefined);
          setUncommitted(false);
        }
      }}
    >
      <AlertDialogContent
        data-testid="delete-chat-confirm"
        data-uncommitted={uncommitted || undefined}
        title={DELETE_CHAT_CONFIRM_TITLE}
        description={uncommitted ? DELETE_CHAT_UNCOMMITTED_TEXT : deleteChatConfirmText(branch)}
        // A worktree chat's copy goes: its ignored files (a .env) are listed first (user decision 2026-11-01).
        details={<CopyIgnoredFiles wsId={wsId} sesId={sesId} enabled={open && branch !== null} />}
        error={error}
      >
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogConfirm aria-disabled={pending} onClick={onConfirm} data-testid="delete-chat-confirm-button">
          {pending ? 'Deleting...' : uncommitted ? DELETE_AND_DISCARD_LABEL : DELETE_CHAT_LABEL}
        </AlertDialogConfirm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
