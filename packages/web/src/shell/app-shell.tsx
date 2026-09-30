import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEventStream } from '@/events/event-stream';
import { SidebarInset, SidebarProvider } from '@/ui/sidebar';
import { AppShortcutOffer } from './app-shortcut-offer';
import { OpenOgdenAgents } from './open-ogden-agents';
import { ServerStopped } from './server-stopped';
import { StatusSidebar } from './status-sidebar';
import { VersionBanner } from './version-banner';

/**
 * The always-present shell: status sidebar on the left, workspace area on the
 * right, with the version banner on top of it. Once the user quits the server,
 * the whole surface becomes the stopped state; a tab without a valid token
 * shows the launch state instead.
 */
export function AppShell() {
  // Any navigation closes the sidebar sheet (below md).
  const href = useRouterState({ select: (state) => state.location.href });
  const { status, stoppedReason } = useEventStream();
  if (status === 'not-connected') return <OpenOgdenAgents />;
  if (status === 'stopped') return <ServerStopped reason={stoppedReason} />;
  return (
    <SidebarProvider closeSheetOn={href}>
      <StatusSidebar />
      <SidebarInset data-testid="workspace-area">
        <VersionBanner />
        <AppShortcutOffer />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
