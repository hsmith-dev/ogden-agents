import type { ReactNode } from 'react';
import { PageHeader, PageTitle } from '@/ui/page';
import { SidebarTrigger } from '@/ui/sidebar';

/** The workspace area's header: the sidebar trigger (below md) and the surface title. */
export function WorkspaceHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <PageHeader>
      <SidebarTrigger data-testid="sidebar-trigger" />
      <PageTitle>{title}</PageTitle>
      {children}
    </PageHeader>
  );
}
