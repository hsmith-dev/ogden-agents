import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEventStream } from '@/events/event-stream';
import { SidebarInset, SidebarProvider } from '@/ui/sidebar';
import { ServerStopped } from './server-stopped';
import { StatusSidebar } from './status-sidebar';
import { VersionBanner } from './version-banner';

/**
 * The always-present shell: status sidebar on the left, workspace area on the
 * right, with the version banner on top of it. Once the user quits the server,
 * the whole surface becomes the stopped state.
 */
export function AppShell() {
  // Any navigation closes the sidebar sheet (below md).
  const href = useRouterState({ select: (state) => state.location.href });
  const { status, stoppedReason } = useEventStream();
  if (status === 'stopped') return <ServerStopped reason={stoppedReason} />;
  return (
    <SidebarProvider closeSheetOn={href}>
      <StatusSidebar />
      <SidebarInset data-testid="workspace-area">
        <VersionBanner />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
