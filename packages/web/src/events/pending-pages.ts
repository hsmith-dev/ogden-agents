import { PageHistoryMessage, type HistoryPageMessage } from '@ogden-agents/shared';

/** How long a `page_history` may go unanswered before it fails. */
export const PAGE_TIMEOUT_MS = 15_000;

export const PAGE_TIMED_OUT = 'Ogden Agents took too long to load earlier history. Try again.';
export const PAGE_INVALID = "Ogden Agents couldn't ask for earlier history for this chat.";

/** A page request without the `type` and `requestId` the socket adds. */
export type PageRequest = Omit<PageHistoryMessage, 'type' | 'requestId'>;

/**
 * One connection's unanswered `page_history` requests. Each gets its own
 * `requestId`, is checked against the shared schema before it is sent (an
 * invalid one fails at once and is never sent), and fails after
 * `timeoutMs` if no answer comes.
 */
export function createPendingPages(send: (message: PageHistoryMessage) => void, timeoutMs = PAGE_TIMEOUT_MS) {
  const pending = new Map<string, { resolve(page: HistoryPageMessage): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let next = 0;

  const settle = (requestId: string) => {
    const entry = pending.get(requestId);
    if (entry === undefined) return undefined;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    return entry;
  };

  return {
    request(request: PageRequest): Promise<HistoryPageMessage> {
      const parsed = PageHistoryMessage.safeParse({ type: 'page_history', requestId: `page-${++next}`, ...request });
      if (!parsed.success) return Promise.reject(new Error(PAGE_INVALID));
      const message = parsed.data;
      return new Promise<HistoryPageMessage>((resolve, reject) => {
        const timer = setTimeout(() => settle(message.requestId)?.reject(new Error(PAGE_TIMED_OUT)), timeoutMs);
        pending.set(message.requestId, { resolve, reject, timer });
        send(message);
      });
    },
    /** The answer to one request; `false` if it is not pending (already settled, or not ours). */
    resolve(page: HistoryPageMessage): boolean {
      const entry = settle(page.requestId);
      entry?.resolve(page);
      return entry !== undefined;
    },
    /** A `request_failed` for one request. */
    reject(requestId: string, error: Error): boolean {
      const entry = settle(requestId);
      entry?.reject(error);
      return entry !== undefined;
    },
    /** The connection dropped: every pending request fails. */
    rejectAll(error: Error): void {
      for (const requestId of [...pending.keys()]) settle(requestId)?.reject(error);
    },
    get size() {
      return pending.size;
    },
  };
}

export type PendingPages = ReturnType<typeof createPendingPages>;
