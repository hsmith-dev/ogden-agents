import type { SessionState, TicketRow } from '@ogden-agents/shared';
import { Bell, Desktop, File as FileIcon, Files, Folder, MagnifyingGlass, Moon, NotePencil, Rows, Sun, Ticket, type Icon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { ThemePreference } from '@/appearance/appearance';
import { useAppearance } from '@/appearance/appearance-provider';
import { DETAIL_MENU_WORDS, setChatDetail, useChatDetail, type ChatDetail } from '@/chat/detail-level';
import { useOpenNewChat } from '@/chat/new-chat';
import { fetchTickets } from '@/planning/planning-api';
import { SETTINGS_GLYPHS } from '@/settings/settings-glyphs';
import { visibleSettingsGroups, type SettingsGroup } from '@/settings/settings-groups';
import { markNeedsYouOpened, needsYouTarget, nextNeedsYou, lastNeedsYouOpened } from '@/shell/needs-you-target';
import { useSidebarData } from '@/shell/sidebar-data';
import { UNTITLED, type SidebarWorkspace } from '@/shell/sidebar-model';
import { visibleWorkspaceTabs } from '@/shell/workspace-tabs';
import { parentOf, usePaletteFileSearch } from '@/workbench/workbench-api';
import { SEARCH_DEBOUNCE_MS } from '@/workbench/workbench-search';
import { fetchBmadPieces, fetchWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { rankItems } from './palette-match';
import type { PaletteMode } from './palette-store';
import { recentChats, type RecentChat } from './recent-chats';

/**
 * Where the command palette's results come from (epic 26 story 3;
 * EXPERIENCE.md Command palette). Each source is a hook for one group, and
 * {@link PALETTE_SOURCES} is a constant list called in the same order on
 * every render, so a story adds a group by appending one entry (8.11 added
 * Files, in the `files` slot). The builders are pure, so what each
 * source offers in each context is unit-tested.
 */

/** The groups, in the order typed results show them. */
export type PaletteGroupId = 'chats' | 'projects' | 'files' | 'tickets' | 'actions';

export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = ['chats', 'projects', 'files', 'tickets', 'actions'];

/** The empty query's groups: Recent chats, Actions, Projects. */
export const PALETTE_EMPTY_ORDER: readonly PaletteGroupId[] = ['chats', 'actions', 'projects'];

/** Each group's heading (sentence case); the chats group reads "Recent chats" on the empty query. */
export const PALETTE_GROUP_LABELS: Record<PaletteGroupId, string> = {
  chats: 'Chats',
  projects: 'Projects',
  files: 'Files',
  tickets: 'Tickets',
  actions: 'Actions',
};

export const RECENT_CHATS_LABEL = 'Recent chats';
/** How many recent chats the empty query shows. */
export const RECENT_CHATS_SHOWN = 5;

/** A row's leading glyph: a chat's state glyph, or an icon. */
export type PaletteGlyph = { state: SessionState } | { icon: Icon };

export interface PaletteItem {
  id: string;
  group: PaletteGroupId;
  label: string;
  /** Where it is ("Letterpress"), in caption beside the name. */
  context?: string | undefined;
  glyph: PaletteGlyph;
  /** Its shortcut (presses in turn), shown in Developer mode only. */
  keys?: readonly string[] | undefined;
  /** Other words it answers to (matched after the label). */
  keywords?: readonly string[] | undefined;
  /** What Enter does. */
  run?: (() => void) | undefined;
  /** Instead of running: moves the palette to this mode ("New chat in..."). */
  mode?: PaletteMode | undefined;
  /** It stays on the page (a theme, the detail level): focus goes back to where it was. */
  returnFocus?: boolean | undefined;
}

/** What every source sees. */
export interface PaletteContext {
  open: boolean;
  /** Everything, or "New chat in..." (which lists only projects). */
  mode: PaletteMode;
  query: string;
  /** The project on screen, if any. */
  wsId: string | undefined;
  /** The chat on screen, if any. */
  sesId: string | undefined;
  pathname: string;
  developerMode: boolean;
}

export interface PaletteSource {
  group: PaletteGroupId;
  useItems: (ctx: PaletteContext) => PaletteItem[];
}

const isEmpty = (query: string) => query.trim() === '';

// ---- Chats ----

/**
 * Every chat with a name (all projects, Earlier too); on the empty query, the
 * recent ones that still exist, newest first. A chat with no name yet
 * ("New chat") is left out of typed results, so typing "New chat" finds the
 * action, not every unnamed chat.
 */
export function chatItems(groups: readonly SidebarWorkspace[], query: string, recent: readonly RecentChat[], openChat: (wsId: string, sesId: string) => void): PaletteItem[] {
  const item = (group: SidebarWorkspace, row: SidebarWorkspace['rows'][number]): PaletteItem => ({
    id: `chat:${row.sesId}`,
    group: 'chats',
    label: row.title,
    context: group.name,
    glyph: { state: row.state },
    run: () => openChat(row.wsId, row.sesId),
  });
  if (isEmpty(query)) {
    const byId = new Map<string, PaletteItem>();
    for (const group of groups) for (const row of [...group.rows, ...group.earlier]) byId.set(row.sesId, item(group, row));
    return recent
      .map((chat) => byId.get(chat.sesId))
      .filter((each): each is PaletteItem => each !== undefined)
      .slice(0, RECENT_CHATS_SHOWN);
  }
  return groups.flatMap((group) =>
    [...group.rows, ...group.earlier].filter((row) => row.userTitle !== null || row.title !== UNTITLED).map((row) => item(group, row)),
  );
}

function useChatItems(ctx: PaletteContext): PaletteItem[] {
  const { model } = useSidebarData();
  const navigate = useNavigate();
  // Read again each time the palette opens: the list changes as chats are opened.
  const recent = useMemo(() => (ctx.open ? recentChats() : []), [ctx.open]);
  return chatItems(model.groups, ctx.query, recent, (wsId, sesId) => void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId } }));
}

// ---- Projects ----

/** Every project, in the sidebar's order. */
export function projectItems(groups: readonly SidebarWorkspace[], openProject: (wsId: string) => void, group: PaletteGroupId = 'projects'): PaletteItem[] {
  return groups.map((each) => ({ id: `project:${each.wsId}`, group, label: each.name, glyph: { icon: Folder }, run: () => openProject(each.wsId) }));
}

function useProjectItems(): PaletteItem[] {
  const { model } = useSidebarData();
  const navigate = useNavigate();
  return projectItems(model.groups, (wsId) => void navigate({ to: '/w/$wsId', params: { wsId } }));
}

/** "New chat in...": every project, each opening its new-chat draft. */
export function useNewChatInItems(): PaletteItem[] {
  const { model } = useSidebarData();
  const openNewChat = useOpenNewChat();
  return projectItems(model.groups, (wsId) => openNewChat(wsId));
}

// ---- Tickets ----

/** The current project's tickets as "1.2 Build the second thing"; none on the empty query. */
export function ticketItems(wsId: string | undefined, tickets: readonly TicketRow[] | undefined, query: string, openTicket: (wsId: string, ref: string) => void): PaletteItem[] {
  if (wsId === undefined || tickets === undefined || isEmpty(query)) return [];
  return tickets.map((ticket) => ({
    id: `ticket:${ticket.ref}`,
    group: 'tickets',
    label: `${ticket.ref} ${ticket.title}`,
    glyph: { icon: Ticket },
    run: () => openTicket(wsId, ticket.ref),
  }));
}

/**
 * The current project's tickets, only while the palette is open and the
 * project has its Board on: one read, cached under the Board's own key. Any
 * failure (scripts not trusted, BMad Method missing) leaves the group out.
 */
function useTicketItems(ctx: PaletteContext): PaletteItem[] {
  const navigate = useNavigate();
  const { wsId } = ctx;
  const active = ctx.open && wsId !== undefined;
  const settings = useQuery({ queryKey: ['workspace-settings', wsId], queryFn: () => fetchWorkspaceSettings(wsId!), retry: false, enabled: active });
  const pieces = useQuery({ queryKey: ['bmad-pieces'], queryFn: () => fetchBmadPieces(), retry: false, staleTime: Number.POSITIVE_INFINITY, enabled: active });
  const boardOn =
    active &&
    !settings.isError &&
    !pieces.isError &&
    visibleWorkspaceTabs(settings.data?.bmadPieces, pieces.data).some((tab) => tab.id === 'board');
  const tickets = useQuery({ queryKey: ['tickets', wsId], queryFn: () => fetchTickets(wsId!), retry: false, enabled: boardOn });
  const rows = boardOn && !tickets.isError ? tickets.data?.tickets : undefined;
  return ticketItems(wsId, rows, ctx.query, (ws, ref) => void navigate({ to: '/w/$wsId/board/$ref', params: { wsId: ws, ref } }));
}

// ---- Files ----

/** At most this many files show (the best by the palette's own matcher). */
export const PALETTE_FILES_SHOWN = 8;

/**
 * The current project's files from the name search: each by its name, its
 * folder in caption (none at the root), its path as a keyword (a folder
 * part matches, ranked below a name); the best {@link PALETTE_FILES_SHOWN}.
 * None outside a project, without results, or on the empty query.
 */
export function fileItems(wsId: string | undefined, paths: readonly string[] | undefined, query: string, openFile: (wsId: string, path: string) => void): PaletteItem[] {
  if (wsId === undefined || paths === undefined || isEmpty(query)) return [];
  const items: PaletteItem[] = paths.map((path) => {
    const folder = parentOf(path);
    return {
      id: `file:${path}`,
      group: 'files',
      label: path.slice(folder === '' ? 0 : folder.length + 1),
      context: folder === '' ? undefined : folder,
      glyph: { icon: FileIcon },
      keywords: [path],
      run: () => openFile(wsId, path),
    };
  });
  return rankItems(query, items, ['files'], PALETTE_FILES_SHOWN).map((ranked) => ranked.item);
}

/** `value` once it has stayed the same for `delay` ms; `''` at once. */
function useDebouncedValue(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === '') {
      setSettled('');
      return;
    }
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return value === '' ? '' : settled;
}

/**
 * The current project's files (8.11): only while the palette is open on
 * everything, in a project, with something typed, after a pause in typing.
 * Closing, leaving the project or a newer query cancels the request in
 * flight; any failure leaves the group out. Results are never kept.
 */
function useFileItems(ctx: PaletteContext): PaletteItem[] {
  const navigate = useNavigate();
  const active = ctx.open && ctx.mode === 'all' && ctx.wsId !== undefined;
  const typed = active ? ctx.query.trim() : '';
  const settled = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const search = usePaletteFileSearch(ctx.wsId, settled, active);
  const paths = active && settled !== '' && !search.isError ? search.data?.files.map((file) => file.path) : undefined;
  return fileItems(ctx.wsId, paths, ctx.query, (wsId, path) => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: { path } }));
}

// ---- Actions ----

/** The theme actions' words, as the Appearance page names them. */
export const THEME_WORDS: Record<ThemePreference, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_GLYPHS: Record<ThemePreference, Icon> = { light: Sun, dark: Moon, system: Desktop };

export interface ActionInputs {
  wsId: string | undefined;
  sesId: string | undefined;
  /** The chat's detail level (when on a chat). */
  detail: ChatDetail;
  /** Whether Needs you has anything. */
  hasNeedsYou: boolean;
  settingsGroups: readonly SettingsGroup[];
  theme: ThemePreference;
  newChat: (wsId: string) => void;
  /** The project's Workbench, or its Search panel. */
  openWorkbench: (wsId: string, panel?: 'search') => void;
  goToNeedsYou: () => void;
  setDetail: (sesId: string, level: ChatDetail) => void;
  openPage: (to: string) => void;
  setTheme: (theme: ThemePreference) => void;
}

/**
 * New chat (in a project), New chat in..., Go to Needs you (when it has
 * anything), Workbench and Search the project (in a project, as `g w` and
 * `g s` open them), the detail level (on a chat), each Settings group, and
 * the two themes not in use. Run tests waits for Problems (epic 8).
 */
export function actionItems(inputs: ActionInputs): PaletteItem[] {
  const items: PaletteItem[] = [];
  const { wsId, sesId } = inputs;
  if (wsId !== undefined) {
    items.push({ id: 'action:new-chat', group: 'actions', label: 'New chat', glyph: { icon: NotePencil }, keys: ['g', 'n'], run: () => inputs.newChat(wsId) });
  }
  items.push({ id: 'action:new-chat-in', group: 'actions', label: 'New chat in...', glyph: { icon: NotePencil }, mode: 'new-chat-in' });
  if (inputs.hasNeedsYou) {
    items.push({ id: 'action:needs-you', group: 'actions', label: 'Go to Needs you', glyph: { icon: Bell }, keys: ['g', 'y'], run: inputs.goToNeedsYou });
  }
  if (wsId !== undefined) {
    items.push({ id: 'action:workbench', group: 'actions', label: 'Workbench', glyph: { icon: Files }, keys: ['g', 'w'], run: () => inputs.openWorkbench(wsId) });
    items.push({ id: 'action:search', group: 'actions', label: 'Search the project', glyph: { icon: MagnifyingGlass }, keys: ['g', 's'], run: () => inputs.openWorkbench(wsId, 'search') });
  }
  if (sesId !== undefined) {
    const next: ChatDetail = inputs.detail === 'normal' ? 'verbose' : 'normal';
    items.push({
      id: 'action:detail',
      group: 'actions',
      label: DETAIL_MENU_WORDS[inputs.detail],
      glyph: { icon: Rows },
      keywords: ['Detail level'],
      returnFocus: true,
      run: () => inputs.setDetail(sesId, next),
    });
  }
  for (const group of inputs.settingsGroups) {
    const to = group.pages[0]!.to;
    items.push({
      id: `action:settings:${group.id}`,
      group: 'actions',
      label: `Settings: ${group.label}`,
      glyph: { icon: SETTINGS_GLYPHS[group.glyph] },
      keywords: group.pages.map((page) => page.label),
      run: () => inputs.openPage(to),
    });
  }
  for (const theme of ['light', 'dark', 'system'] as const) {
    if (theme === inputs.theme) continue;
    items.push({
      id: `action:theme:${theme}`,
      group: 'actions',
      label: `Theme: ${THEME_WORDS[theme]}`,
      glyph: { icon: THEME_GLYPHS[theme] },
      keywords: ['Appearance'],
      returnFocus: true,
      run: () => inputs.setTheme(theme),
    });
  }
  return items;
}

function useActionItems(ctx: PaletteContext): PaletteItem[] {
  const { model } = useSidebarData();
  const navigate = useNavigate();
  const openNewChat = useOpenNewChat();
  const { appearance, update } = useAppearance();
  const detail = useChatDetail(ctx.sesId ?? '', ctx.developerMode);
  return actionItems({
    wsId: ctx.wsId,
    sesId: ctx.sesId,
    detail,
    hasNeedsYou: model.needsYou.length > 0,
    settingsGroups: visibleSettingsGroups(ctx.pathname, ctx.developerMode),
    theme: appearance.theme,
    newChat: openNewChat,
    openWorkbench: (wsId, panel) => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: panel === undefined ? {} : { panel } }),
    // As `g y` does (needs-you-keys.tsx): the row after the one last opened, wrapping.
    goToNeedsYou: () => {
      const next = nextNeedsYou(model.needsYou, lastNeedsYouOpened());
      if (next === undefined) return;
      markNeedsYouOpened(next.id);
      void navigate(needsYouTarget(next));
    },
    setDetail: setChatDetail,
    openPage: (to) => void navigate({ to }),
    setTheme: (theme) => update({ theme }),
  });
}

/** The sources, in a fixed order (hooks are called in it every render); Files (8.11) last, shown in its slot by the group order. */
export const PALETTE_SOURCES: readonly PaletteSource[] = [
  { group: 'chats', useItems: useChatItems },
  { group: 'projects', useItems: useProjectItems },
  { group: 'tickets', useItems: useTicketItems },
  { group: 'actions', useItems: useActionItems },
  { group: 'files', useItems: useFileItems },
];
