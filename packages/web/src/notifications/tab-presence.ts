/**
 * Which Ogden tab speaks for all of them, and whether any of them is the one
 * the user is looking at (backlog story 8). The leader holds a Web Lock for
 * its whole life; when it closes, the browser hands the lock to the next tab.
 * Tabs tell each other over a BroadcastChannel when they gain or lose focus,
 * so the leader knows whether Ogden is in front even when it is not.
 */

export const LEADER_LOCK = 'ogden-agents.notify-leader';
export const PRESENCE_CHANNEL = 'ogden-agents.notify-presence';

type PresenceMessage = { type: 'focus'; tabId: string; focused: boolean } | { type: 'hello' };

export interface TabPresence {
  isLeader(): boolean;
  /** This tab or any other Ogden tab in this browser is visible and focused. */
  anyTabFocused(): boolean;
  dispose(): void;
}

export interface PresenceEnv {
  locks?: Pick<LockManager, 'request'> | undefined;
  channel?: ((name: string) => Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'>) | undefined;
  /** Whether this tab is visible and focused now. */
  focused(): boolean;
  /** Calls back whenever this tab's focus may have changed, with `leaving` when the page is going away; returns the unsubscribe. */
  onFocusChange(callback: (leaving: boolean) => void): () => void;
}

/** The browser's environment for {@link createTabPresence}. */
export function browserPresenceEnv(): PresenceEnv {
  return {
    locks: typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined,
    channel: typeof BroadcastChannel === 'undefined' ? undefined : (name) => new BroadcastChannel(name),
    focused: () => document.visibilityState === 'visible' && document.hasFocus(),
    onFocusChange(callback) {
      const changed = () => callback(false);
      // A reload or a navigation in this tab fires no blur: say it left, or the leader thinks it is still in front.
      const leaving = () => callback(true);
      const events = ['focus', 'blur', 'pageshow'] as const;
      for (const name of events) window.addEventListener(name, changed);
      window.addEventListener('pagehide', leaving);
      document.addEventListener('visibilitychange', changed);
      return () => {
        for (const name of events) window.removeEventListener(name, changed);
        window.removeEventListener('pagehide', leaving);
        document.removeEventListener('visibilitychange', changed);
      };
    },
  };
}

export function createTabPresence(env: PresenceEnv = browserPresenceEnv()): TabPresence {
  const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const others = new Map<string, boolean>();
  let disposed = false;
  // With no Web Locks every tab speaks; the notification's tag still keeps one per need on screen.
  let leader = env.locks === undefined;
  let release: (() => void) | undefined;

  const channel = env.channel?.(PRESENCE_CHANNEL);
  const post = (message: PresenceMessage) => {
    try {
      channel?.postMessage(message);
    } catch {
      // A closed channel: nothing to tell.
    }
  };
  let left = false;
  const report = (leaving = false) => {
    if (leaving) left = true;
    else if (left) left = false; // Back from the back/forward cache.
    if (!disposed) post({ type: 'focus', tabId, focused: !left && env.focused() });
  };
  const onMessage = (event: Event) => {
    const message = (event as MessageEvent<PresenceMessage>).data;
    if (message?.type === 'hello') report(left);
    else if (message?.type === 'focus' && typeof message.tabId === 'string') {
      if (message.focused) others.set(message.tabId, true);
      else others.delete(message.tabId);
    }
  };
  channel?.addEventListener('message', onMessage);
  const stopFocus = env.onFocusChange((leaving) => report(leaving));
  report();

  if (env.locks !== undefined) {
    void env.locks
      .request(LEADER_LOCK, () => {
        if (disposed) return undefined;
        leader = true;
        // A new leader forgets what it heard (a tab may have gone without a word) and asks every tab where focus is.
        others.clear();
        post({ type: 'hello' });
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {
        // Locks refused (an opaque origin): speak, as with no locks.
        leader = true;
      });
  }

  return {
    isLeader: () => leader && !disposed,
    anyTabFocused: () => (!left && env.focused()) || [...others.values()].some(Boolean),
    dispose() {
      if (disposed) return;
      post({ type: 'focus', tabId, focused: false });
      disposed = true;
      leader = false;
      release?.();
      stopFocus();
      channel?.removeEventListener('message', onMessage);
      channel?.close();
    },
  };
}
