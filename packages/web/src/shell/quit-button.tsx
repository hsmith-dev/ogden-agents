import { Power } from '@phosphor-icons/react';
import { useState } from 'react';
import { busySessionCount, useEventStream } from '@/events/event-stream';
import { quitServer } from '@/events/server-control';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent, AlertDialogTrigger } from '@/ui/alert-dialog';
import { SidebarLabel, SidebarMenuButton } from '@/ui/sidebar';

/** The consequence of quitting, in one sentence (EXPERIENCE.md Interaction Rules). */
export function quitConsequence(busy: number): string {
  if (busy === 0) return 'Ogden Agents stops on this computer until you run npx ogden-agents again.';
  const agents = busy === 1 ? '1 agent is still working and will stop' : `${busy} agents are still working and will stop`;
  return `${agents}, and Ogden Agents stays off until you run npx ogden-agents again.`;
}

/**
 * Quit Ogden Agents, in the sidebar footer beside Settings (AD-3: the server
 * runs until Quit). It confirms once; a failure stays in the dialog so the
 * user sees it and can try again.
 */
export function QuitButton() {
  const { events, markStopped } = useEventStream();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = busySessionCount(events);

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
      <AlertDialogContent data-testid="quit-confirm" title="Quit Ogden Agents?" description={quitConsequence(busy)} error={error}>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogConfirm aria-disabled={pending} onClick={pending ? undefined : onConfirm}>
          {pending ? 'Quitting...' : 'Quit'}
        </AlertDialogConfirm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
