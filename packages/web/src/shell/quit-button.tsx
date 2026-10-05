import { Power } from '@phosphor-icons/react';
import { useState } from 'react';
import { useEventStream } from '@/events/event-stream';
import { quitServer } from '@/events/server-control';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent, AlertDialogTrigger } from '@/ui/alert-dialog';
import { SidebarLabel, SidebarMenuButton } from '@/ui/sidebar';
import { isBusy } from '@/workspaces/workspace-api';
import { useUpdateNotice } from '@/updates/update-api';
import { isDesktopApp } from './desktop-app';
import { useSidebarData } from './sidebar-data';

/** The consequence of quitting, in one sentence (EXPERIENCE.md Interaction Rules). */
export function quitConsequence(busy: number, app = false): string {
  // In the desktop app the way back is the app itself (story 13.11): never "npx".
  const again = app ? 'you open the app again' : 'you run npx ogden-agents again';
  if (busy === 0) return `Ogden Agents stops on this computer until ${again}.`;
  const agents = busy === 1 ? '1 agent is still working and will stop' : `${busy} agents are still working and will stop`;
  return `${agents}, and Ogden Agents stays off until ${again}.`;
}

/**
 * Quit Ogden Agents, in the sidebar footer beside Settings (AD-3: the server
 * runs until Quit). It confirms once; a failure stays in the dialog so the
 * user sees it and can try again.
 */
export function QuitButton() {
  const { markStopped } = useEventStream();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = useSidebarData().sessions.filter(isBusy).length;
  const app = isDesktopApp() || useUpdateNotice().data?.shell === 'desktop';

  const onConfirm = () => {
    setPending(true);
    setError(undefined);
    quitServer().then(
      () => markStopped('quit'),
      (failure: unknown) => {
        setPending(false);
        setError(failure instanceof Error ? failure.message : "Ogden Agents didn't quit. Try again.");
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <SidebarMenuButton data-testid="quit" tooltip="Quit Ogden Agents">
          <Power aria-hidden />
          <SidebarLabel>Quit Ogden Agents</SidebarLabel>
        </SidebarMenuButton>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid="quit-confirm" title="Quit Ogden Agents?" description={quitConsequence(busy, app)} error={error}>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogConfirm aria-disabled={pending} onClick={pending ? undefined : onConfirm}>
          {pending ? 'Quitting...' : 'Quit'}
        </AlertDialogConfirm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
