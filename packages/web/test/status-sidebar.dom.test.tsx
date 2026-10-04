// @vitest-environment happy-dom
/**
 * The sidebar is the one place for projects (backlog story 2): no drop-down
 * in its header; each project's name opens it and is marked when the user is
 * inside it; a chevron collapses it without opening it; a gear opens its
 * settings; Add project stays; from eight projects a labelled filter narrows
 * the list by name (Escape clears it) and never touches Needs you. The
 * sidebar data, the router and the footer's own controls are stand-ins.
 */
import type { Workspace, WorkspaceId } from '@ogden-agents/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SidebarModel, SidebarWorkspace } from '../src/shell/sidebar-model';

const fake = vi.hoisted(() => ({
  /** The `wsId` route param: the project the user is inside. */
  wsId: undefined as string | undefined,
  model: { groups: [], needsYou: [] } as SidebarModel,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ wsId: fake.wsId }),
  Link: ({ children, to, params, activeOptions: _activeOptions, ...props }: { children?: ReactNode; to: string; params?: Record<string, string>; activeOptions?: unknown }) => (
    <a href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../src/shell/sidebar-data', () => ({
  useSidebarData: () => ({ model: fake.model, sessions: [], loading: false, unloaded: new Set(), now: Date.parse('2026-10-04T12:00:00.000Z') }),
}));
vi.mock('@/workspaces/add-project-dialog', () => ({ AddProjectDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Add project" /> : null) }));
vi.mock('../src/shell/new-tab-button', () => ({ NewTabButton: () => null }));
vi.mock('../src/shell/quit-button', () => ({ QuitButton: () => null }));
vi.mock('../src/shell/server-status', () => ({ ServerStatus: () => null }));

const { StatusSidebar, COLLAPSED_KEY } = await import('../src/shell/status-sidebar');
const { SidebarProvider } = await import('../src/ui/sidebar');
const { TooltipProvider } = await import('../src/ui/tooltip');
const { filterProjects, PROJECT_FILTER_MIN, showsProjectFilter } = await import('../src/shell/project-filter');
const { workspaceName } = await import('../src/workspaces/workspace-api');

const group = (n: number, name: string): SidebarWorkspace => ({ wsId: `ws_${n}`, name, rows: [], earlier: [], summary: [] });
const NAMES = ['clay-and-kiln', 'Letterpress', 'apps', 'ledger-api', 'rota', 'newsletter', 'garden', 'kiln-notes', 'zines'];

function mount(groups: readonly SidebarWorkspace[], wsId?: string) {
  fake.model = {
    groups: [...groups],
    needsYou: [{ id: 'req_1', wsId: 'ws_0', sesId: 'ses_1', workspaceName: groups[0]?.name ?? 'x', text: 'Claude Code wants to run npm test', agentName: 'Claude Code', at: '2026-10-04T11:59:00.000Z', request: 'run npm test' }],
  };
  fake.wsId = wsId;
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <StatusSidebar />
      </SidebarProvider>
    </TooltipProvider>,
  );
}

const sidebar = () => screen.getByRole('complementary', { name: 'Projects and sessions' });
const projectNames = () => within(sidebar()).queryAllByTestId('workspace-link').map((link) => link.textContent);

afterEach(() => {
  cleanup();
  fake.wsId = undefined;
  try {
    window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // No storage: nothing kept.
  }
});

describe('project filter (pure)', () => {
  it('shows from eight projects up', () => {
    expect(PROJECT_FILTER_MIN).toBe(8);
    expect(showsProjectFilter(7)).toBe(false);
    expect(showsProjectFilter(8)).toBe(true);
  });

  it('keeps names containing the text, ignoring case and surrounding spaces; empty keeps all', () => {
    const all = NAMES.map((name, n) => group(n, name));
    expect(filterProjects(all, '  KILN ').map((g) => g.name)).toEqual(['clay-and-kiln', 'kiln-notes']);
    expect(filterProjects(all, '')).toBe(all);
    expect(filterProjects(all, 'nothing-like-it')).toEqual([]);
  });

  it('names a workspace by the last segment of its real path, on / or \\', () => {
    const ws = (realPath: string): Workspace => ({ id: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2A1' as WorkspaceId, path: realPath.toLowerCase(), realPath, createdAt: '2026-09-30T00:00:00.000Z' });
    expect(workspaceName(ws('/Users/sam/clay-and-kiln'))).toBe('clay-and-kiln');
    expect(workspaceName(ws('C:\\Users\\sam\\Letterpress'))).toBe('Letterpress');
    expect(workspaceName(ws('/Users/sam/apps/'))).toBe('apps');
  });
});

describe('the sidebar is the one place for projects (backlog story 2)', () => {
  it('has no project drop-down: the header shows the wordmark only', () => {
    mount([group(0, 'clay-and-kiln'), group(1, 'Letterpress')]);
    expect(screen.queryByTestId('workspace-switcher')).toBeNull();
    expect(within(sidebar()).queryByRole('button', { name: /Switch project/ })).toBeNull();
    const header = sidebar().querySelector('[data-slot="sidebar-header"]')!;
    expect(header.querySelectorAll('button')).toHaveLength(0);
    // The wordmark, a link home, is the header's only control.
    expect([...header.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/']);
  });

  it('each project opens from its name, empty ones too, and reaches its settings', () => {
    mount([group(0, 'clay-and-kiln'), group(1, 'Letterpress')]);
    const kiln = within(sidebar()).getByRole('group', { name: 'clay-and-kiln' });
    expect(within(kiln).getByRole('link', { name: 'clay-and-kiln' })).toHaveProperty('pathname', '/w/ws_0');
    expect(within(kiln).getByRole('link', { name: 'clay-and-kiln settings' })).toHaveProperty('pathname', '/w/ws_0/settings');
    expect(within(sidebar()).getByRole('button', { name: 'Add project' })).toBeTruthy();
  });

  it('marks the project the user is inside, and no other', () => {
    mount([group(0, 'clay-and-kiln'), group(1, 'Letterpress')], 'ws_1');
    const marked = within(sidebar())
      .getAllByTestId('workspace-link')
      .filter((link) => link.getAttribute('aria-current') !== null);
    expect(marked.map((link) => link.textContent)).toEqual(['Letterpress']);
  });

  it('the chevron collapses the group without opening it, and says so', () => {
    mount([group(0, 'clay-and-kiln')]);
    const toggle = within(sidebar()).getByRole('button', { name: 'Chats in clay-and-kiln' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('["ws_0"]');
    expect(toggle.closest('a')).toBeNull();
  });

  it('has no filter below eight projects', () => {
    mount(NAMES.slice(0, PROJECT_FILTER_MIN - 1).map((name, n) => group(n, name)));
    expect(within(sidebar()).queryByLabelText('Filter projects')).toBeNull();
    expect(projectNames()).toHaveLength(PROJECT_FILTER_MIN - 1);
  });

  it('from eight projects, a labelled filter narrows the list; none matching says so; Escape clears; Needs you stays', () => {
    mount(NAMES.map((name, n) => group(n, name)));
    const field = within(sidebar()).getByLabelText('Filter projects');
    fireEvent.change(field, { target: { value: 'Kiln' } });
    expect(projectNames()).toEqual(['clay-and-kiln', 'kiln-notes']);
    expect(within(sidebar()).getByTestId('needs-you-item')).toBeTruthy();

    fireEvent.change(field, { target: { value: 'qqq' } });
    expect(projectNames()).toEqual([]);
    expect(within(sidebar()).getByTestId('no-project-matches').textContent).toBe('No projects match');
    expect(within(sidebar()).getByRole('button', { name: 'Add project' })).toBeTruthy();

    fireEvent.keyDown(field, { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('');
    expect(projectNames()).toHaveLength(NAMES.length);
  });
});
