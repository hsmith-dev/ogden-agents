import { ArrowUp, Folder, FolderOpen, FolderPlus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Workspace } from '@ogden-agents/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { openWorkspace } from '@/chat/chat-api';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Row, RowList, RowListFrame } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { createFolder, listFolders } from './workspace-api';

/** The quick-pick folders, in order, when they exist in the home folder. */
const QUICK_PICKS = ['Desktop', 'Documents'] as const;

export interface AddProjectDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Opened from Start a new project folder: the cursor starts in the new folder's name. */
  startNew?: boolean;
  /** Called with the opened project instead of going to its Chats (Welcome, 9.5). The dialog closes first. */
  onOpened?(workspace: Workspace): void;
}

/**
 * Add project (EXPERIENCE.md Workspace switcher; CAP-17): a folder browser
 * the server reads for the page, starting at the home folder. The user opens
 * the folder shown, or starts a new project folder inside it; either way the
 * project opens at `/w/:wsId`. The same folder always opens the same project
 * (AD-2). Nothing is set up in a new folder (no git, no BMad Method).
 * With `onOpened` (Welcome) the caller decides where to go instead.
 */
export function AddProjectDialog({ open, onOpenChange, startNew = false, onOpened }: AddProjectDialogProps) {
  const nameId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent
          data-testid="add-project-dialog"
          title="Add project"
          description="Choose the folder your agents work in."
          onOpenAutoFocus={(event) => {
            if (!startNew) return;
            event.preventDefault();
            document.getElementById(nameId)?.focus();
          }}
        >
          <FolderBrowser nameId={nameId} onDone={() => onOpenChange(false)} onOpened={onOpened} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function FolderBrowser({ nameId, onDone, onOpened }: { nameId: string; onDone(): void; onOpened: ((workspace: Workspace) => void) | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);
  /** The folder shown; `undefined` is the home folder. */
  const [path, setPath] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const home = useQuery({ queryKey: ['folders', null], queryFn: () => listFolders(), retry: false });
  const listing = useQuery({ queryKey: ['folders', path ?? null], queryFn: () => listFolders(path), retry: false });

  const current = listing.data;
  const quickPicks =
    home.data === undefined
      ? []
      : [
          { name: 'Home', path: home.data.path },
          ...QUICK_PICKS.flatMap((pick) => home.data.entries.filter((entry) => entry.name === pick).map((entry) => ({ name: pick, path: entry.path }))),
        ];

  const go = (next: string) => {
    setError(undefined);
    setPath(next);
  };

  /** Opens `folder` as a project and goes to its Chats list (or hands it to `onOpened`). */
  const openProject = async (folder: string) => {
    const workspace = await openWorkspace(folder);
    onDone();
    if (onOpened !== undefined) onOpened(workspace);
    else await navigate({ to: '/w/$wsId', params: { wsId: workspace.id } });
  };

  const run = (task: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    task().then(
      () => setPending(false),
      (failure: unknown) => {
        setPending(false);
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't open that folder. Try again.");
      },
    );
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    if (current === undefined) return;
    if (name.trim() === '') {
      setError('Name the new folder.');
      nameRef.current?.focus();
      return;
    }
    run(async () => {
      const created = await createFolder(current.path, name.trim());
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
      await openProject(created);
    });
  };

  const loadError = listing.error instanceof Error ? listing.error.message : undefined;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {quickPicks.length === 0 ? null : (
        <div role="group" aria-label="Quick picks" className="flex flex-wrap gap-2" data-testid="folder-quick-picks">
          {quickPicks.map((pick) => (
            <Button key={pick.name} variant="outline" size="sm" aria-pressed={current?.path === pick.path} onClick={() => go(pick.path)}>
              {pick.name}
            </Button>
          ))}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Up one folder"
          aria-disabled={current?.parent == null}
          onClick={() => {
            if (current?.parent != null) go(current.parent);
          }}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Text variant="mono-compact" className="min-w-0 flex-1 truncate" data-testid="folder-path" title={current?.path}>
          {current?.path ?? path ?? ''}
        </Text>
      </div>
      <RowListFrame aria-busy={listing.isPending}>
        {listing.isPending ? (
          <div className="flex flex-col gap-1 p-1">
            <Skeleton />
            <Skeleton />
            <span role="status" className="sr-only">
              Loading folders
            </span>
          </div>
        ) : loadError !== undefined ? (
          <Text variant="caption" className="p-2" role="alert">
            {loadError}
          </Text>
        ) : current?.entries.length === 0 ? (
          <Text variant="caption" className="p-2">
            No folders in here.
          </Text>
        ) : (
          <RowList aria-label="Folders" data-testid="folder-list">
            {current?.entries.map((entry) => (
              <li key={entry.path}>
                <Row onClick={() => go(entry.path)}>
                  <Folder aria-hidden />
                  <span className="min-w-0 truncate">{entry.name}</span>
                </Row>
              </li>
            ))}
          </RowList>
        )}
      </RowListFrame>
      <Button className="self-start" aria-disabled={pending || current === undefined} onClick={() => current !== undefined && run(() => openProject(current.path))}>
        <FolderOpen aria-hidden />
        Open this folder
      </Button>
      <form onSubmit={onCreate} className="flex flex-col gap-2" data-testid="new-project-folder">
        <Label htmlFor={nameId}>Start a new project folder here</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={nameId}
            ref={nameRef}
            placeholder="my-project"
            autoComplete="off"
            spellCheck={false}
            className="flex-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="outline" aria-disabled={pending || current === undefined}>
            <FolderPlus aria-hidden />
            Start a new project folder
          </Button>
        </div>
      </form>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="add-project-error">
          {error}
        </Text>
      )}
    </div>
  );
}
