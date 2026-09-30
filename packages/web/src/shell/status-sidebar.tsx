import { GearSix, PaintBrush, Plus, Robot, Wrench } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AGENT_NAME } from '@/chat/chat-api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarEarlier,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarStatusRow,
  SidebarText,
  SidebarWorkspaceGroup,
  useSidebar,
} from '@/ui/sidebar';
import { Skeleton } from '@/ui/skeleton';
import { STATE_WORDS } from '@/ui/state-glyph';
import { AddProjectDialog } from '@/workspaces/add-project-dialog';
import { NeedsYouGroup } from './needs-you-group';
import { NewTabButton } from './new-tab-button';
import { QuitButton } from './quit-button';
import { ServerStatus } from './server-status';
import { useSidebarData } from './sidebar-data';
import { holdOrder, relativeTime, type SidebarModel, type SidebarRow } from './sidebar-model';
import { Wordmark } from './wordmark';
import { WorkspaceSwitcher } from './workspace-switcher';

/**
 * The status sidebar (EXPERIENCE.md Information Architecture): the workspace
 * switcher in the header, Needs you on top, then each workspace with its
 * session rows (story 2.11) and Add project, then the footer with Settings,
 * New tab, Quit Ogden Agents and the server status.
 */
export function StatusSidebar() {
  return (
    <Sidebar label="Projects and sessions" data-testid="status-sidebar">
      <StatusSidebarBody />
    </Sidebar>
  );
}

/** Where each browser keeps which workspace groups are collapsed. */
export const COLLAPSED_KEY = 'ogden-agents.sidebar-collapsed';

/**
 * The collapsed workspace ids, shared by every copy of the sidebar in the tab
 * (the column and the sheet). Storage may throw (blocked site data) or hold
 * anything; the sidebar then starts with every group open.
 */
const collapsedStore = (() => {
  let value: string | undefined;
  const listeners = new Set<() => void>();
  const read = (): string => {
    if (value !== undefined) return value;
    try {
      value = window.localStorage.getItem(COLLAPSED_KEY) ?? '[]';
    } catch {
      value = '[]';
    }
    return value;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    write(ids: readonly string[]) {
      value = JSON.stringify(ids);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value);
      } catch {
        // Kept for this tab only.
      }
      for (const listener of listeners) listener();
    },
  };
})();

function parseCollapsed(raw: string): ReadonlySet<string> {
  try {
    const ids: unknown = JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function useCollapsedWorkspaces(): [ReadonlySet<string>, (wsId: string, collapsed: boolean) => void] {
  const raw = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.read, () => '[]');
  const collapsed = useMemo(() => parseCollapsed(raw), [raw]);
  const setCollapsed = (wsId: string, value: boolean) => {
    const next = new Set(parseCollapsed(collapsedStore.read()));
    if (value) next.add(wsId);
    else next.delete(wsId);
    collapsedStore.write([...next]);
  };
  return [collapsed, setCollapsed];
}

/**
 * The model as shown: while the pointer is over the sidebar, or keyboard focus
 * is inside it, nothing moves (rows update in place), and the new order applies
 * once both have left (EXPERIENCE.md Interaction Rules).
 */
function useHeldModel(model: SidebarModel, holding: boolean): SidebarModel {
  const shown = useRef<SidebarModel>(model);
  const held = useMemo(() => (holding ? holdOrder(shown.current, model) : model), [holding, model]);
  useEffect(() => {
    shown.current = held;
  }, [held]);
  return held;
}

/** Whether focus arrived from the keyboard (the browser's :focus-visible heuristic). */
function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * The sidebar's content. Below md it is mounted twice (the hidden column and
 * the sheet), so its ids come from useId to stay unique per instance.
 */
function StatusSidebarBody() {
  const projectsId = useId();
  const { model: live, loading, unloaded, now } = useSidebarData();
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // A focused item that unmounts (a Needs you entry answered elsewhere) fires no blur: release the hold then.
  useEffect(() => {
    if (focusInside && !(contentRef.current?.contains(document.activeElement) ?? false)) setFocusInside(false);
  }, [live, focusInside]);
  const model = useHeldModel(live, pointerInside || focusInside);
  const [collapsed, setCollapsed] = useCollapsedWorkspaces();
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const first = model.needsYou[0];
  return (
    <>
      <SidebarHeader>
        <Wordmark />
        {/* The rail has no room for it; Add project stays below. */}
        <WorkspaceSwitcher className="ml-auto md:max-lg:hidden" />
      </SidebarHeader>
      <SidebarContent
        ref={contentRef}
        onPointerEnter={() => setPointerInside(true)}
        onPointerLeave={() => setPointerInside(false)}
        // Keyboard focus only (a clicked row keeps focus after the pointer leaves),
        // and only in this subtree: React also bubbles focus out of portals (the dialog).
        onFocus={(event) => setFocusInside(event.currentTarget.contains(event.target) && isKeyboardFocus(event.target))}
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusInside(false);
        }}
      >
        <NeedsYouGroup
          items={model.needsYou}
          onOpenFirst={first === undefined ? undefined : () => void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId: first.wsId, sesId: first.sesId } })}
        />
        <SidebarGroup aria-labelledby={projectsId}>
          <SidebarGroupLabel id={projectsId}>Projects</SidebarGroupLabel>
          {!loading && model.groups.length === 0 ? <SidebarText data-testid="no-projects">No projects yet</SidebarText> : null}
          {loading ? <Skeleton data-testid="sidebar-loading" /> : null}
          {model.groups.map((group) => (
            <SidebarWorkspaceGroup
              key={group.wsId}
              data-testid="workspace-group"
              name={group.name}
              collapsed={collapsed.has(group.wsId)}
              onCollapsedChange={(value) => setCollapsed(group.wsId, value)}
              summary={group.summary}
            >
              {unloaded.has(group.wsId) ? <Skeleton data-testid="sidebar-loading" /> : null}
              <SessionRows rows={group.rows} now={now} />
              <SidebarEarlier count={group.earlier.length}>
                <SessionRows rows={group.earlier} now={now} />
              </SidebarEarlier>
            </SidebarWorkspaceGroup>
          ))}
          {/* One status line for every skeleton in this copy of the sidebar (EXPERIENCE.md Loading surface). */}
          <span role="status" className="sr-only">
            {loading || unloaded.size > 0 ? 'Loading your projects' : ''}
          </span>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="add-project"
                tooltip="Add project"
                // Keep the sheet open under the dialog; navigating to the project closes it.
                onClick={(event) => {
                  event.preventDefault();
                  setAdding(true);
                }}
              >
                <Plus aria-hidden />
                <SidebarLabel>Add project</SidebarLabel>
              </SidebarMenuButton>
              <AddProjectDialog open={adding} onOpenChange={setAdding} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SettingsMenu />
        <NewTabButton />
        <QuitButton />
        <ServerStatus />
      </SidebarFooter>
    </>
  );
}

/** A workspace's session rows; each opens its session (and closes the sheet). */
function SessionRows({ rows, now }: { rows: readonly SidebarRow[]; now: number }) {
  const params = useParams({ strict: false }) as { sesId?: string };
  if (rows.length === 0) return null;
  return (
    <SidebarMenu>
      {rows.map((row) => (
        <SessionRow
          key={row.sesId}
          wsId={row.wsId}
          sesId={row.sesId}
          state={row.state}
          title={row.title}
          updatedAt={row.updatedAt}
          time={relativeTime(row.updatedAt, now)}
          active={params.sesId === row.sesId}
        />
      ))}
    </SidebarMenu>
  );
}

/** One row, from plain values, so a chunk streaming in another chat re-renders none of the others. */
const SessionRow = memo(function SessionRow({
  wsId,
  sesId,
  state,
  title,
  updatedAt,
  time,
  active,
}: Pick<SidebarRow, 'wsId' | 'sesId' | 'state' | 'title' | 'updatedAt'> & { time: string; active: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarStatusRow
        data-testid="status-row"
        state={state}
        title={title}
        caption={`${AGENT_NAME}, ${STATE_WORDS[state].toLowerCase()}`}
        time={{ label: time, dateTime: updatedAt }}
        isActive={active}
      >
        <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId }} />
      </SidebarStatusRow>
    </SidebarMenuItem>
  );
});

/** Settings sections: Agents (9.1), Appearance and Tools (Notifications arrives with a later epic). */
function SettingsMenu() {
  const { setSheetOpen } = useSidebar();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton data-testid="settings-menu" tooltip="Settings" onClick={(event) => event.preventDefault()}>
          <GearSix aria-hidden />
          <SidebarLabel>Settings</SidebarLabel>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>Settings</DropdownMenuLabel>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/agents">
            <Robot aria-hidden />
            Agents
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/appearance">
            <PaintBrush aria-hidden />
            Appearance
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/tools">
            <Wrench aria-hidden />
            Tools
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
