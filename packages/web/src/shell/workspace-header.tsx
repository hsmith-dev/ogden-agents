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
  children,
}: {
  title: string;
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
      <PageTitle className={compactOnPhone && wsId !== undefined ? 'max-sm:sr-only' : undefined}>{title}</PageTitle>
      {wsId === undefined ? null : <WorkspaceTabs wsId={wsId} active={tab} />}
      {children}
    </PageHeader>
  );
}
