import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentSettingsPage, SETTINGS_GROUPS, settingsGroupFor, visibleSettingsGroups } from '../src/settings/settings-groups';

/** Every child route of `settingsRoute` in router.tsx, as a full path, so a new settings page can't miss the nav. */
function routerSettingsPaths(): string[] {
  const source = readFileSync(join(import.meta.dirname, '../src/router.tsx'), 'utf8');
  return [...source.matchAll(/getParentRoute: \(\) => settingsRoute,\s*path: '([^']+)'/g)].map((m) => `/settings${m[1]}`);
}

describe('settings groups (epic 26, E26-R7)', () => {
  it('has the seven groups in order', () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual(['Agents', 'Projects', 'Appearance', 'Notifications', 'Terminals', 'Remote machines', 'Advanced']);
  });

  it('maps every settings route in the router to exactly one group and page', () => {
    const paths = routerSettingsPaths();
    expect(paths).toHaveLength(13);
    for (const path of paths) {
      expect(settingsGroupFor(path), path).toBeDefined();
      const owners = SETTINGS_GROUPS.filter((g) => g.pages.some((p) => path === p.to || path.startsWith(`${p.to}/`)));
      expect(owners, path).toHaveLength(1);
    }
    // Every page in the table is a real settings route; Welcome lives in Help (26.5).
    for (const page of SETTINGS_GROUPS.flatMap((g) => g.pages)) expect(paths).toContain(page.to);
  });

  it('a sub-page makes its group current and itself the current page', () => {
    expect(settingsGroupFor('/settings/mcp')?.id).toBe('advanced');
    expect(currentSettingsPage('/settings/mcp')?.label).toBe('MCP servers');
    expect(settingsGroupFor('/settings/mcp')?.pages.map((p) => p.label)).toEqual(['Tools', 'Developer tools', 'MCP servers', 'About']);
    expect(settingsGroupFor('/settings/builds')?.id).toBe('projects');
    // Every project's Always allow rules sit in Projects (epic 26 story 8).
    expect(settingsGroupFor('/settings/always-allow')?.pages.map((p) => p.label)).toEqual(['New projects', 'Always allow rules', 'Builds']);
    expect(currentSettingsPage('/settings/always-allow')?.label).toBe('Always allow rules');
  });

  it('Add your own agent is Agents, and a trailing slash changes nothing', () => {
    expect(settingsGroupFor('/settings/agents/new')?.id).toBe('agents');
    expect(currentSettingsPage('/settings/agents/new')?.to).toBe('/settings/agents');
    expect(settingsGroupFor('/settings/appearance/')?.id).toBe('appearance');
  });

  it('shows Terminals only in Developer mode, or while its page is open', () => {
    const ids = (path: string, developer: boolean) => visibleSettingsGroups(path, developer).map((g) => g.id);
    expect(ids('/settings/appearance', false)).not.toContain('terminals');
    expect(ids('/settings/appearance', true)).toContain('terminals');
    expect(ids('/settings/terminals', false)).toContain('terminals');
    expect(settingsGroupFor('/settings/terminals')?.id).toBe('terminals');
  });

  it('a path outside settings has no group', () => {
    expect(settingsGroupFor('/w/x/settings')).toBeUndefined();
    expect(settingsGroupFor('/')).toBeUndefined();
    expect(settingsGroupFor('/welcome')).toBeUndefined();
    expect(settingsGroupFor('/settings')).toBeUndefined();
    expect(settingsGroupFor('/settings/agentsx')).toBeUndefined();
    expect(currentSettingsPage('/w/x/settings')).toBeUndefined();
  });
});
