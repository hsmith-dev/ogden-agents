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

/** One chat in a workspace (story 2.2): the session view, `/w/:wsId/s/:sesId`. */
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$wsId/s/$sesId',
  component: lazyRouteComponent(() => import('./routes/session-page'), 'SessionPage'),
});

const routeTree = rootRoute.addChildren([homeRoute, sessionRoute, settingsRoute.addChildren([appearanceRoute, toolsRoute])]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
