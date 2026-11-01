import { createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { ChangesView, SessionId, TurnId, WORKSPACE_SEARCH_MAX_QUERY, WorkspaceSearchMode } from '@ogden-agents/shared';
import { newChatSearch, type NewChatSearch } from './chat/new-chat';
import { HomePage } from './routes/home-page';
import { NotFoundPage } from './routes/not-found-page';
import { SettingsLayout } from './settings/settings-layout';
import { AppShell } from './shell/app-shell';

/*
 * Code-based routes (EXPERIENCE.md Information Architecture). The launch page
 * is not a route: on any URL, a tab without a valid token shows the shell's
 * launch state (AppShell, story 2.1), so a bookmark keeps its path.
 *
 * The first load carries only the shell and home; every other page is its own
 * chunk, loaded on navigation (or on hover or focus of a link to it, with
 * `defaultPreload: 'intent'`).
 */
const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFoundPage });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  // The grouped settings nav around every settings page (epic 26, E26-R7).
  component: SettingsLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, '') === '/settings') throw redirect({ to: '/settings/appearance' });
  },
});

const appearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/appearance',
  component: lazyRouteComponent(() => import('./routes/appearance-page'), 'AppearancePage'),
});

const toolsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/tools',
  component: lazyRouteComponent(() => import('./routes/tools-page'), 'ToolsPage'),
});


const mcpSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/mcp',
  component: lazyRouteComponent(() => import('./routes/mcp-settings-page'), 'McpSettingsPage'),
});

const agentsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/agents',
  component: lazyRouteComponent(() => import('./routes/agents-settings-page'), 'AgentsSettingsPage'),
});

/** Add your own agent (story 21.3): the agents page with the form already open. */
const newCustomAgentRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/agents/new',
  component: lazyRouteComponent(() => import('./routes/agents-settings-page'), 'NewCustomAgentPage'),
});

/** How many builds run at once, and the time limit of one (story 5.8). */
const buildsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/builds',
  component: lazyRouteComponent(() => import('./routes/builds-settings-page'), 'BuildsSettingsPage'),
});

/** Generic developer CLI tools: detect, confirmed install, and each project's unattended-build allowlist (CAP-25). */
const devToolsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/dev-tools',
  component: lazyRouteComponent(() => import('./routes/dev-tools-settings-page'), 'DevToolsSettingsPage'),
});

/** Computers added over SSH for a chat or build to run on instead of here (CAP-24, epic 19 story 19.3). */
const remoteMachinesSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/remote-machines',
  component: lazyRouteComponent(() => import('./routes/remote-machines-settings-page'), 'RemoteMachinesSettingsPage'),
});

/** Desktop notifications and the sound for when a chat needs you (backlog story 8). */
const notificationsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/notifications',
  component: lazyRouteComponent(() => import('./routes/notifications-page'), 'NotificationsPage'),
});

/** Developer mode's Terminals settings (epic 16, story 16.9). */
const terminalsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/terminals',
  component: lazyRouteComponent(() => import('./routes/terminals-settings-page'), 'TerminalsSettingsPage'),
});

/** The version, its channel and the check for newer ones (story 13.7). */
const aboutRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/about',
  component: lazyRouteComponent(() => import('./routes/about-page'), 'AboutPage'),
});

/** Every project's Always allow rules, each with Remove (epic 26 story 8, AD-40). */
const alwaysAllowSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/always-allow',
  component: lazyRouteComponent(() => import('./routes/always-allow-settings-page'), 'AlwaysAllowSettingsPage'),
});

/** The app-wide default for new projects (story 10.4). */
const newProjectsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/new-projects',
  component: lazyRouteComponent(() => import('./routes/new-projects-page'), 'NewProjectsPage'),
});

/** The first-run Welcome (onboarding 9.5). */
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  component: lazyRouteComponent(() => import('./routes/welcome-page'), 'WelcomePage'),
});

/** A workspace's Chats list (story 2.5), `/w/:wsId`. */
const workspaceChatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId',
  component: lazyRouteComponent(() => import('./routes/workspace-chats-page'), 'WorkspaceChatsPage'),
});

/** A project's new-chat draft (epic 26, E26-R2), `/w/:wsId/new`: `?agent=` and `?machine=` are the picks it opens with. */
const workspaceNewChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/new',
  validateSearch: (search: Record<string, unknown>): NewChatSearch => newChatSearch(search),
  component: lazyRouteComponent(() => import('./routes/new-chat-page'), 'NewChatPage'),
});

/** A workspace's settings (stories 2.5 and 2.8), `/w/:wsId/settings`. */
const workspaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/settings',
  component: lazyRouteComponent(() => import('./routes/workspace-settings-page'), 'WorkspaceSettingsPage'),
});

/** A project's Plan page (story 4.1): its installed skills, each started as a planning session. */
const workspacePlanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/plan',
  component: lazyRouteComponent(() => import('./routes/workspace-plan-page'), 'WorkspacePlanPage'),
});

/** A project's Board page (story 4.1): its tickets. */
const workspaceBoardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/board',
  component: lazyRouteComponent(() => import('./routes/workspace-board-page'), 'WorkspaceBoardPage'),
});

/** A ticket's detail sheet over the Board (story 4.9), `/w/:wsId/board/:ref`. */
const workspaceBoardTicketRoute = createRoute({
  getParentRoute: () => workspaceBoardRoute,
  path: '$ref',
  component: lazyRouteComponent(() => import('./routes/workspace-board-ticket'), 'WorkspaceBoardTicket'),
});

/** A project's Runs page (story 11.1): every build run and the queue. */
const workspaceRunsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/runs',
  component: lazyRouteComponent(() => import('./routes/workspace-runs-page'), 'WorkspaceRunsPage'),
});

/** A project's Orchestrate page (epic 15, 15.3): a goal, the manager's plan, the user's approval of each instruction. Only with the Orchestration piece on. */
const workspaceOrchestrateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/orchestrate',
  component: lazyRouteComponent(() => import('./routes/workspace-orchestrate-page'), 'WorkspaceOrchestratePage'),
});

/** A project's Terminals page (epic 16, story 16.2): its terminal panes, in Developer mode. */
const workspaceTerminalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/terminals',
  component: lazyRouteComponent(() => import('./routes/workspace-terminals-page'), 'WorkspaceTerminalsPage'),
});

/**
 * The Workbench's search: `?path=` is the file the Files panel shows (AD-36);
 * `?line=` a `file:line` link's line (8.7), only with a path; `?session=` a
 * chat whose worktree the Files panel shows (8.2's root), and for Changes the
 * chat (This turn, and its worktree's Commit); `?panel=changes` opens Changes
 * (story 8.4) on `?view=`, on the chat's turn `?turn=`; `?panel=search`
 * opens Search (8.8) with its query `?q=` (at most 200 characters) and
 * `?mode=`, `?matchCase=`, `?regex=`.
 */
export interface WorkbenchSearch {
  path?: string;
  line?: number;
  panel?: 'changes' | 'search';
  view?: ChangesView;
  session?: string;
  turn?: string;
  q?: string;
  mode?: WorkspaceSearchMode;
  matchCase?: boolean;
  regex?: boolean;
}

/** The Workbench's search as the router keeps it, keeping only what it understands: a malformed line, view, session or turn is left out. */
export function workbenchSearch(search: Record<string, unknown>): WorkbenchSearch {
  const path = typeof search.path === 'string' && search.path !== '' ? search.path : undefined;
  const line = typeof search.line === 'number' ? search.line : typeof search.line === 'string' && /^\d{1,9}$/.test(search.line) ? Number(search.line) : undefined;
  const view = ChangesView.safeParse(search.view);
  const session = SessionId.safeParse(search.session);
  const turn = TurnId.safeParse(search.turn);
  // The router reads `?q=12` as a number: kept as the text typed.
  const q = typeof search.q === 'string' ? search.q : typeof search.q === 'number' || typeof search.q === 'boolean' ? String(search.q) : undefined;
  const mode = WorkspaceSearchMode.safeParse(search.mode);
  const on = (value: unknown) => value === true || value === 'true';
  return {
    ...(path === undefined ? {} : { path }),
    ...(path !== undefined && line !== undefined && Number.isSafeInteger(line) && line >= 1 ? { line } : {}),
    ...(search.panel === 'changes' ? { panel: 'changes' as const } : search.panel === 'search' ? { panel: 'search' as const } : {}),
    ...(view.success ? { view: view.data } : {}),
    ...(session.success ? { session: session.data } : {}),
    ...(turn.success ? { turn: turn.data } : {}),
    ...(q !== undefined && q !== '' && q.length <= WORKSPACE_SEARCH_MAX_QUERY ? { q } : {}),
    ...(mode.success ? { mode: mode.data } : {}),
    ...(on(search.matchCase) ? { matchCase: true } : {}),
    ...(on(search.regex) ? { regex: true } : {}),
  };
}

/** A project's Workbench (AD-36): its Files panel, the project's tree and one file read-only. */
const workspaceWorkbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/workbench',
  validateSearch: workbenchSearch,
  component: lazyRouteComponent(() => import('./routes/workspace-workbench-page'), 'WorkspaceWorkbenchPage'),
});

/** A ticket's build review (story 5.2, the tracer), `/w/:wsId/review/:ref`. */
const workspaceReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/review/$ref',
  component: lazyRouteComponent(() => import('./routes/workspace-review-page'), 'WorkspaceReviewPage'),
});

/** The session view's search: `?driver=terminal` mirrors who drives the chat (story 3.6); it never switches by itself. */
export interface SessionSearch {
  driver?: 'terminal';
}

/** One chat in a workspace (story 2.2): the session view, `/w/:wsId/s/:sesId`. */
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/s/$sesId',
  validateSearch: (search: Record<string, unknown>): SessionSearch => (search.driver === 'terminal' ? { driver: 'terminal' } : {}),
  component: lazyRouteComponent(() => import('./routes/session-page'), 'SessionPage'),
});

// Story 2.3 registers every route the epic's lanes and onboarding need, so none of them edits this file.
const routeTree = rootRoute.addChildren([
  homeRoute,
  welcomeRoute,
  workspaceChatsRoute,
  workspaceNewChatRoute,
  workspaceSettingsRoute,
  workspacePlanRoute,
  workspaceBoardRoute.addChildren([workspaceBoardTicketRoute]),
  workspaceReviewRoute,
  workspaceRunsRoute,
  workspaceOrchestrateRoute,
  workspaceTerminalsRoute,
  workspaceWorkbenchRoute,
  sessionRoute,
  settingsRoute.addChildren([appearanceRoute, toolsRoute, mcpSettingsRoute, agentsSettingsRoute, newCustomAgentRoute, devToolsSettingsRoute, remoteMachinesSettingsRoute, newProjectsRoute, alwaysAllowSettingsRoute, buildsSettingsRoute, notificationsRoute, terminalsSettingsRoute, aboutRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
