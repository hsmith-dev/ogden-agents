import { useDeveloperModeOn } from '@/appearance/appearance-provider';
import { Bell, FolderSimplePlus, GearSix, HandWaving, Hammer, Info, PaintBrush, Plus, Robot, TerminalWindow, Wrench } from '@phosphor-icons/react';
import { NEW_PROJECTS_SETTINGS_LABEL } from '@ogden-agents/shared';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useChatRename } from '@/chat/chat-name';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarEarlier,
  SidebarFilter,
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
import { SidebarStartChat } from './sidebar-start-chat';
import { holdOrder, relativeTime, type SidebarModel, type SidebarRow } from './sidebar-model';
import { Wordmark } from './wordmark';
import { filterProjects, showsProjectFilter } from './project-filter';

/**
 * The status sidebar (EXPERIENCE.md Information Architecture): the one place
 * to see, open, add and manage projects (backlog story 13). Needs you on top,
 * then each workspace (its name opens it, a gear its settings) with its
 * session rows (story 2.11), a filter when there are many, and Add project,
 * then the footer with Settings, New tab, Quit Ogden Agents and the server status.
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
  const filterId = useId();
  const [filter, setFilter] = useState('');
  const { wsId: currentWsId } = useParams({ strict: false }) as { wsId?: string };
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
  const filtering = showsProjectFilter(model.groups.length);
  // Filtered-out groups stay mounted and only hide in the full form: the rail has no field, so it shows them all.
  const matching = new Set((filtering ? filterProjects(model.groups, filter) : model.groups).map((group) => group.wsId));
  const filterStatus = !filtering || filter.trim() === '' ? '' : matching.size === 0 ? 'No projects match' : `${matching.size} of ${model.groups.length} projects`;
  return (
    <>
      <SidebarHeader>
        <Wordmark />
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
          onOpenFirst={
            first === undefined
              ? undefined
              : () => void (first.paneId === undefined ? navigate({ to: '/w/$wsId/s/$sesId', params: { wsId: first.wsId, sesId: first.sesId } }) : navigate({ to: '/w/$wsId/terminals' as never, params: { wsId: first.wsId } as never }))
          }
        />
        <SidebarGroup aria-labelledby={projectsId}>
          <SidebarGroupLabel id={projectsId}>Projects</SidebarGroupLabel>
          {!loading && model.groups.length === 0 ? <SidebarText data-testid="no-projects">No projects yet</SidebarText> : null}
          {loading ? <Skeleton data-testid="sidebar-loading" /> : null}
          {filtering ? (
            <SidebarFilter id={filterId} label="Filter projects" value={filter} onValueChange={setFilter} status={filterStatus} data-testid="project-filter">
              {matching.size === 0 ? <SidebarText data-testid="no-project-matches">No projects match</SidebarText> : null}
            </SidebarFilter>
          ) : null}
          {model.groups.map((group) => (
            <SidebarWorkspaceGroup
              key={group.wsId}
              data-testid="workspace-group"
              name={group.name}
              filteredOut={!matching.has(group.wsId)}
              current={group.wsId === currentWsId}
              link={<Link to="/w/$wsId" params={{ wsId: group.wsId }} activeOptions={{ exact: true, includeSearch: false }} data-testid="workspace-link" />}
              settingsLink={<Link to="/w/$wsId/settings" params={{ wsId: group.wsId }} data-testid="workspace-settings" />}
              collapsed={collapsed.has(group.wsId)}
              onCollapsedChange={(value) => setCollapsed(group.wsId, value)}
              summary={group.summary}
            >
              {unloaded.has(group.wsId) ? <Skeleton data-testid="sidebar-loading" /> : null}
              {/* A project with no chats offers to start one (EXPERIENCE.md Status sidebar). */}
              {!unloaded.has(group.wsId) && group.rows.length === 0 && group.earlier.length === 0 ? <SidebarStartChat wsId={group.wsId} name={group.name} /> : null}
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
          userTitle={row.userTitle}
          updatedAt={row.updatedAt}
          agentName={row.agentName}
          model={row.model}
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
  userTitle,
  updatedAt,
  agentName,
  model,
  time,
  active,
}: Pick<SidebarRow, 'wsId' | 'sesId' | 'state' | 'title' | 'userTitle' | 'updatedAt' | 'agentName' | 'model'> & { time: string; active: boolean }) {
  // Rename in place (backlog story 12): double click the row or press F2 on it.
  const rename = useChatRename({ wsId, sesId, name: title, title: userTitle });
  const item = useRef<HTMLLIElement>(null);
  const row = () => item.current?.querySelector<HTMLElement>('[data-testid="status-row"]');
  // Not in the rail (md to lg): a name field doesn't fit its width; the header's Rename works there.
  const startRename = () => {
    // The rail is the row's CSS: there its label is for screen readers only (taken out of the flow).
    const label = row()?.querySelector('bdi')?.parentElement;
    if (label != null && getComputedStyle(label).position === 'absolute') return;
    rename.start(row);
  };
  return (
    <SidebarMenuItem ref={item}>
      {rename.editing ? (
        <div className="px-1 py-1">{rename.field}</div>
      ) : (
        <SidebarStatusRow
          data-testid="status-row"
          state={state}
          title={title}
          caption={`${agentName}, ${STATE_WORDS[state].toLowerCase()}`}
          detail={model === undefined ? undefined : `${agentName} on ${model}`}
          time={{ label: time, dateTime: updatedAt }}
          isActive={active}
          aria-keyshortcuts="F2"
          onDoubleClick={startRename}
          onKeyDown={(event) => {
            if (event.key !== 'F2') return;
            event.preventDefault();
            startRename();
          }}
        >
          <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId }} />
        </SidebarStatusRow>
      )}
      {rename.status}
    </SidebarMenuItem>
  );
});

/** Settings sections: Agents (9.1), Appearance, New projects (10.4), Notifications (backlog story 8; webhooks join it with builds) and Tools, and Welcome again (9.5). */
function SettingsMenu() {
  const { setSheetOpen } = useSidebar();
  // Terminals settings are Developer mode's (epic 16): a simple user never sees the entry (AD-21).
  const developerMode = useDeveloperModeOn();
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
          <Link to="/settings/new-projects">
            <FolderSimplePlus aria-hidden />
            {NEW_PROJECTS_SETTINGS_LABEL}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/builds">
            <Hammer aria-hidden />
            Builds
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/notifications">
            <Bell aria-hidden />
            Notifications
          </Link>
        </DropdownMenuItem>
        {developerMode ? (
          <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
            <Link to={'/settings/terminals' as '/settings/tools'} data-testid="settings-terminals">
              <TerminalWindow aria-hidden />
              Terminals
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/tools">
            <Wrench aria-hidden />
            Tools
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/settings/about">
            <Info aria-hidden />
            About
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild onSelect={() => setSheetOpen(false)}>
          <Link to="/welcome">
            <HandWaving aria-hidden />
            Welcome
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
