// @vitest-environment happy-dom
/**
 * The "newer version" notice in a DOM (story 13.7): the banner shows the
 * server's notice with the command for the install method, dismissing hides
 * that version in this browser only until a newer one, and Settings, About
 * shows the version and channel, Check now's answer and the switch. The
 * server's calls are replaced: the browser never reaches npm.
 */
import type { UpdateNoticeResponse } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_DISMISSED_KEY, readDismissed, sourcesLabel, updateCommand, updateSteps, writeDismissed } from '../src/updates/update-model';

const state = vi.hoisted(() => ({
  notice: undefined as unknown as UpdateNoticeResponse,
  checkOutcome: 'current' as string,
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
}));

vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ events: [], caughtUp: true }) }));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/api/http', () => ({
  call: async (_auth: unknown, path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    state.calls.push({ path, method, ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) });
    if (method === 'PUT') state.notice = { ...state.notice, enabled: (JSON.parse(String(init.body)) as { enabled: boolean }).enabled };
    if (method === 'POST') {
      if (state.checkOutcome === 'failed') return { outcome: 'failed', notice: state.notice };
      state.notice = { ...state.notice, lastCheckedAt: '2026-10-04T12:00:00.000Z' };
      return { outcome: state.checkOutcome, notice: state.notice };
    }
    return state.notice;
  },
}));

const { UpdateBanner } = await import('../src/shell/update-banner');
const { AboutPage } = await import('../src/routes/about-page');

const base: UpdateNoticeResponse = { current: '0.4.0', channel: 'stable', installMethod: 'npx', enabled: true, offline: false, sources: ['github-releases', 'npm'], lastCheckedAt: null, available: null, shell: null, appChannel: null, app: null };
const wrap = (node: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  state.notice = { ...base };
  state.checkOutcome = 'current';
  state.calls = [];
  localStorage.clear();
});
afterEach(cleanup);

describe('the update banner', () => {
  it('shows nothing when there is no newer version', async () => {
    render(wrap(<UpdateBanner />));
    await settle();
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });

  it('says which version, how to update for npx, and is a polite status', async () => {
    state.notice = { ...base, available: { version: '0.5.0', tag: 'latest', source: 'npm' } };
    render(wrap(<UpdateBanner />));
    const banner = await screen.findByTestId('update-banner');
    expect(screen.getByTestId('update-status').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('update-status').contains(banner)).toBe(true);
    expect(banner.textContent).toBe('Ogden 0.5.0 is available. To update, run npx ogden-agents@latest in a terminal.Dismiss');
    expect(banner.textContent).not.toMatch(/[–—]|\s-\s/);
  });

  it('shows the global install command, never running it', async () => {
    state.notice = { ...base, installMethod: 'global', available: { version: '0.5.0-rc.2', tag: 'next', source: 'npm' } };
    render(wrap(<UpdateBanner />));
    expect((await screen.findByTestId('update-banner')).textContent).toContain('npm install -g ogden-agents@next');
    expect(state.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('Dismiss hides that version after a reload, and a newer version shows it again', async () => {
    state.notice = { ...base, available: { version: '0.5.0', tag: 'latest', source: 'npm' } };
    const first = render(wrap(<UpdateBanner />));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss the notice about Ogden 0.5.0' }));
    expect(screen.queryByTestId('update-banner')).toBeNull();
    expect(readDismissed()).toEqual(['0.5.0']);
    first.unmount();
    render(wrap(<UpdateBanner />));
    await settle();
    expect(screen.queryByTestId('update-banner')).toBeNull();
    cleanup();
    state.notice = { ...base, available: { version: '0.5.1', tag: 'latest', source: 'npm' } };
    render(wrap(<UpdateBanner />));
    expect((await screen.findByTestId('update-banner')).textContent).toContain('Ogden 0.5.1 is available.');
  });

  it('still works when storage is unavailable', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      state.notice = { ...base, available: { version: '0.5.0', tag: 'latest', source: 'npm' } };
      render(wrap(<UpdateBanner />));
      fireEvent.click(await screen.findByRole('button', { name: /Dismiss/ }));
      expect(screen.queryByTestId('update-banner')).toBeNull();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('an update found on GitHub Releases', () => {
  it('tells a GitHub install to start Ogden again, with no command', async () => {
    state.notice = { ...base, installMethod: 'github', sources: ['github-releases'], available: { version: '0.5.0', tag: 'latest', source: 'github-releases' } };
    render(wrap(<UpdateBanner />));
    const banner = await screen.findByTestId('update-banner');
    expect(banner.textContent).toBe('Ogden 0.5.0 is available. To update, start Ogden again with its start script. It updates itself.Dismiss');
  });

  it('points any other install at the releases page', async () => {
    state.notice = { ...base, installMethod: 'npx', available: { version: '0.5.0', tag: 'latest', source: 'github-releases' } };
    render(wrap(<UpdateBanner />));
    expect((await screen.findByTestId('update-banner')).textContent).toBe('Ogden 0.5.0 is available. To update, see github.com/hsmith-dev/ogden-agents/releases.Dismiss');
  });

  it('chooses the words by where the update was found', () => {
    expect(updateSteps({ installMethod: 'npx' }, { version: '1.0.0', tag: 'latest', source: 'npm' })).toEqual({ lead: 'To update, run', code: 'npx ogden-agents@latest', tail: 'in a terminal.' });
    expect(updateSteps({ installMethod: 'github' }, { version: '1.0.0', tag: 'latest', source: 'github-releases' }).code).toBeNull();
    expect(sourcesLabel(['github-releases'])).toBe('GitHub Releases');
    expect(sourcesLabel(['github-releases', 'npm'])).toBe('GitHub Releases and npm');
  });
});

describe('the update model', () => {
  it('chooses the command by install method and tag', () => {
    expect(updateCommand({ installMethod: 'npx' }, { version: '1.0.0', tag: 'latest', source: 'npm' })).toBe('npx ogden-agents@latest');
    expect(updateCommand({ installMethod: 'other' }, { version: '1.0.0-rc.1', tag: 'next', source: 'npm' })).toBe('npx ogden-agents@next');
    expect(updateCommand({ installMethod: 'global' }, { version: '1.0.0', tag: 'latest', source: 'npm' })).toBe('npm install -g ogden-agents@latest');
  });

  it('keeps the latest dismissed versions and reads damaged storage as none', () => {
    for (let i = 0; i < 25; i++) writeDismissed(`1.0.${i}`);
    expect(readDismissed()).toHaveLength(20);
    expect(readDismissed().at(-1)).toBe('1.0.24');
    localStorage.setItem(UPDATE_DISMISSED_KEY, '{nope');
    expect(readDismissed()).toEqual([]);
  });
});

describe('Settings, About', () => {
  it('shows the version, the channel and when it last checked', async () => {
    state.notice = { ...base, current: '0.5.0-rc.1', channel: 'preview', lastCheckedAt: '2026-10-04T12:00:00.000Z' };
    render(wrap(<AboutPage />));
    expect((await screen.findByTestId('about-version')).textContent).toBe('0.5.0-rc.1');
    expect(screen.getByTestId('about-channel').textContent).toBe('Preview');
    expect(screen.getByTestId('about-last-checked').textContent).not.toBe('Not yet');
  });

  it('shows which sources it checks', async () => {
    render(wrap(<AboutPage />));
    expect((await screen.findByTestId('about-sources')).textContent).toBe('GitHub Releases and npm');
    cleanup();
    state.notice = { ...base, installMethod: 'github', sources: ['github-releases'] };
    render(wrap(<AboutPage />));
    expect((await screen.findByTestId('about-sources')).textContent).toBe('GitHub Releases');
    cleanup();
    state.notice = { ...base, offline: true };
    render(wrap(<AboutPage />));
    expect((await screen.findByTestId('about-sources')).textContent).toBe('Nothing (Ogden is set to stay offline)');
  });

  it('Check now announces the answer politely, and a newer version shows its command', async () => {
    render(wrap(<AboutPage />));
    await screen.findByTestId('check-now');
    expect(screen.getByTestId('about-last-checked').textContent).toBe('Not yet');
    fireEvent.click(screen.getByTestId('check-now'));
    await settle();
    expect(screen.getByTestId('check-result').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('check-result').textContent).toBe('You have the newest version.');
    expect(state.calls.at(-1)).toMatchObject({ method: 'POST' });

    state.checkOutcome = 'newer';
    state.notice = { ...state.notice, available: { version: '0.5.0', tag: 'latest', source: 'npm' } };
    fireEvent.click(screen.getByTestId('check-now'));
    await settle();
    expect(screen.getByTestId('check-result').textContent).toBe('Ogden 0.5.0 is available.');
    expect(screen.getByTestId('about-available').textContent).toContain('npx ogden-agents@latest');
  });

  it('says plainly when the sources could not be reached', async () => {
    state.checkOutcome = 'failed';
    render(wrap(<AboutPage />));
    await screen.findByTestId('check-now');
    fireEvent.click(screen.getByTestId('check-now'));
    await settle();
    expect(screen.getByTestId('check-result').textContent).toBe('Ogden could not reach GitHub Releases and npm. Try again later.');
  });

  it('has the switch on by default and saves a change to the server', async () => {
    render(wrap(<AboutPage />));
    const toggle = await screen.findByRole('switch', { name: 'Check for new versions when Ogden starts' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await settle();
    expect(state.calls.at(-1)).toMatchObject({ method: 'PUT', body: { enabled: false } });
    expect(screen.getByRole('switch', { name: 'Check for new versions when Ogden starts' }).getAttribute('aria-checked')).toBe('false');
  });

  it('explains what is sent, and says when offline mode is on', async () => {
    state.notice = { ...base, offline: true };
    render(wrap(<AboutPage />));
    expect((await screen.findByText(/OGDEN_AGENTS_OFFLINE is set/)).textContent).toContain('does not check');
    cleanup();
    state.notice = { ...base };
    render(wrap(<AboutPage />));
    expect((await screen.findByText(/Nothing about you or your projects is sent/)).textContent).toContain('GitHub Releases and npm for the newest published version');
  });
});
