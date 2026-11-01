import { EDITOR_SETTINGS_LABEL, NEW_PROJECTS_SETTINGS_LABEL, WORKTREES_SETTINGS_TITLE } from '@ogden-agents/shared';

/*
 * Settings' groups (epic 26, E26-R7; EXPERIENCE.md Information Architecture):
 * the one table behind the settings nav, its phone select and, later, the
 * command palette (26.3). Every page is an existing route; a group's first
 * page is where its nav row goes.
 */

/** The Phosphor glyph of each group (DESIGN.md settings-nav). */
export type SettingsGlyph = 'Robot' | 'Folders' | 'Palette' | 'Bell' | 'TerminalWindow' | 'DesktopTower' | 'Sliders';

export type SettingsGroupId = 'agents' | 'projects' | 'appearance' | 'notifications' | 'terminals' | 'remote-machines' | 'advanced';

export interface SettingsPage {
  label: string;
  /** The page's route, under `/settings` (Welcome lives in Help, 26.5). */
  to: string;
}

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  glyph: SettingsGlyph;
  /** The group's pages; the first is the group's own link. */
  pages: readonly SettingsPage[];
  /** Shown only in Developer mode (AD-21), or while one of its pages is open. */
  developerOnly?: boolean;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'agents', label: 'Agents', glyph: 'Robot', pages: [{ label: 'Agents', to: '/settings/agents' }] },
  {
    id: 'projects',
    label: 'Projects',
    glyph: 'Folders',
    // Builds sits here: it limits the builds the projects run.
    pages: [
      { label: NEW_PROJECTS_SETTINGS_LABEL, to: '/settings/new-projects' },
      // Every project's Always allow rules (epic 26 story 8, AD-40).
      { label: 'Always allow rules', to: '/settings/always-allow' },
      { label: 'Builds', to: '/settings/builds' },
      // The install's chat worktree cap (epic 27, 27.6).
      { label: WORKTREES_SETTINGS_TITLE, to: '/settings/worktrees' },
      // The editor Open in editor hands files to (AD-39, 8.10).
      { label: EDITOR_SETTINGS_LABEL, to: '/settings/editor' },
    ],
  },
  { id: 'appearance', label: 'Appearance', glyph: 'Palette', pages: [{ label: 'Appearance', to: '/settings/appearance' }] },
  { id: 'notifications', label: 'Notifications', glyph: 'Bell', pages: [{ label: 'Notifications', to: '/settings/notifications' }] },
  { id: 'terminals', label: 'Terminals', glyph: 'TerminalWindow', developerOnly: true, pages: [{ label: 'Terminals', to: '/settings/terminals' }] },
  { id: 'remote-machines', label: 'Remote machines', glyph: 'DesktopTower', pages: [{ label: 'Remote machines', to: '/settings/remote-machines' }] },
  {
    id: 'advanced',
    label: 'Advanced',
    glyph: 'Sliders',
    pages: [
      { label: 'Tools', to: '/settings/tools' },
      { label: 'Developer tools', to: '/settings/dev-tools' },
      { label: 'MCP servers', to: '/settings/mcp' },
      { label: 'About', to: '/settings/about' },
    ],
  },
];

const trimmed = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);

/** The page and group a path belongs to: the longest page route it is or sits under, only for `/settings/*` paths. */
function match(pathname: string): { group: SettingsGroup; page: SettingsPage } | undefined {
  const path = trimmed(pathname);
  if (!path.startsWith('/settings/')) return undefined;
  let best: { group: SettingsGroup; page: SettingsPage } | undefined;
  for (const group of SETTINGS_GROUPS) {
    for (const page of group.pages) {
      if (path !== page.to && !path.startsWith(`${page.to}/`)) continue;
      if (best === undefined || page.to.length > best.page.to.length) best = { group, page };
    }
  }
  return best;
}

/** The group of a settings path (`/settings/agents/new` is Agents), or undefined outside settings. */
export function settingsGroupFor(pathname: string): SettingsGroup | undefined {
  return match(pathname)?.group;
}

/** The page of a settings path (`/settings/mcp` is MCP servers), or undefined outside settings. */
export function currentSettingsPage(pathname: string): SettingsPage | undefined {
  return match(pathname)?.page;
}

/** The groups the nav shows: Terminals only in Developer mode, or while its page is open. */
export function visibleSettingsGroups(pathname: string, developerMode: boolean): SettingsGroup[] {
  const current = settingsGroupFor(pathname);
  return SETTINGS_GROUPS.filter((group) => developerMode || group.developerOnly !== true || group.id === current?.id);
}
