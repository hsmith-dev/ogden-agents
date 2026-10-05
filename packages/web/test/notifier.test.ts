/**
 * The attention notifier's rules (backlog story 8): one notification per new
 * need, never for what was there at catch-up, only from the leader tab, only
 * when Ogden is not in front (by default), only for the kinds turned on, and
 * text that names project, chat and kind only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHIME_NOTES, playChime, resetChimeForTests } from '../src/notifications/chime';
import { DEFAULT_NOTIFICATION_SETTINGS, parseNotificationSettings, type NotificationSettings } from '../src/notifications/notification-settings';
import { createNotifier, notificationText, type NotifierDeps } from '../src/notifications/notifier';
import { createTabPresence, LEADER_LOCK, type PresenceEnv } from '../src/notifications/tab-presence';
import type { NeedKind, NeedsYouEntry } from '../src/shell/sidebar-model';

const need = (id: string, kind: NeedKind = 'permission', extra: Partial<NeedsYouEntry> = {}): NeedsYouEntry => ({
  id,
  kind,
  wsId: 'ws_a',
  sesId: 'ses_a',
  workspaceName: 'Letterpress',
  chatTitle: 'Refunds',
  text: 'Claude Code wants to run export STRIPE_KEY=sk_live_123 && npm test',
  agentName: 'Claude Code',
  at: '2026-10-04T10:00:00.000Z',
  request: 'run export STRIPE_KEY=sk_live_123 && npm test',
  ...extra,
});

const ON: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, desktop: true };

function setup(overrides: Partial<NotifierDeps> = {}) {
  const shown: { id: string; title: string; body: string; closed: boolean }[] = [];
  const chimes: number[] = [];
  const deps: NotifierDeps = {
    isLeader: () => true,
    anyTabFocused: () => false,
    permission: () => 'granted',
    show(entry, text) {
      const record = { id: entry.id, ...text, closed: false };
      shown.push(record);
      return { close: () => (record.closed = true) };
    },
    chime: (volume) => chimes.push(volume),
    ...overrides,
  };
  const notifier = createNotifier(deps);
  return { notifier, shown, chimes };
}

describe('notificationText (privacy)', () => {
  it('names the kind, the project and the chat, never the command, path or what the agent said', () => {
    const text = notificationText(need('req_1', 'permission', { chatTitle: 'Refunds' }));
    expect(text).toEqual({ title: 'Approval needed', body: 'Letterpress: Refunds' });
    expect(JSON.stringify(text)).not.toMatch(/sk_live|STRIPE|npm|Claude Code wants/);
    expect(notificationText(need('x', 'waiting')).title).toBe('Waiting for your answer');
    expect(notificationText(need('x', 'check_in')).title).toBe('Agent is quiet');
    expect(notificationText(need('x', 'sign_in')).title).toBe('Sign in needed');
  });
});

describe('createNotifier', () => {
  it('needs already there when the tab caught up are never notified; a new one is, once', () => {
    const { notifier, shown, chimes } = setup();
    notifier.update([need('old')], ON, false);
    notifier.update([need('old')], ON, true);
    expect(shown).toEqual([]);
    notifier.update([need('old'), need('new')], ON, true);
    notifier.update([need('old'), need('new')], ON, true);
    notifier.update([need('new'), need('old')], { ...ON }, true);
    expect(shown.map((s) => s.id)).toEqual(['new']);
    expect(chimes).toEqual([ON.volume]);
  });

  it('a need that leaves and comes back is not notified again', () => {
    const { notifier, shown } = setup();
    notifier.update([], ON, true);
    notifier.update([need('a')], ON, true);
    notifier.update([], ON, true);
    notifier.update([need('a')], ON, true);
    expect(shown.map((s) => s.id)).toEqual(['a']);
  });

  it('a tab that is not the leader stays silent, and never replays once it leads', () => {
    let leader = false;
    const { notifier, shown, chimes } = setup({ isLeader: () => leader });
    notifier.update([], ON, true);
    notifier.update([need('a')], ON, true);
    expect(shown).toEqual([]);
    expect(chimes).toEqual([]);
    leader = true;
    notifier.update([need('a')], ON, true);
    expect(shown).toEqual([]);
    notifier.update([need('a'), need('b')], ON, true);
    expect(shown.map((s) => s.id)).toEqual(['b']);
  });

  it('only when away: an Ogden tab in front means no notification and no sound; off, both play', () => {
    const { notifier, shown, chimes } = setup({ anyTabFocused: () => true });
    notifier.update([], ON, true);
    notifier.update([need('a')], ON, true);
    expect(shown).toEqual([]);
    expect(chimes).toEqual([]);
    notifier.update([need('a'), need('b')], { ...ON, onlyWhenAway: false }, true);
    expect(shown.map((s) => s.id)).toEqual(['b']);
    expect(chimes).toHaveLength(1);
  });

  it('a kind turned off neither notifies nor plays', () => {
    const { notifier, shown, chimes } = setup();
    const settings = { ...ON, kinds: { ...ON.kinds, check_in: false } };
    notifier.update([], settings, true);
    notifier.update([need('c', 'check_in')], settings, true);
    expect(shown).toEqual([]);
    expect(chimes).toEqual([]);
    notifier.update([need('c', 'check_in'), need('s', 'sign_in')], settings, true);
    expect(shown.map((s) => s.id)).toEqual(['s']);
  });

  it('without the browser permission, or with desktop off, the sound still plays alone; with sound off nothing plays', () => {
    const denied = setup({ permission: () => 'denied' });
    denied.notifier.update([], ON, true);
    denied.notifier.update([need('a')], ON, true);
    expect(denied.shown).toEqual([]);
    expect(denied.chimes).toEqual([ON.volume]);

    const off = setup();
    off.notifier.update([], DEFAULT_NOTIFICATION_SETTINGS, true);
    off.notifier.update([need('a')], DEFAULT_NOTIFICATION_SETTINGS, true);
    expect(off.shown).toEqual([]);
    expect(off.chimes).toHaveLength(1);

    const silent = setup();
    silent.notifier.update([], { ...ON, sound: false }, true);
    silent.notifier.update([need('a')], { ...ON, sound: false }, true);
    expect(silent.shown).toHaveLength(1);
    expect(silent.chimes).toEqual([]);
  });

  it('a burst of needs is one sound, one notification each', () => {
    const { notifier, shown, chimes } = setup();
    notifier.update([], ON, true);
    notifier.update([need('a'), need('b', 'waiting')], ON, true);
    expect(shown.map((s) => s.id)).toEqual(['a', 'b']);
    expect(chimes).toHaveLength(1);
  });

  it('closes a notification once its need is answered, and all of them on dispose', () => {
    const { notifier, shown } = setup();
    notifier.update([], ON, true);
    notifier.update([need('a'), need('b')], ON, true);
    notifier.update([need('b')], ON, true);
    expect(shown.find((s) => s.id === 'a')!.closed).toBe(true);
    expect(shown.find((s) => s.id === 'b')!.closed).toBe(false);
    notifier.dispose();
    expect(shown.find((s) => s.id === 'b')!.closed).toBe(true);
  });
});

describe('notification settings', () => {
  it('defaults: desktop off, sound on at 60 percent, every kind, only when away', () => {
    expect(parseNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(DEFAULT_NOTIFICATION_SETTINGS).toMatchObject({ desktop: false, sound: true, volume: 0.6, onlyWhenAway: true });
  });

  it('keeps valid saved fields and drops the rest', () => {
    expect(parseNotificationSettings('{not json')).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    const parsed = parseNotificationSettings(JSON.stringify({ desktop: true, sound: 'yes', volume: 7, kinds: { waiting: false, bogus: true }, onlyWhenAway: false }));
    expect(parsed).toEqual({ desktop: true, sound: true, volume: 1, kinds: { permission: true, waiting: false, check_in: true, sign_in: true }, onlyWhenAway: false });
  });
});

describe('tab presence', () => {
  /** Tabs sharing one fake lock and one fake channel. */
  function browser() {
    const holders: (() => void)[] = [];
    const queue: (() => void)[] = [];
    const listeners = new Set<(event: Event) => void>();
    const locks = {
      request: (name: string, callback: () => Promise<void> | undefined) => {
        expect(name).toBe(LEADER_LOCK);
        return new Promise<void>((done) => {
          const grant = () => {
            const held = callback();
            holders.push(() => undefined);
            void Promise.resolve(held).then(() => {
              done();
              queue.shift()?.();
            });
          };
          if (holders.length === 0) grant();
          else queue.push(grant);
        });
      },
    } as unknown as PresenceEnv['locks'];
    const channel = () => {
      const own = new Set<(event: Event) => void>();
      return {
        postMessage: (data: unknown) => {
          for (const listener of listeners) if (!own.has(listener)) listener({ data } as MessageEvent);
        },
        addEventListener: (_: string, listener: (event: Event) => void) => {
          own.add(listener);
          listeners.add(listener);
        },
        removeEventListener: (_: string, listener: (event: Event) => void) => {
          own.delete(listener);
          listeners.delete(listener);
        },
        close: () => undefined,
      };
    };
    return { locks, channel: channel as unknown as PresenceEnv['channel'] };
  }

  const tab = (env: ReturnType<typeof browser>, focused: { value: boolean }) => {
    let changed: () => void = () => undefined;
    const presence = createTabPresence({ ...env, focused: () => focused.value, onFocusChange: (callback) => ((changed = callback), () => undefined) });
    return { presence, focus: (value: boolean) => ((focused.value = value), changed()) };
  };

  it('one tab leads; it knows when another Ogden tab is in front', async () => {
    const env = browser();
    const a = tab(env, { value: false });
    const b = tab(env, { value: false });
    await Promise.resolve();
    expect([a.presence.isLeader(), b.presence.isLeader()]).toEqual([true, false]);
    expect(a.presence.anyTabFocused()).toBe(false);
    b.focus(true);
    expect(a.presence.anyTabFocused()).toBe(true);
    b.focus(false);
    expect(a.presence.anyTabFocused()).toBe(false);
    b.focus(true);
    b.presence.dispose();
    expect(a.presence.anyTabFocused()).toBe(false);
    a.presence.dispose();
  });

  it('with no Web Locks every tab speaks', () => {
    const presence = createTabPresence({ focused: () => false, onFocusChange: () => () => undefined });
    expect(presence.isLeader()).toBe(true);
    presence.dispose();
    expect(presence.isLeader()).toBe(false);
  });
});

describe('playChime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetChimeForTests();
  });

  it('plays two notes at the volume through the audio engine, no file and no network', () => {
    const oscillators: { frequency: number; started: boolean }[] = [];
    const gains: number[] = [];
    class FakeContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = vi.fn(async () => undefined);
      createOscillator() {
        const record = { frequency: 0, started: false };
        oscillators.push(record);
        return {
          type: 'sine',
          frequency: { setValueAtTime: (value: number) => (record.frequency = value) },
          connect: (node: unknown) => node,
          start: () => (record.started = true),
          stop: () => undefined,
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: (value: number) => gains.push(value) },
          connect: (node: unknown) => node,
        };
      }
    }
    const fetchSpy = vi.fn();
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', fetchSpy);
    playChime(0.5);
    expect(oscillators.map((o) => o.frequency)).toEqual([...CHIME_NOTES]);
    expect(oscillators.every((o) => o.started)).toBe(true);
    expect(Math.max(...gains)).toBeCloseTo(0.2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is silent, never throwing, at volume 0 or with no audio engine', () => {
    const Ctor = vi.fn();
    vi.stubGlobal('AudioContext', Ctor);
    playChime(0);
    expect(Ctor).not.toHaveBeenCalled();
    vi.stubGlobal('AudioContext', undefined);
    expect(() => playChime(0.5)).not.toThrow();
  });
});
