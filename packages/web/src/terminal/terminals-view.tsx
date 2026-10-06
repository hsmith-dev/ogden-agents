import { useEffect } from 'react';
import { isApiError } from '@/api/http';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody } from '@/ui/page';
import { Text } from '@/ui/typography';
import { PaneView } from './pane-view';
import { usePaneActions, usePanes } from './panes-api';

/** What the Terminals page says without Developer mode. */
export const DEVELOPER_MODE_NEEDED = 'Terminals are for Developer mode. Turn it on in Settings, then Appearance.';

/**
 * The project's panes (epic 16, story 16.2): a button to open one and each
 * pane's terminal. Story 16.4 turns this into tabs and splits. Only with
 * Developer mode; the list is not even asked for without it.
 */
export function TerminalsView({ wsId, developerMode, screenReaderMode }: { wsId: string; developerMode: boolean; screenReaderMode: boolean }) {
  const panes = usePanes(wsId, developerMode);
  const { open, close } = usePaneActions(wsId);

  // A pane's state is learned over its own socket; the list is read again when the window is shown.
  useEffect(() => {
    if (!developerMode) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void panes.refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [developerMode, wsId]);

  if (!developerMode || (panes.error !== null && isApiError(panes.error, 'developer_mode_required'))) {
    return (
      <PageBody data-testid="terminals-page">
        <Notice data-testid="terminals-developer-mode">{DEVELOPER_MODE_NEEDED}</Notice>
      </PageBody>
    );
  }

  const unavailable = panes.data?.terminal.available === false ? panes.data.terminal.reason : undefined;
  const openError = open.error instanceof Error ? open.error.message : undefined;
  const closeError = close.error instanceof Error ? close.error.message : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-(--panel-padding)" data-testid="terminals-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="caption" className="text-muted-foreground">
          Each terminal runs your own shell in this project's folder. It stops when you close it or when Ogden Agents stops.
        </Text>
        <Button onClick={() => open.mutate({ cols: 100, rows: 30 })} disabled={open.isPending || unavailable !== undefined} data-testid="terminals-new">
          New terminal
        </Button>
      </div>
      {unavailable === undefined ? null : <Notice variant="blocked" data-testid="terminals-unavailable">{unavailable}</Notice>}
      {panes.isError && !isApiError(panes.error, 'developer_mode_required') ? (
        <Notice variant="blocked" data-testid="terminals-load-failed" action={<Button variant="outline" onClick={() => void panes.refetch()}>Try again</Button>}>
          {panes.error instanceof Error ? panes.error.message : "Ogden Agents couldn't load this project's terminals."}
        </Notice>
      ) : null}
      {openError === undefined ? null : <Notice variant="blocked" data-testid="terminals-open-failed">{openError}</Notice>}
      {closeError === undefined ? null : <Notice variant="blocked" data-testid="terminals-close-failed">{closeError}</Notice>}
      {panes.data !== undefined && panes.data.panes.length === 0 && unavailable === undefined ? (
        <Text variant="body" className="text-muted-foreground" data-testid="terminals-empty">
          No terminals yet. Press New terminal to start one.
        </Text>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {(panes.data?.panes ?? []).map((pane) => (
          <PaneView key={pane.id} wsId={wsId} pane={pane} screenReaderMode={screenReaderMode} onClose={(paneId) => close.mutate(paneId)} />
        ))}
      </div>
    </div>
  );
}
