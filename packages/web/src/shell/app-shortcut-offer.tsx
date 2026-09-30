import { useAppShortcut, useAppShortcutActions } from '@/appearance/app-shortcut-api';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';

/**
 * The first-run offer of the Ogden Agents app shortcut (E2-R10, story 2.4),
 * at the top of the workspace area while the server says it is pending: a
 * supported computer, no shortcut yet, and no answer yet. **Add shortcut**
 * and **Not now** both answer it for good; a failed Add says why in place.
 */
export function AppShortcutOffer() {
  const { data } = useAppShortcut();
  const { add, dismiss } = useAppShortcutActions();
  if (data?.offerPending !== true) return null;
  const busy = add.isPending || dismiss.isPending;
  return (
    <div className="px-(--panel-padding) pt-(--panel-padding)" data-testid="app-shortcut-offer">
      <Notice
        variant={add.isError ? 'blocked' : 'info'}
        action={
          <span className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => add.mutate()}>
              Add shortcut
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>
              Not now
            </Button>
          </span>
        }
      >
        {add.isError ? <span role="alert">{add.error.message}</span> : 'Open Ogden Agents from your apps menu next time.'}
      </Notice>
    </div>
  );
}
