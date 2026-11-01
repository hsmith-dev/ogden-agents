import { CaretRight, File, FolderSimple, LockSimple } from '@phosphor-icons/react';
import { WORKBENCH_FILES_LABEL, WORKSPACE_FOLDER_EMPTY_TEXT, WORKSPACE_FOLDER_TRUNCATED_TEXT, type WorkspaceFileEntry } from '@ogden-agents/shared';
import { useState } from 'react';
import { Row, RowList } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import { useWorkspaceFolder } from './workbench-api';

/**
 * The Files panel's tree (AD-36): the project's root, each folder listed
 * only when first opened (a chevron row), files selectable. A protected row
 * (`.git`, a credential folder, a link out of the project) shows a lock and
 * is never listed or read: selecting it only tells the viewer it is protected.
 */
export interface FileTreeProps {
  wsId: string;
  /** The selected file's path, if any. */
  selected: string | undefined;
  /** A file row (or a protected row) was chosen. */
  onSelect: (entry: WorkspaceFileEntry) => void;
  /** Folders open at first (the selected file's ancestors, for a link to it). */
  initiallyOpen?: readonly string[];
}

/** The root's rows sit at no indent. */
const ROOT_DEPTH = 0;

export function FileTree({ wsId, selected, onSelect, initiallyOpen = [] }: FileTreeProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));
  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    <nav aria-label={WORKBENCH_FILES_LABEL} data-testid="file-tree" className="min-w-0">
      <FolderChildren wsId={wsId} path="" depth={ROOT_DEPTH} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />
    </nav>
  );
}

interface FolderProps {
  wsId: string;
  path: string;
  depth: number;
  open: ReadonlySet<string>;
  toggle: (path: string) => void;
  selected: string | undefined;
  onSelect: (entry: WorkspaceFileEntry) => void;
}

function FolderChildren({ wsId, path, depth, open, toggle, selected, onSelect }: FolderProps) {
  const folder = useWorkspaceFolder(wsId, path);
  if (folder.isPending) {
    return (
      <div className="flex flex-col gap-0.5" data-testid="file-tree-loading">
        <span role="status" className="sr-only">
          Loading files
        </span>
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (folder.isError) {
    return (
      <Text variant="caption" role="alert" className="py-1" style={indent(depth)}>
        {folder.error.message}
      </Text>
    );
  }
  const { entries, truncated } = folder.data;
  return (
    <>
      {entries.length === 0 ? (
        <Text variant="caption" className="py-1" style={indent(depth)}>
          {WORKSPACE_FOLDER_EMPTY_TEXT}
        </Text>
      ) : (
        <RowList>
          {entries.map((entry) => (
            <TreeRow key={entry.path} wsId={wsId} entry={entry} depth={depth} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />
          ))}
        </RowList>
      )}
      {truncated ? (
        <Text variant="caption" className="py-1" style={indent(depth)}>
          {WORKSPACE_FOLDER_TRUNCATED_TEXT}
        </Text>
      ) : null}
    </>
  );
}

/** A row's indent for its depth, from the spacing tokens. */
const indent = (depth: number) => ({ paddingInlineStart: `calc(var(--space-4) * ${depth} + var(--space-2))` });

function TreeRow({ wsId, entry, depth, open, toggle, selected, onSelect }: Omit<FolderProps, 'path'> & { entry: WorkspaceFileEntry }) {
  const folder = entry.kind === 'folder';
  const expandable = folder && !entry.protected;
  const isOpen = expandable && open.has(entry.path);
  const isSelected = selected === entry.path;
  return (
    <li className="min-w-0">
      <Row
        data-testid={`file-row-${entry.path}`}
        data-protected={entry.protected ? 'true' : undefined}
        aria-expanded={expandable ? isOpen : undefined}
        aria-current={isSelected ? 'true' : undefined}
        className={cn('gap-1.5', isSelected && 'bg-secondary')}
        style={indent(depth)}
        onClick={() => (expandable ? toggle(entry.path) : onSelect(entry))}
      >
        {expandable ? <CaretRight aria-hidden className={cn('transition-transform', isOpen && 'rotate-90')} /> : <span aria-hidden className="size-(--icon) shrink-0" />}
        {entry.protected ? <LockSimple aria-hidden data-testid="file-row-lock" /> : folder ? <FolderSimple aria-hidden /> : <File aria-hidden />}
        <span className="min-w-0 truncate">{entry.name}</span>
        {entry.protected ? <span className="sr-only">, protected</span> : null}
      </Row>
      {isOpen ? <FolderChildren wsId={wsId} path={entry.path} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} /> : null}
    </li>
  );
}
