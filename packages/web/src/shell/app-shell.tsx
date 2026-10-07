import { Outlet, useRouterState } from '@tanstack/react-router';
import { DeveloperModeSync } from '@/appearance/developer-mode';
import { useEventStream } from '@/events/event-stream';
import { AttentionNotifier } from '@/notifications/attention-notifier';
import { SidebarInset, SidebarProvider } from '@/ui/sidebar';
import { TourController } from '@/tour/tour-controller';
import { AppShortcutOffer } from './app-shortcut-offer';
import { LiveAnnouncer } from './live-announcer';
import { OpenOgdenAgents } from './open-ogden-agents';
import { ServerStopped } from './server-stopped';
import { SidebarDataProvider } from './sidebar-data';
import { StatusSidebar } from './status-sidebar';
import { UpdateBanner } from './update-banner';
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
    <SidebarDataProvider>
      <SidebarProvider closeSheetOn={href}>
        <StatusSidebar />
        <LiveAnnouncer />
        {/* A desktop notification and a sound for each new need (backlog story 8). */}
        <AttentionNotifier />
        {/* Developer mode is the server's (permission modes): this tab's copy follows it. */}
        <DeveloperModeSync />
        <SidebarInset data-testid="workspace-area">
          <VersionBanner />
          <UpdateBanner />
          <AppShortcutOffer />
          <Outlet />
        </SidebarInset>
        {/* The guided tour (backlog story 19): arms on Welcome's first finish and services Settings' Replay; portals its own overlay. */}
        <TourController />
      </SidebarProvider>
    </SidebarDataProvider>
  );
}
