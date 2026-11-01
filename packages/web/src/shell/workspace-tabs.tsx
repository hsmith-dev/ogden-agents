import { reviewTabLabel, type BmadPiece, type BmadPieceAvailability } from '@ogden-agents/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAppearance } from '@/appearance/appearance-provider';
import { useTerminalsSettings } from '@/terminal/terminals-settings';
import { Kbd } from '@/ui/kbd';
import { TabNav, TabNavItem } from '@/ui/tab-nav';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { useBmadPieces, useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { useGoKeys, useGoShortcuts } from './use-go-shortcuts';

/**
 * The project's section tabs in the workspace header (E10-R6; story 10.6).
 * Chats and Workbench (AD-36) are always there. Plan, Board and Runs are slots that epics 4 and 5
 * only fill: each shows only when its BMad piece is on for the project,
 * available on this install, and its page exists (the filling epic sets its
 * `to`). So a simple project, with every piece off, shows Chats and Workbench alone, and
 * so does any project while its settings load or fail to.
 *
 * Story 4.6: `g` then a shown tab's `key` opens it (`g c`, `g p`, `g b`,
 * `g r`, Developer mode's `g t`); a tab that isn't shown has no shortcut. `g s` (8.8) opens the
 * Workbench's Search panel, which every project has. In Developer mode only,
 * each tab's tooltip (on hover and keyboard focus) shows its keys.
 */

/** A slot's id, or `review`: the review page's own tab (26.6), shown only on that page and never a slot. */
export type WorkspaceTabId = 'chats' | 'workbench' | 'plan' | 'board' | 'runs' | 'orchestrate' | 'terminals' | 'review';

export interface WorkspaceTabSlot {
  id: WorkspaceTabId;
  label: string;
  /** The key after `g` that opens the tab (story 4.6). */
  key: string;
  /** The BMad piece the tab serves; none for Chats, which is always there. */
  piece?: BmadPiece;
  /** The tab's route, with `$wsId`; unset until the epic that builds its page sets it. */
  to?: string;
  /** Shown only while the project has the Orchestration piece on (epic 15; it is not a BMad piece). */
  orchestration?: true;
  /** Shown only in Developer mode (epic 16: Terminals). The server refuses what it serves without it all the same. */
  developerOnly?: true;
  /** Left out below `sm` in a crowded header (a chat's, `compactOnPhone`) unless it is the page shown: it is a `g` key away there too. */
  spareOnPhone?: true;
}

/** Every slot, in order. Story 4.1 sets Plan's and Board's `to` (their bare pages), 11.1 Runs'. */
export const WORKSPACE_TAB_SLOTS: readonly WorkspaceTabSlot[] = [
  { id: 'chats', label: 'Chats', key: 'c', to: '/w/$wsId' },
  // The Workbench (AD-36): every project's, like Chats; its Files panel reads the project read-only.
  { id: 'workbench', label: 'Workbench', key: 'w', to: '/w/$wsId/workbench', spareOnPhone: true },
  { id: 'plan', label: 'Plan', key: 'p', piece: 'planning', to: '/w/$wsId/plan' },
  { id: 'board', label: 'Board', key: 'b', piece: 'board', to: '/w/$wsId/board' },
  { id: 'runs', label: 'Runs', key: 'r', piece: 'builds', to: '/w/$wsId/runs' },
  { id: 'orchestrate', label: 'Orchestrate', key: 'o', to: '/w/$wsId/orchestrate', orchestration: true },
  { id: 'terminals', label: 'Terminals', key: 't', to: '/w/$wsId/terminals', developerOnly: true },
];

/** A slot that can be shown: it has a page to link to. */
export type VisibleWorkspaceTab = WorkspaceTabSlot & { to: string };

/**
 * The tabs to show, in slot order: those with a page, and, for a piece's
 * tab, only when the project has the piece on and this install has it
 * available. `pieces` or `availability` unknown (loading or failed) shows
 * only the tabs that serve no piece. Orchestrate (epic 15) shows only with `orchestration`, the project's own switch. A Developer-mode tab (Terminals, epic 16)
 * shows only with `developerMode`, whatever the pieces say (E16-R3, AD-21).
 */
export function visibleWorkspaceTabs(
  pieces: readonly BmadPiece[] | undefined,
  availability: readonly BmadPieceAvailability[] | undefined,
  slots: readonly WorkspaceTabSlot[] = WORKSPACE_TAB_SLOTS,
  developerMode = false,
  orchestration = false,
): VisibleWorkspaceTab[] {
  return slots.filter((slot): slot is VisibleWorkspaceTab => {
    if (slot.to === undefined) return false;
    if (slot.orchestration === true && !orchestration) return false;
    if (slot.developerOnly === true && !developerMode) return false;
    if (slot.piece === undefined) return true;
    const piece = slot.piece;
    return pieces?.includes(piece) === true && availability?.some((entry) => entry.piece === piece && entry.available) === true;
  });
}

/** The keys of a tab's shortcut, in order (`g`, `p`). */
export function workspaceTabShortcutKeys(tab: Pick<WorkspaceTabSlot, 'key'>): string[] {
  return ['g', tab.key];
}

/**
 * The tabs as links; `active` is marked as the current page. `hints` gives each tab a tooltip with its keys (Developer mode).
 * `reviewRef` (26.6, the review page) adds a last, current tab "Review 1.2" linking to the page shown; no slot is current with it.
 */
export function WorkspaceTabsView({
  wsId,
  tabs,
  active,
  hints = false,
  reviewRef,
  crowded = false,
}: {
  wsId: string;
  tabs: readonly VisibleWorkspaceTab[];
  active: WorkspaceTabId;
  hints?: boolean;
  reviewRef?: string | undefined;
  /** A crowded header (`compactOnPhone`): a spare tab is left out below `sm`. */
  crowded?: boolean;
}) {
  const current = (id: WorkspaceTabId) => reviewRef === undefined && id === active;
  return (
    <TabNav label="Project sections" data-testid="workspace-tabs">
      {tabs.map((tab) => {
        // A spare tab in a crowded header is left out below sm, item and all.
        const spare = crowded && tab.spareOnPhone === true && !current(tab.id) ? 'max-sm:hidden' : undefined;
        const link = (
          <Link
            // A slot's route is set by the epic that builds its page; Chats' is `/w/$wsId`.
            to={tab.to as '/w/$wsId'}
            params={{ wsId }}
            // `active` decides: the router would also mark Chats current on any page below `/w/$wsId`.
            activeOptions={{ exact: !current(tab.id), includeSearch: false }}
            data-testid={`workspace-tab-${tab.id}`}
          >
            {tab.label}
          </Link>
        );
        if (!hints) {
          return (
            <TabNavItem key={tab.id} current={current(tab.id)} itemClassName={spare} asChild>
              {link}
            </TabNavItem>
          );
        }
        return (
          <Tooltip key={tab.id}>
            <TabNavItem current={current(tab.id)} itemClassName={spare} asChild>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
            </TabNavItem>
            <TooltipContent data-testid={`workspace-tab-hint-${tab.id}`}>
              <span className="flex items-center gap-1">
                {workspaceTabShortcutKeys(tab).map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </TooltipContent>
          </Tooltip>
        );
      })}
      {reviewRef === undefined ? null : (
        <TabNavItem current asChild>
          <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: reviewRef }} data-testid="workspace-tab-review">
            {reviewTabLabel(reviewRef)}
          </Link>
        </TabNavItem>
      )}
    </TabNav>
  );
}

/** The project's tabs, from its pieces and this install's: Chats and Workbench alone until both are known; with their `g` shortcuts. */
export function WorkspaceTabs({
  wsId,
  active,
  slots = WORKSPACE_TAB_SLOTS,
  reviewRef,
  crowded = false,
}: {
  wsId: string;
  active: WorkspaceTabId;
  slots?: readonly WorkspaceTabSlot[];
  reviewRef?: string | undefined;
  crowded?: boolean;
}) {
  const settings = useWorkspaceSettings(wsId);
  const available = useBmadPieces();
  // A failed refetch keeps the last data: while either query is in error, nothing is known.
  const pieces = settings.isError ? undefined : settings.data?.bmadPieces;
  const availability = available.isError ? undefined : available.data;
  const { appearance } = useAppearance();
  // Developer mode's Terminals tab, unless the user hid the surface (Settings, Terminals).
  const terminalsSettings = useTerminalsSettings(appearance.developerMode);
  const tabs = visibleWorkspaceTabs(pieces, availability, slots, appearance.developerMode && !terminalsSettings.isPending && terminalsSettings.data?.hidden !== true, !settings.isError && settings.data?.orchestrationEnabled === true);
  useGoShortcuts(wsId, tabs);
  const navigate = useNavigate();
  // The Workbench is every project's, so its Search is always a `g s` away.
  useGoKeys([{ key: 's', run: () => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: { panel: 'search' } }) }]);
  return <WorkspaceTabsView wsId={wsId} tabs={tabs} active={active} hints={appearance.developerMode} reviewRef={reviewRef} crowded={crowded} />;
}
