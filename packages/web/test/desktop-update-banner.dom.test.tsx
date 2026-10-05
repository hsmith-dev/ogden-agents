// @vitest-environment happy-dom
/**
 * The desktop app's update in the banner and Settings, About (story 13.3): each source renders
 * (npm, and the app's downloading, ready, busy and requested states), Restart is disabled with the
 * reason while agents work, "Restart when they finish" waits, the page only asks the server (never
 * Tauri), and the app's wording has no dashes and never says terminal or npx. The server's calls
 * are replaced.
 */
import type { UpdateNoticeResponse } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  notice: undefined as unknown as UpdateNoticeResponse,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }) }));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/api/http', () => ({
  call: async (_auth: unknown, path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    state.calls.push({ path, method, ...(body === undefined ? {} : { body }) });
    if (path.endsWith('/updates/app/restart')) return { requested: true, blocked: false, busy: 0 };
    if (path.endsWith('/updates/app/channel')) return { channel: (body as { channel: string }).channel };
    return state.notice;
  },
}));

const { UpdateBanner } = await import('../src/shell/update-banner');
const { AboutPage } = await import('../src/routes/about-page');

const update = { version: '0.6.0', notes: 'Faster starts.', channel: 'stable' as const, downloaded: true };
const base: UpdateNoticeResponse = { current: '0.5.0', channel: 'stable', installMethod: 'other', enabled: true, offline: false, sources: ['github-releases', 'npm'], lastCheckedAt: null, available: null, shell: 'desktop', appChannel: 'stable', app: null };
const withApp = (app: Partial<NonNullable<UpdateNoticeResponse['app']>>): UpdateNoticeResponse => ({
  ...base,
  app: { update, blocked: false, busy: 0, restartRequested: false, ...app },
});
const wrap = (node: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  state.notice = { ...base };
  state.calls = [];
  localStorage.clear();
});
afterEach(cleanup);

describe('the app update banner', () => {
  it('shows nothing without an update', async () => {
    render(wrap(<UpdateBanner />));
    await settle();
    expect(screen.queryByTestId('app-update-banner')).toBeNull();
  });

  it('says it is downloading, with no Restart yet', async () => {
    state.notice = withApp({ update: { ...update, downloaded: false } });
    render(wrap(<UpdateBanner />));
    const banner = await screen.findByTestId('app-update-banner');
    expect(banner.textContent).toBe('Ogden 0.6.0 is downloading.');
    expect(screen.queryByRole('button', { name: 'Restart to update' })).toBeNull();
  });

  it('offers Restart to update when ready and idle, and asks the server only', async () => {
    state.notice = withApp({});
    render(wrap(<UpdateBanner />));
    const banner = await screen.findByTestId('app-update-banner');
    expect(banner.textContent).toContain('Update available. Ogden 0.6.0 is ready. Restart to update.');
    expect(screen.queryByRole('button', { name: 'Restart when they finish' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await settle();
    expect(state.calls.filter((call) => call.method === 'POST')).toEqual([{ path: '/api/v1/updates/app/restart', method: 'POST', body: { whenIdle: false } }]);
  });

  it('disables Restart with the reason while agents work, and offers to wait', async () => {
    state.notice = withApp({ blocked: true, busy: 2 });
    render(wrap(<UpdateBanner />));
    const banner = await screen.findByTestId('app-update-banner');
    expect(banner.textContent).toContain('agents are still working, so it cannot restart yet');
    expect((screen.getByRole('button', { name: 'Restart to update' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restart when they finish' }));
    await settle();
    expect(state.calls.some((call) => call.method === 'POST' && JSON.stringify(call.body) === '{"whenIdle":true}')).toBe(true);
  });

  it('says when the restart is waiting for agents, and when it is installing', async () => {
    state.notice = withApp({ blocked: true, busy: 1, restartRequested: true });
    render(wrap(<UpdateBanner />));
    expect((await screen.findByTestId('app-update-banner')).textContent).toBe('Ogden 0.6.0 will install when your agents finish, then Ogden restarts.');
    cleanup();
    state.notice = withApp({ restartRequested: true });
    render(wrap(<UpdateBanner />));
    expect((await screen.findByTestId('app-update-banner')).textContent).toBe('Ogden 0.6.0 is installing. Ogden restarts in a moment.');
  });

  it('uses plain words: no dashes, no terminal, no npx', async () => {
    for (const app of [{ update: { ...update, downloaded: false } }, {}, { blocked: true, busy: 1 }, { restartRequested: true }]) {
      state.notice = withApp(app);
      const view = render(wrap(<UpdateBanner />));
      const text = (await screen.findByTestId('app-update-banner')).textContent ?? '';
      expect(text).not.toMatch(/[–—]|\s-\s/);
      expect(text).not.toMatch(/terminal|npx/i);
      view.unmount();
    }
  });

  it('keeps the npm notice for npm installs', async () => {
    state.notice = { ...base, shell: null, appChannel: null, available: { version: '0.6.0', tag: 'latest', source: 'npm' } };
    render(wrap(<UpdateBanner />));
    expect((await screen.findByTestId('update-banner')).textContent).toContain('Ogden 0.6.0 is available.');
    expect(screen.queryByTestId('app-update-banner')).toBeNull();
  });
});

describe('Settings, About inside the app', () => {
  it('shows the update channel instead of the npm check, and saves a change through the server', async () => {
    render(wrap(<AboutPage />));
    expect(await screen.findByRole('group', { name: 'Update channel' })).toBeTruthy();
    expect(screen.queryByTestId('check-now')).toBeNull();
    expect(screen.queryByTestId('check-updates-on-start')).toBeNull();
    expect(screen.getByRole('button', { name: 'Stable' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await settle();
    expect(state.calls.some((call) => call.method === 'PUT' && call.path === '/api/v1/updates/app/channel' && JSON.stringify(call.body) === '{"channel":"next"}')).toBe(true);
  });

  it('keeps the npm rows for npm installs', async () => {
    state.notice = { ...base, shell: null, appChannel: null };
    render(wrap(<AboutPage />));
    expect(await screen.findByTestId('check-now')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Update channel' })).toBeNull();
  });
});
