import { CaretUpDown, Plus } from '@phosphor-icons/react';
import type { Workspace } from '@ogden-agents/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Button } from '@/ui/button';
import { cn } from '@/ui/utils';
import { AddProjectDialog } from '@/workspaces/add-project-dialog';
import { useWorkspaces, workspaceName } from '@/workspaces/workspace-api';

export interface SwitcherItem {
  id: string;
  name: string;
  current: boolean;
}

/** The switcher's rows: every workspace by folder name, ignoring case, the current one marked. */
export function switcherItems(workspaces: readonly Workspace[], currentId: string | undefined): SwitcherItem[] {
  return workspaces
    .map((workspace) => ({ id: workspace.id, name: workspaceName(workspace), current: workspace.id === currentId }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1));
}

export interface WorkspaceSwitcherViewProps {
  items: readonly SwitcherItem[];
  onSelect(id: string): void;
  onAddProject(): void;
  className?: string;
}

/**
 * The workspace switcher's menu (EXPERIENCE.md Workspace switcher): the
 * current project's name on the trigger; the menu lists every project,
 * the current one checked, then Add project.
 */
export function WorkspaceSwitcherView({ items, onSelect, onAddProject, className }: WorkspaceSwitcherViewProps) {
  const current = items.find((item) => item.current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="workspace-switcher"
          aria-label={current === undefined ? 'Switch project' : `Switch project, current: ${current.name}`}
          className={cn('min-w-0 gap-1', className)}
        >
          <span className="min-w-0 truncate">{current?.name ?? 'Projects'}</span>
          <CaretUpDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-(--sidebar-width)">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuCheckboxItem key={item.id} checked={item.current} onSelect={() => onSelect(item.id)} data-testid="workspace-switcher-item">
            {item.name}
          </DropdownMenuCheckboxItem>
        ))}
        {items.length === 0 ? null : <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={onAddProject}>
          <Plus aria-hidden />
          Add project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The switcher in the sidebar header: opens a project's Chats list, or Add project. */
export function WorkspaceSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { wsId } = useParams({ strict: false }) as { wsId?: string };
  const workspaces = useWorkspaces();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <WorkspaceSwitcherView
        className={className}
        items={switcherItems(workspaces.data ?? [], wsId)}
        onSelect={(id) => void navigate({ to: '/w/$wsId', params: { wsId: id } })}
        onAddProject={() => setAdding(true)}
      />
      <AddProjectDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
