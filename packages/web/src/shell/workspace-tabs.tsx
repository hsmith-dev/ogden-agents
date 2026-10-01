import type { BmadPiece, BmadPieceAvailability } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { TabNav, TabNavItem } from '@/ui/tab-nav';
import { useBmadPieces, useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * The project's section tabs in the workspace header (E10-R6; story 10.6).
 * Chats is always there. Plan, Board and Runs are slots that epics 4 and 5
 * only fill: each shows only when its BMad piece is on for the project,
 * available on this install, and its page exists (the filling epic sets its
 * `to`). So a simple project, with every piece off, shows Chats alone, and
 * so does any project while its settings load or fail to.
 */

export type WorkspaceTabId = 'chats' | 'plan' | 'board' | 'runs';

export interface WorkspaceTabSlot {
  id: WorkspaceTabId;
  label: string;
  /** The BMad piece the tab serves; none for Chats, which is always there. */
  piece?: BmadPiece;
  /** The tab's route, with `$wsId`; unset until the epic that builds its page sets it. */
  to?: string;
}

/** Every slot, in order. Epic 4.6 sets Plan's `to`, 4.9 Board's, epic 5 Runs'. */
export const WORKSPACE_TAB_SLOTS: readonly WorkspaceTabSlot[] = [
  { id: 'chats', label: 'Chats', to: '/w/$wsId' },
  { id: 'plan', label: 'Plan', piece: 'planning' },
  { id: 'board', label: 'Board', piece: 'board' },
  { id: 'runs', label: 'Runs', piece: 'builds' },
];

/** A slot that can be shown: it has a page to link to. */
export type VisibleWorkspaceTab = WorkspaceTabSlot & { to: string };

/**
 * The tabs to show, in slot order: those with a page, and, for a piece's
 * tab, only when the project has the piece on and this install has it
 * available. `pieces` or `availability` unknown (loading or failed) shows
 * only the tabs that serve no piece.
 */
export function visibleWorkspaceTabs(
  pieces: readonly BmadPiece[] | undefined,
  availability: readonly BmadPieceAvailability[] | undefined,
  slots: readonly WorkspaceTabSlot[] = WORKSPACE_TAB_SLOTS,
): VisibleWorkspaceTab[] {
  return slots.filter((slot): slot is VisibleWorkspaceTab => {
    if (slot.to === undefined) return false;
    if (slot.piece === undefined) return true;
    const piece = slot.piece;
    return pieces?.includes(piece) === true && availability?.some((entry) => entry.piece === piece && entry.available) === true;
  });
}

/** The tabs as links; `active` is marked as the current page. */
export function WorkspaceTabsView({ wsId, tabs, active }: { wsId: string; tabs: readonly VisibleWorkspaceTab[]; active: WorkspaceTabId }) {
  return (
    <TabNav label="Project sections" data-testid="workspace-tabs">
      {tabs.map((tab) => (
        <TabNavItem key={tab.id} current={tab.id === active} asChild>
          <Link
            // A slot's route is set by the epic that builds its page; Chats' is `/w/$wsId`.
            to={tab.to as '/w/$wsId'}
            params={{ wsId }}
            // `active` decides: the router would also mark Chats current on any page below `/w/$wsId`.
            activeOptions={{ exact: tab.id !== active, includeSearch: false }}
            data-testid={`workspace-tab-${tab.id}`}
          >
            {tab.label}
          </Link>
        </TabNavItem>
      ))}
    </TabNav>
  );
}

/** The project's tabs, from its pieces and this install's: Chats alone until both are known. */
export function WorkspaceTabs({ wsId, active, slots = WORKSPACE_TAB_SLOTS }: { wsId: string; active: WorkspaceTabId; slots?: readonly WorkspaceTabSlot[] }) {
  const settings = useWorkspaceSettings(wsId);
  const available = useBmadPieces();
  // A failed refetch keeps the last data: while either query is in error, nothing is known.
  const pieces = settings.isError ? undefined : settings.data?.bmadPieces;
  const availability = available.isError ? undefined : available.data;
  const tabs = visibleWorkspaceTabs(pieces, availability, slots);
  return <WorkspaceTabsView wsId={wsId} tabs={tabs} active={active} />;
}
