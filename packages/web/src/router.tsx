import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AppearancePage } from './routes/appearance-page';
import { HomePage } from './routes/home-page';
import { NotFoundPage } from './routes/not-found-page';
import { ToolsPage } from './routes/tools-page';
import { AppShell } from './shell/app-shell';

/*
 * Code-based routes (EXPERIENCE.md Information Architecture). The launch page
 * is not a route: without a session the server's gate answers instead, since
 * the app's assets are gated (story 1.4).
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

const appearanceRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/appearance', component: AppearancePage });

const toolsRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/tools', component: ToolsPage });

const routeTree = rootRoute.addChildren([homeRoute, settingsRoute.addChildren([appearanceRoute, toolsRoute])]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
