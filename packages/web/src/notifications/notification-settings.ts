import { useCallback, useEffect, useState } from 'react';
import type { NotifiableNeedKind as NeedKind } from '@/shell/sidebar-model';

/**
 * Notification preferences (backlog story 8), saved in this browser like
 * Appearance: the browser's own permission is per browser too. Every tab of
 * the same browser follows a change through the `storage` event.
 */
export interface NotificationSettings {
  /** Desktop notifications; only on once the browser granted them. */
  desktop: boolean;
  sound: boolean;
  /** 0 to 1. */
  volume: number;
  /** Which kinds of need notify; every kind still shows in Needs you. */
  kinds: Record<NeedKind, boolean>;
  /** Stay silent while an Ogden tab is the one the user is looking at. */
  onlyWhenAway: boolean;
}

export const NOTIFICATION_SETTINGS_KEY = 'ogden-agents.notifications';

export const NEED_KINDS: readonly NeedKind[] = ['permission', 'waiting', 'check_in', 'sign_in'];

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktop: false,
  sound: true,
  volume: 0.6,
  kinds: { permission: true, waiting: true, check_in: true, sign_in: true },
  onlyWhenAway: true,
};

/** Reads a saved value, keeping only valid fields; anything else is the default. */
export function parseNotificationSettings(raw: string | null): NotificationSettings {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed !== null && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt value: the defaults.
  }
  const defaults = DEFAULT_NOTIFICATION_SETTINGS;
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const kinds = saved.kinds !== null && typeof saved.kinds === 'object' ? (saved.kinds as Record<string, unknown>) : {};
  const volume = typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : defaults.volume;
  return {
    desktop: bool(saved.desktop, defaults.desktop),
    sound: bool(saved.sound, defaults.sound),
    volume,
    kinds: Object.fromEntries(NEED_KINDS.map((kind) => [kind, bool(kinds[kind], defaults.kinds[kind])])) as Record<NeedKind, boolean>,
    onlyWhenAway: bool(saved.onlyWhenAway, defaults.onlyWhenAway),
  };
}

export function loadNotificationSettings(storage: Pick<Storage, 'getItem'> = window.localStorage): NotificationSettings {
  try {
    return parseNotificationSettings(storage.getItem(NOTIFICATION_SETTINGS_KEY));
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export function saveNotificationSettings(settings: NotificationSettings, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

/** Tabs of this page that changed the settings, so each sees its own change without a `storage` event. */
const listeners = new Set<(settings: NotificationSettings) => void>();

/** The settings, following changes from this tab and every other tab of this browser. */
export function useNotificationSettings(): { settings: NotificationSettings; update(change: Partial<NotificationSettings>): void } {
  const [settings, setSettings] = useState(loadNotificationSettings);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATION_SETTINGS_KEY) setSettings(parseNotificationSettings(event.newValue));
    };
    listeners.add(setSettings);
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(setSettings);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const update = useCallback((change: Partial<NotificationSettings>) => {
    const next = { ...loadNotificationSettings(), ...change };
    saveNotificationSettings(next);
    for (const listener of listeners) listener(next);
  }, []);
  return { settings, update };
}
