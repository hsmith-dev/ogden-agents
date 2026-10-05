import type { ReactNode } from 'react';
import { PageHeader, PageTitle } from '@/ui/page';
import { SidebarTrigger } from '@/ui/sidebar';
import { WorkspaceTabs, type WorkspaceTabId } from './workspace-tabs';

/**
 * The workspace area's header: the sidebar trigger (below md), the surface
 * title and, inside a project (`wsId`), its section tabs (story 10.6): Chats,
 * plus a BMad piece's tab only when the project has it on.
 */
export function WorkspaceHeader({
  title,
  wsId,
  tab = 'chats',
  compactOnPhone = false,
  titleHidden = false,
  titleAction,
  children,
}: {
  title: string;
  /** The title for screen readers only (while a field stands in for it: a chat's rename). */
  titleHidden?: boolean;
  /** Right after the title (a chat's Rename, backlog story 2). */
  titleAction?: ReactNode;
  wsId?: string;
  tab?: WorkspaceTabId;
  /**
   * Below `sm`, the title is for screen readers only and the current tab
   * names the page, so a header with wide controls (the session's Chat |
   * Terminal toggle) still fits at phone width.
   */
  compactOnPhone?: boolean;
  children?: ReactNode;
}) {
  return (
    <PageHeader>
      <SidebarTrigger data-testid="sidebar-trigger" />
      <PageTitle className={titleHidden ? 'sr-only' : compactOnPhone && wsId !== undefined ? 'max-sm:sr-only' : undefined} data-testid="page-title">
        {title}
      </PageTitle>
      {/* Kept at phone width too: with the title hidden there, Rename is still the way to rename from the header. */}
      {titleAction}
      {wsId === undefined ? null : <WorkspaceTabs wsId={wsId} active={tab} />}
      {children}
    </PageHeader>
  );
}
