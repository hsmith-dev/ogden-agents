import { LAUNCH_CODE_FRAGMENT_PARAM, TAB_TOKEN_PATTERN, TAB_TOKEN_STORAGE_KEY, webSocketProtocols } from '@ogden-agents/shared';

/**
 * This tab's token (AD-15 as amended): the boot script (`boot/boot.js`)
 * exchanged the launch link's `#c=<code>` for it over POST and put it in
 * sessionStorage; this keeps it in memory and puts it on every request. A tab
 * without one, or whose token the server refused, shows the "Open Ogden
 * Agents" state.
 */
export interface TabAuth {
  /** Settles once the boot script's code exchange (if any) is done; render after it. */
  ready: Promise<void>;
  /** The token, or undefined when this tab isn't connected. */
  token(): string | undefined;
  /** Forgets the token (the server refused it) and tells every listener. */
  forget(): void;
  /** Calls `listener` when the token is forgotten; returns the unsubscribe. */
  onForget(listener: () => void): () => void;
  /** The subprotocols for the event WebSocket; undefined without a token. */
  webSocketProtocols(): [string, string] | undefined;
  /**
   * A same-origin request with `Authorization: Bearer <token>` and no
   * cookies. A 401 means the server doesn't know this tab: the token is
   * forgotten. Throws {@link NotConnectedError} without a token.
   */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** Thrown by {@link TabAuth.fetch} when this tab has no token to send. */
export class NotConnectedError extends Error {
  constructor() {
    super("This tab isn't connected to Ogden Agents.");
    this.name = 'NotConnectedError';
  }
}

export interface TabAuthOptions {
  storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined;
  /** The boot script's launch-code exchange: a promise of the new token, or null if it failed. */
  exchange?: Promise<string | null> | undefined;
  fetchImpl?: typeof fetch;
}

export function createTabAuth({ storage, exchange, fetchImpl }: TabAuthOptions): TabAuth {
  let current: string | undefined;
  try {
    const stored = storage?.getItem(TAB_TOKEN_STORAGE_KEY) ?? undefined;
    if (stored !== undefined && TAB_TOKEN_PATTERN.test(stored)) current = stored;
  } catch {
    // Storage blocked: only the handoff can connect this tab.
  }
  // A fresh launch link replaces any token this tab had; a failed one leaves it.
  const ready = (exchange ?? Promise.resolve(null)).then(
    (token) => {
      if (typeof token === 'string' && TAB_TOKEN_PATTERN.test(token)) current = token;
    },
    () => undefined,
  );
  const listeners = new Set<() => void>();

  const forget = () => {
    const had = current !== undefined;
    current = undefined;
    try {
      storage?.removeItem(TAB_TOKEN_STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
    if (had) for (const listener of [...listeners]) listener();
  };

  return {
    ready,
    token: () => current,
    forget,
    onForget(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    webSocketProtocols: () => (current === undefined ? undefined : webSocketProtocols(current)),
    async fetch(path, init = {}) {
      if (current === undefined) throw new NotConnectedError();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${current}`);
      const response = await (fetchImpl ?? fetch)(path, { ...init, headers, credentials: 'omit' });
      if (response.status === 401) forget();
      return response;
    },
  };
}

/** Takes, once, the boot script's pending code exchange, if this page was opened from a launch link. */
function takeExchange(): Promise<string | null> | undefined {
  const holder = window as unknown as { __ogdenTabExchange?: unknown };
  const value = holder.__ogdenTabExchange;
  if (value === undefined) return undefined;
  delete holder.__ogdenTabExchange;
  return value instanceof Promise ? (value as Promise<string | null>) : undefined;
}

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * A launch link opened in a tab that already shows the app (pasted into the
 * address bar) changes only the fragment, so the boot script doesn't run
 * again: reload, and it does, exchanging the new code.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (window.location.hash.startsWith(`#${LAUNCH_CODE_FRAGMENT_PARAM}=`)) window.location.reload();
  });
}

/** This tab's auth, read once when the app loads. */
export const tabAuth: TabAuth =
  typeof window === 'undefined'
    ? createTabAuth({ storage: undefined })
    : createTabAuth({ storage: sessionStorageOrUndefined(), exchange: takeExchange() });
