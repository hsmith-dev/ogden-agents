import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useEventStream } from '@/events/event-stream';
import { useSidebarData } from '@/shell/sidebar-data';
import { playChime } from './chime';
import { desktopPermission } from './desktop';
import { useNotificationSettings } from './notification-settings';
import { createNotifier, type Notifier } from './notifier';
import { createTabPresence, type TabPresence } from './tab-presence';

/**
 * The shell's notifier (backlog story 8), mounted once beside the live
 * announcer: it watches Needs you (built from the server's events, no
 * polling) and, for each new need, shows one desktop notification and plays
 * the chime, from one tab of all those open. Clicking a notification brings
 * that tab forward on the chat the need is in. Renders nothing: the Needs you
 * group and the tab title are the visual signal.
 */
export function AttentionNotifier() {
  const { model } = useSidebarData();
  const { caughtUp } = useEventStream();
  const { settings } = useNotificationSettings();
  const router = useRouter();
  const notifier = useRef<Notifier | undefined>(undefined);
  const presence = useRef<TabPresence | undefined>(undefined);

  useEffect(() => {
    const tabs = createTabPresence();
    presence.current = tabs;
    const current = createNotifier({
      isLeader: () => tabs.isLeader(),
      anyTabFocused: () => tabs.anyTabFocused(),
      permission: desktopPermission,
      chime: playChime,
      show(need, text) {
        try {
          const notification = new Notification(text.title, { body: text.body, tag: need.id });
          notification.onclick = () => {
            window.focus();
            void router.navigate({ to: '/w/$wsId/s/$sesId', params: { wsId: need.wsId, sesId: need.sesId } });
            notification.close();
          };
          return notification;
        } catch {
          // Some browsers allow notifications only from a service worker: the sound and Needs you still tell.
          return undefined;
        }
      },
    });
    notifier.current = current;
    return () => {
      current.dispose();
      tabs.dispose();
    };
  }, [router]);

  useEffect(() => {
    notifier.current?.update(model.needsYou, settings, caughtUp);
  }, [model.needsYou, settings, caughtUp]);

  return null;
}
