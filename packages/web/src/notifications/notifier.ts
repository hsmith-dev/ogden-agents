import type { NeedKind, NeedsYouEntry } from '@/shell/sidebar-model';
import type { NotificationSettings } from './notification-settings';

/**
 * The attention notifier's rules (backlog story 8), apart from React and the
 * browser so they are unit-tested: which needs notify, in which tab, and with
 * what words.
 */

/** Each kind in plain words: the notification's title and the settings' checkbox labels. */
export const NEED_KIND_LABELS: Record<NeedKind, string> = {
  permission: 'Approval needed',
  waiting: 'Waiting for your answer',
  check_in: 'Agent is quiet',
  sign_in: 'Sign in needed',
};

export interface NotificationText {
  title: string;
  body: string;
}

/**
 * A need's notification text. It can show on a lock screen, so it names only
 * the project, the chat and the kind: never a command, a file, a path or what
 * the agent said.
 */
export function notificationText(need: Pick<NeedsYouEntry, 'kind' | 'workspaceName' | 'chatName' | 'keyRejected'>): NotificationText {
  // An agent with only an API key has no sign in: its key was rejected.
  const title = need.keyRejected === true ? 'API key rejected' : NEED_KIND_LABELS[need.kind];
  return { title, body: `${need.workspaceName}: ${need.chatName}` };
}

/** Whether the browser lets Ogden show notifications: its permission, or `unsupported`. */
export type DesktopPermission = NotificationPermission | 'unsupported';

export interface NotifierDeps {
  isLeader(): boolean;
  anyTabFocused(): boolean;
  permission(): DesktopPermission;
  /** Shows one need's notification; returns a way to close it, when there is one. */
  show(need: NeedsYouEntry, text: NotificationText): { close(): void } | undefined;
  chime(volume: number): void;
}

export interface Notifier {
  /**
   * Called with every new Needs you list. Before the tab has caught up, and on
   * the call that catches up, it only records what is there: a need already
   * waiting when the tab opened is not news. `sessions` is every chat the
   * sidebar has: a need in a chat it did not have on the last call is its
   * list loading late, not news either.
   */
  update(needs: readonly NeedsYouEntry[], settings: NotificationSettings, caughtUp: boolean, sessions: ReadonlySet<string>): void;
  dispose(): void;
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const seen = new Set<string>();
  const shown = new Map<string, { close(): void }>();
  let started = false;
  let knownSessions: ReadonlySet<string> = new Set();
  return {
    update(needs, settings, caughtUp, sessions) {
      const known = knownSessions;
      knownSessions = sessions;
      const fresh = needs.filter((need) => !seen.has(need.id));
      for (const need of fresh) seen.add(need.id);
      // A need that left the list is answered: its notification goes too.
      const current = new Set(needs.map((need) => need.id));
      for (const [id, notification] of shown) {
        if (current.has(id)) continue;
        notification.close();
        shown.delete(id);
      }
      if (!started) {
        started = caughtUp;
        return;
      }
      if (!deps.isLeader()) return;
      const due = fresh.filter((need) => settings.kinds[need.kind] && known.has(need.sesId));
      if (due.length === 0) return;
      if (settings.onlyWhenAway && deps.anyTabFocused()) return;
      if (settings.desktop && deps.permission() === 'granted') {
        for (const need of due) {
          const notification = deps.show(need, notificationText(need));
          if (notification !== undefined) shown.set(need.id, notification);
        }
      }
      if (settings.sound) deps.chime(settings.volume);
    },
    dispose() {
      for (const notification of shown.values()) notification.close();
      shown.clear();
    },
  };
}
