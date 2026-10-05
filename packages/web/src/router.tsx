import { createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { HomePage } from './routes/home-page';
import { NotFoundPage } from './routes/not-found-page';
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

const agentsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/agents',
  component: lazyRouteComponent(() => import('./routes/agents-settings-page'), 'AgentsSettingsPage'),
});

/** Desktop notifications and the sound for when a chat needs you (backlog story 8). */
const notificationsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/notifications',
  component: lazyRouteComponent(() => import('./routes/notifications-page'), 'NotificationsPage'),
});

/** The version, its channel and the check for newer ones (story 13.7). */
const aboutRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/about',
  component: lazyRouteComponent(() => import('./routes/about-page'), 'AboutPage'),
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
  workspaceSettingsRoute,
  workspacePlanRoute,
  workspaceBoardRoute.addChildren([workspaceBoardTicketRoute]),
  sessionRoute,
  settingsRoute.addChildren([appearanceRoute, toolsRoute, agentsSettingsRoute, newProjectsRoute, notificationsRoute, aboutRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
