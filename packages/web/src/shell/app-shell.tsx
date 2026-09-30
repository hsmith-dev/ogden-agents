import { Outlet, useRouterState } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider } from '@/ui/sidebar';
import { StatusSidebar } from './status-sidebar';

/** The always-present shell: status sidebar on the left, workspace area on the right. */
export function AppShell() {
  // Any navigation closes the sidebar sheet (below md).
  const href = useRouterState({ select: (state) => state.location.href });
  return (
    <SidebarProvider closeSheetOn={href}>
      <StatusSidebar />
      <SidebarInset data-testid="workspace-area">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
