import { House, Trash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ChatApiError } from '@/chat/chat-api';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent, AlertDialogTrigger } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { EmptyState, PageBody, PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { deleteHistory, fetchWorkspace, workspaceName } from '@/workspaces/workspace-api';

/**
 * `/w/:wsId/settings`: the workspace's settings (story 2.5, then the
 * caution level in 2.8): caution level, history deletion, and later the
 * default agent and BMad Method setup. Story 2.3 registers the route; 2.5
 * and 2.8 fill this file.
 */
export function WorkspaceSettingsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const workspace = useQuery({ queryKey: ['workspace', wsId], queryFn: () => fetchWorkspace(wsId), retry: false });
  const missing = workspace.error instanceof ChatApiError && workspace.error.status === 404;
  return (
    <>
      <WorkspaceHeader title="Workspace settings" />
      <PageBody data-testid="workspace-settings-page">
        {missing ? (
          <EmptyState
            data-testid="workspace-not-found"
            title="There is no such project."
            actions={
              <Button asChild variant="outline">
                <Link to="/">
                  <House aria-hidden />
                  Go to projects
                </Link>
              </Button>
            }
          />
        ) : workspace.data === undefined ? null : (
          <DeleteHistorySection wsId={wsId} name={workspaceName(workspace.data)} />
        )}
      </PageBody>
    </>
  );
}

/**
 * Delete history: every chat of this project goes; the project and every
 * other project stay. It confirms once with its consequence (EXPERIENCE.md
 * Interaction Rules); the server refuses while a chat is working or waiting,
 * and that refusal stays in the dialog.
 */
function DeleteHistorySection({ wsId, name }: { wsId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);

  const onConfirm = () => {
    setPending(true);
    setError(undefined);
    deleteHistory(wsId).then(
      () => {
        setPending(false);
        setOpen(false);
        setDone(true);
      },
      (failure: unknown) => {
        setPending(false);
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't delete the history. Try again.");
      },
    );
  };

  return (
    <PageSection title="History" data-testid="history-section">
      <Text>Delete every chat in this project. The folder and its files are not touched.</Text>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDone(false);
          else setError(undefined);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="self-start" data-testid="delete-history">
            <Trash aria-hidden />
            Delete history
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent
          data-testid="delete-history-confirm"
          title="Delete history?"
          description={`Deletes every chat in ${name}. This can't be undone.`}
          error={error}
        >
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogConfirm aria-disabled={pending} onClick={pending ? undefined : onConfirm}>
            {pending ? 'Deleting...' : 'Delete history'}
          </AlertDialogConfirm>
        </AlertDialogContent>
      </AlertDialog>
      {done ? (
        <Text variant="caption" role="status" data-testid="history-deleted">
          The history of {name} was deleted.
        </Text>
      ) : null}
    </PageSection>
  );
}
