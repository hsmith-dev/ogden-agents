import type { Pane, PaneId, PaneLayout, PanePlacement } from '@ogden-agents/shared';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@/api/http';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody } from '@/ui/page';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import { MAX_NAME_LENGTH, neighbour, withActiveTab, withRatio, withTabRoot, withTabTitle, type FocusDirection, type PaneBox } from './layout-edit';
import { LauncherList } from './launcher-list';
import { LayoutStage } from './layout-tree';
import { PaneView } from './pane-view';
import { panesQueryKey, useLaunchers, usePaneActions, usePanes } from './panes-api';
import { useTerminalsSettings } from './terminals-settings';
import { STATUS_WORDS, statusOfTab } from './pane-status-words';

/** What the Terminals page says without Developer mode. */
export const DEVELOPER_MODE_NEEDED = 'Terminals are for Developer mode. Turn it on in Settings, then Appearance.';

/** What the page says when a project already has all the terminals it may. */
export const PANE_LIMIT_REACHED = (limit: number) => `A project can have ${limit} terminals open at once. Close one first.`;

/** The keys that move focus between panes (Alt and Shift with an arrow): a browser keeps none of them. */
const FOCUS_KEYS: Readonly<Record<string, FocusDirection>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/**
 * The project's terminal workspace (epic 16, stories 16.2, 16.4): tabs of
 * split panes. Only the shown tab's panes are connected, so each pane's
 * terminal takes the size of the box it is shown in (the server replays the
 * screen when a tab is shown again). Add a terminal in a new tab, split one
 * beside or under, close, rename a tab or a pane, drag or arrow-key a divider,
 * and move focus with Alt+Shift+Arrow. Only with Developer mode; the list is
 * not even asked for without it.
 */
export function TerminalsView({ wsId, developerMode, screenReaderMode }: { wsId: string; developerMode: boolean; screenReaderMode: boolean }) {
  const panes = usePanes(wsId, developerMode);
  const { open, close, rename, arrange, notify, error: mutationError } = usePaneActions(wsId);
  const launchers = useLaunchers(developerMode);
  const settings = useTerminalsSettings(developerMode);
  // A pane's status and the layout change through the event log: every tab follows (AD-7).
  useEventInvalidation((event) => (event.type.startsWith('terminal.') && event.workspaceId === wsId ? [panesQueryKey(wsId)] : []));
  const [renamingTab, setRenamingTab] = useState<string | undefined>(undefined);
  /** The pane that takes keyboard focus once it has loaded: only one the user just opened. */
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);

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

  if (settings.data?.hidden === true) {
    return (
      <PageBody data-testid="terminals-page">
        <Notice data-testid="terminals-hidden-notice">Terminals are hidden. Turn them on again in Settings, then Terminals.</Notice>
      </PageBody>
    );
  }

  const unavailable = panes.data?.terminal.available === false ? panes.data.terminal.reason : undefined;
  const layout: PaneLayout = panes.data?.layout ?? { tabs: [], activeTabId: null };
  const byId = new Map<string, Pane>((panes.data?.panes ?? []).map((pane) => [pane.id, pane]));
  const active = layout.tabs.find((tab) => tab.id === layout.activeTabId) ?? layout.tabs[0];
  const limit = panes.data?.limits.perProject ?? 8;
  const full = (panes.data?.panes.length ?? 0) >= limit;
  const openPane = (placement?: PanePlacement) => open.mutate({ size: placement === undefined ? { cols: 100, rows: 30 } : { cols: 80, rows: 24 }, ...(placement === undefined ? {} : { placement }) }, { onSuccess: (pane) => setFocusId(pane.id) });
  const startProgram = (launcherId: string, typed: string) => open.mutate({ size: { cols: 100, rows: 30 }, launch: { launcherId, args: typed } }, { onSuccess: (pane) => setFocusId(pane.id) });

  const moveFocus = (event: React.KeyboardEvent) => {
    const direction = FOCUS_KEYS[event.key];
    if (direction === undefined || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const root = stage.current;
    const current = (document.activeElement as HTMLElement | null)?.closest('[data-pane-id]')?.getAttribute('data-pane-id');
    if (root === null || current === null || current === undefined) return;
    const elements = [...root.querySelectorAll<HTMLElement>('[data-pane-id]')];
    const boxes: PaneBox[] = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.dataset.paneId ?? '', left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const target = neighbour(boxes, current, direction);
    // Only a key that moves focus is caught: at an edge, or alone, the program gets it as usual.
    if (target === undefined) return;
    const next = elements.find((element) => element.dataset.paneId === target)?.querySelector<HTMLElement>('textarea');
    if (next === null || next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    next.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-(--panel-padding)" data-testid="terminals-page">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Terminal tabs" className="flex min-w-0 flex-1 flex-wrap items-center gap-1" data-testid="terminal-tabs">
          {layout.tabs.map((tab) =>
            renamingTab === tab.id ? (
              <input
                key={tab.id}
                autoFocus
                defaultValue={tab.title}
                aria-label="Tab name"
                data-testid="tab-title-input"
                maxLength={MAX_NAME_LENGTH}
                className="h-(--control-height) rounded-md border border-border bg-transparent px-2 text-label"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const title = event.currentTarget.value.trim();
                    setRenamingTab(undefined);
                    if (title !== '' && title !== tab.title) arrange.mutate(withTabTitle(layout, tab.id, title));
                  } else if (event.key === 'Escape') setRenamingTab(undefined);
                }}
                onBlur={() => setRenamingTab(undefined)}
              />
            ) : (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === active?.id}
                data-testid="terminal-tab"
                title="Double click to rename"
                className={cn('h-(--control-height) max-w-48 truncate rounded-md px-3 text-label', tab.id === active?.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-accent')}
                onClick={() => tab.id !== active?.id && arrange.mutate(withActiveTab(layout, tab.id))}
                onDoubleClick={() => setRenamingTab(tab.id)}
              >
                {tab.title}
                {statusOfTab(tab.root, byId) === 'needs_attention' ? (
                  <span data-testid="tab-attention" className="ml-2 text-foreground">
                    {STATUS_WORDS.needs_attention}
                  </span>
                ) : null}
              </button>
            ),
          )}
        </div>
        <Button onClick={() => openPane()} disabled={open.isPending || unavailable !== undefined || full} title={full ? PANE_LIMIT_REACHED(limit) : undefined} data-testid="terminals-new">
          New terminal
        </Button>
      </div>
      <LauncherList
        statuses={launchers.list.data?.launchers ?? []}
        detecting={launchers.detect.isPending}
        onDetect={() => launchers.detect.mutate()}
        onStart={startProgram}
        disabled={open.isPending || unavailable !== undefined || full}
        failed={launchers.list.isError || launchers.detect.isError}
        defaults={settings.data?.launcherArgs}
      />
      <Text variant="caption" className="text-muted-foreground" data-testid="status-guess">
        Working, needs attention and idle are a guess from what a program prints. Ogden Agents cannot know what it is doing.
      </Text>
      <Text variant="caption" className="text-muted-foreground" data-testid="terminals-chat-note">
        A chat's own Terminal switch is separate. Opening the same session here while Ogden Agents also drives it in the chat can make the two disagree.
      </Text>
      <Text variant="caption" className="text-muted-foreground">
        Each terminal runs your own shell in this project's folder. It stops when you close it or when Ogden Agents stops.
      </Text>
      {full ? (
        <Text variant="caption" role="status" data-testid="terminals-full">
          {PANE_LIMIT_REACHED(limit)}
        </Text>
      ) : null}
      {unavailable === undefined ? null : <Notice variant="blocked" data-testid="terminals-unavailable">{unavailable}</Notice>}
      {panes.isError && !isApiError(panes.error, 'developer_mode_required') ? (
        <Notice variant="blocked" data-testid="terminals-load-failed" action={<Button variant="outline" onClick={() => void panes.refetch()}>Try again</Button>}>
          {panes.error instanceof Error ? panes.error.message : "Ogden Agents couldn't load this project's terminals."}
        </Notice>
      ) : null}
      {mutationError === undefined ? null : <Notice variant="blocked" data-testid="terminals-action-failed">{mutationError}</Notice>}
      {panes.data !== undefined && active === undefined && unavailable === undefined ? (
        <Text variant="body" className="text-muted-foreground" data-testid="terminals-empty">
          No terminals yet. Press New terminal to start one.
        </Text>
      ) : null}
      {active === undefined ? null : (
        // Alt+Shift+Arrow moves focus between panes, caught before xterm sends it to the program.
        <div ref={stage} className="flex min-h-0 flex-1" data-testid="terminal-stage" onKeyDownCapture={moveFocus}>
          <LayoutStage
            node={active.root}
            paneIds={(panes.data?.panes ?? []).map((pane) => pane.id)}
            onRatio={(path, ratio) => arrange.mutate(withTabRoot(layout, active.id, withRatio(active.root, path, ratio)))}
            renderPane={(paneId) => {
              const pane = byId.get(paneId);
              return pane === undefined ? null : (
                <PaneView
                  key={pane.id}
                  wsId={wsId}
                  pane={pane}
                  screenReaderMode={screenReaderMode}
                  onClose={(id) => close.mutate(id)}
                  onSplit={(id, direction) => openPane({ kind: 'split', paneId: id as PaneId, direction })}
                  focusOnOpen={pane.id === focusId}
                  resumeHint={launchers.list.data?.launchers.find((one) => one.launcher.id === pane.launcherId)?.launcher.resumeHint}
                  onRename={(id, title) => rename.mutate({ paneId: id, title })}
                  onNotify={(id, on) => notify.mutate({ paneId: id, notify: on })}
                  splitDisabledReason={full ? PANE_LIMIT_REACHED(limit) : open.isPending ? 'Opening a terminal' : undefined}
                />
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
