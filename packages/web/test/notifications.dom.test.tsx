// @vitest-environment happy-dom
/**
 * Settings, Notifications and the shell's notifier in a DOM (backlog story 8),
 * with the browser's Notification, AudioContext and Web Locks replaced: the
 * permission is asked only from the switch, a refusal or a browser without
 * notifications leaves one plain sentence, settings follow other tabs, and a
 * clicked notification focuses the tab on the need's chat.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChimeForTests } from '../src/notifications/chime';
import { NOTIFICATION_SETTINGS_KEY } from '../src/notifications/notification-settings';
import type { NeedsYouEntry } from '../src/shell/sidebar-model';

const state = vi.hoisted(() => ({
  needs: [] as unknown[],
  caughtUp: true,
  navigate: [] as unknown[],
}));

vi.mock('@/shell/sidebar-data', () => ({ useSidebarData: () => ({ model: { groups: [{ wsId: 'ws_a', rows: [{ sesId: 'ses_a' }], earlier: [] }], needsYou: state.needs } }) }));
vi.mock('@/events/event-stream', () => ({ useEventStream: () => ({ caughtUp: state.caughtUp }) }));
vi.mock('@/shell/workspace-header', () => ({ WorkspaceHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const router = { navigate: async (to: unknown) => void state.navigate.push(to) };
  return { ...(await importOriginal<object>()), useRouter: () => router };
});

const { NotificationsPage } = await import('../src/routes/notifications-page');
const { AttentionNotifier } = await import('../src/notifications/attention-notifier');

/** A fake Notification class recording what was shown and asked. */
function fakeNotification(permission: NotificationPermission, answer: NotificationPermission = permission) {
  const shown: { title: string; options: NotificationOptions; instance: { onclick: (() => void) | null; close: () => void; closed: boolean } }[] = [];
  const requests: number[] = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      requests.push(1);
      FakeNotification.permission = answer;
      return answer;
    });
    onclick: (() => void) | null = null;
    closed = false;
    constructor(title: string, options: NotificationOptions) {
      shown.push({ title, options, instance: this });
    }
    close() {
      this.closed = true;
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return { shown, requests, FakeNotification };
}

const audio = () => {
  const played: number[] = [];
  class FakeContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      played.push(1);
      return { frequency: { setValueAtTime: () => undefined }, connect: (n: unknown) => n, start: () => undefined, stop: () => undefined };
    }
    createGain() {
      return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: (n: unknown) => n };
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  return played;
};

const need = (id: string): NeedsYouEntry => ({
  id,
  kind: 'permission',
  wsId: 'ws_a',
  sesId: 'ses_a',
  workspaceName: 'Letterpress',
  chatTitle: 'Refunds',
  text: 'Claude Code wants to run cat /Users/sam/.ssh/id_rsa',
  agentName: 'Claude Code',
  at: '2026-10-04T10:00:00.000Z',
  request: 'run cat /Users/sam/.ssh/id_rsa',
});

const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  window.localStorage.clear();
  state.needs = [];
  state.caughtUp = true;
  state.navigate = [];
  // No Web Locks here: this one tab speaks.
  vi.stubGlobal('navigator', { ...navigator, locks: undefined });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetChimeForTests();
});

describe('Settings, Notifications', () => {
  it('asks the browser only when the switch is pressed, and turns on once allowed', async () => {
    const { requests } = fakeNotification('default', 'granted');
    render(<NotificationsPage />);
    const desktop = screen.getByRole('switch', { name: 'Desktop notifications' });
    expect(requests).toEqual([]);
    expect(desktop.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(desktop);
    // Keyboard focus stays on the switch while the browser asks.
    expect(desktop.hasAttribute('disabled')).toBe(false);
    await settle();
    expect(requests).toHaveLength(1);
    expect(desktop.getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(window.localStorage.getItem(NOTIFICATION_SETTINGS_KEY)!)).toMatchObject({ desktop: true });
  });

  it('a refusal leaves the switch off with one plain sentence, and the sound still works', async () => {
    fakeNotification('default', 'denied');
    const played = audio();
    render(<NotificationsPage />);
    fireEvent.click(screen.getByRole('switch', { name: 'Desktop notifications' }));
    await settle();
    expect(screen.getByRole('switch', { name: 'Desktop notifications' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('desktop-notifications-blocked').textContent).toMatch(/blocking notifications/);
    // Said in a live region that was already there, and named by the switch.
    expect(screen.getByRole('status').contains(screen.getByTestId('desktop-notifications-blocked'))).toBe(true);
    expect(screen.getByRole('switch', { name: 'Desktop notifications' }).getAttribute('aria-describedby')).toContain('desktop-notifications-blocked');
    fireEvent.click(screen.getByRole('button', { name: 'Test sound' }));
    expect(played.length).toBeGreaterThan(0);
  });

  it('a browser without notifications: the switch is disabled and says why', () => {
    vi.stubGlobal('Notification', undefined);
    render(<NotificationsPage />);
    expect(screen.getByRole('switch', { name: 'Desktop notifications' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('desktop-notifications-blocked').textContent).toMatch(/can't show notifications/);
  });

  it('sound off disables Test sound; every kind and "only when away" are on by default', () => {
    fakeNotification('default');
    render(<NotificationsPage />);
    for (const name of ['Approval needed', 'Waiting for your answer', 'Agent is quiet', 'Sign in needed']) expect(screen.getByRole('checkbox', { name }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: "Only when Ogden Agents isn't in front" }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Sound' }));
    expect(screen.getByRole('button', { name: 'Test sound' }).hasAttribute('disabled')).toBe(true);
  });

  it('follows a change made in another tab', async () => {
    fakeNotification('default');
    render(<NotificationsPage />);
    const value = JSON.stringify({ sound: false });
    window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, value);
    await act(async () => void window.dispatchEvent(new StorageEvent('storage', { key: NOTIFICATION_SETTINGS_KEY, newValue: value })));
    expect(screen.getByRole('switch', { name: 'Sound' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('AttentionNotifier', () => {
  it('a new need while away shows one safe notification with the chime; clicking it opens the chat', async () => {
    const { shown } = fakeNotification('granted');
    const played = audio();
    window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify({ desktop: true }));
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    state.needs = [need('old')];
    const { rerender } = render(<AttentionNotifier />);
    await settle();
    expect(shown).toEqual([]);
    state.needs = [need('old'), need('req_new')];
    rerender(<AttentionNotifier />);
    rerender(<AttentionNotifier />);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Approval needed', options: { body: 'Letterpress: Refunds', tag: 'req_new' } });
    expect(JSON.stringify(shown[0]!.options)).not.toMatch(/ssh|id_rsa|cat/);
    expect(played.length).toBeGreaterThan(0);
    shown[0]!.instance.onclick!();
    expect(focus).toHaveBeenCalled();
    expect(state.navigate).toEqual([{ to: '/w/$wsId/s/$sesId', params: { wsId: 'ws_a', sesId: 'ses_a' } }]);
    expect(shown[0]!.instance.closed).toBe(true);
  });

  it('stays quiet while this Ogden tab is in front', async () => {
    const { shown } = fakeNotification('granted');
    const played = audio();
    window.localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify({ desktop: true }));
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { rerender } = render(<AttentionNotifier />);
    await settle();
    state.needs = [need('req_new')];
    rerender(<AttentionNotifier />);
    expect(shown).toEqual([]);
    expect(played).toEqual([]);
  });
});
