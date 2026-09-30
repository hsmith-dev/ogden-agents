import type { Workspace, WorkspaceId } from '@ogden-agents/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { switcherItems, WorkspaceSwitcherView } from '../src/shell/workspace-switcher';
import { workspaceName } from '../src/workspaces/workspace-api';

const workspace = (id: string, realPath: string): Workspace => ({
  id: `ws_01J9Z3K4M5N6P7Q8R9S0T1V2${id}` as WorkspaceId,
  path: realPath.toLowerCase(),
  realPath,
  createdAt: '2026-09-30T00:00:00.000Z',
});

const kiln = workspace('A1', '/Users/sam/clay-and-kiln');
const press = workspace('B2', 'C:\\Users\\sam\\Letterpress');
const apps = workspace('C3', '/Users/sam/apps/');

describe('workspace switcher (EXPERIENCE.md Workspace switcher)', () => {
  it('names a workspace by the last segment of its real path, on / or \\', () => {
    expect(workspaceName(kiln)).toBe('clay-and-kiln');
    expect(workspaceName(press)).toBe('Letterpress');
    expect(workspaceName(apps)).toBe('apps');
    expect(workspaceName(workspace('D4', '/'))).toBe('/');
  });

  it('lists every workspace by folder name ignoring case, with the current one checked', () => {
    expect(switcherItems([kiln, press, apps], press.id)).toEqual([
      { id: apps.id, name: 'apps', current: false },
      { id: kiln.id, name: 'clay-and-kiln', current: false },
      { id: press.id, name: 'Letterpress', current: true },
    ]);
    expect(switcherItems([], undefined)).toEqual([]);
  });

  it('shows the current project on its trigger, or Projects when none is open', () => {
    const render = (currentId: string | undefined) =>
      renderToStaticMarkup(<WorkspaceSwitcherView items={switcherItems([kiln, press], currentId)} onSelect={() => {}} onAddProject={() => {}} />);
    const open = render(kiln.id);
    expect(open).toContain('aria-label="Switch project, current: clay-and-kiln"');
    expect(open).toMatch(/>clay-and-kiln<\/span>/);
    const none = render(undefined);
    expect(none).toContain('aria-label="Switch project"');
    expect(none).toMatch(/>Projects<\/span>/);
  });
});
