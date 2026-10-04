import type { HistoryPageMessage, PageHistoryMessage, WorkspaceId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECONNECT_DELAY_MS, nextReconnectDelay, RECONNECT_DELAY_MS } from '../src/events/event-stream';
import { createPendingPages, PAGE_INVALID, PAGE_TIMED_OUT, PAGE_TIMEOUT_MS } from '../src/events/pending-pages';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
const page = (requestId: string): HistoryPageMessage => ({ type: 'history_page', requestId, workspaceId: wsId, events: [], hasMore: false });

afterEach(() => {
  vi.useRealTimers();
});

describe('pending page requests', () => {
  it('sends a schema-valid request and resolves with its answer only', async () => {
    const sent: PageHistoryMessage[] = [];
    const pending = createPendingPages((message) => sent.push(message));
    const first = pending.request({ workspaceId: wsId, beforeSeq: 10, limit: 5 });
    const second = pending.request({ workspaceId: wsId, beforeSeq: 10, limit: 5 });
    expect(sent.map((m) => m.requestId)).toEqual(['page-1', 'page-2']);
    expect(pending.resolve(page('page-2'))).toBe(true);
    expect(pending.resolve(page('page-2'))).toBe(false);
    expect(pending.resolve(page('someone-else'))).toBe(false);
    await expect(second).resolves.toEqual(page('page-2'));
    expect(pending.reject('page-1', new Error('not_found'))).toBe(true);
    await expect(first).rejects.toThrow('not_found');
    expect(pending.size).toBe(0);
  });

  it('rejects an invalid request at once and never sends it', async () => {
    const send = vi.fn();
    const pending = createPendingPages(send);
    await expect(pending.request({ workspaceId: 'not-a-workspace' as WorkspaceId, beforeSeq: 10, limit: 5 })).rejects.toThrow(PAGE_INVALID);
    await expect(pending.request({ workspaceId: wsId, beforeSeq: 10, limit: 501 })).rejects.toThrow(PAGE_INVALID);
    expect(send).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it('times out an unanswered request, and a late answer is ignored', async () => {
    vi.useFakeTimers();
    const pending = createPendingPages(() => {});
    const request = pending.request({ workspaceId: wsId, beforeSeq: 10, limit: 5 });
    const settled = expect(request).rejects.toThrow(PAGE_TIMED_OUT);
    vi.advanceTimersByTime(PAGE_TIMEOUT_MS);
    await settled;
    expect(pending.resolve(page('page-1'))).toBe(false);
  });

  it('rejects everything pending when the connection drops, and clears the timers', async () => {
    vi.useFakeTimers();
    const pending = createPendingPages(() => {});
    const requests = [pending.request({ workspaceId: wsId, beforeSeq: 10, limit: 5 }), pending.request({ workspaceId: wsId, beforeSeq: 5, limit: 5 })];
    pending.rejectAll(new Error('dropped'));
    for (const request of requests) await expect(request).rejects.toThrow('dropped');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('reconnect backoff while the workspace list fails', () => {
  it('starts at 1 s and doubles up to 30 s', () => {
    const delays: number[] = [];
    let delay: number | undefined;
    for (let i = 0; i < 8; i++) delays.push((delay = nextReconnectDelay(delay)));
    expect(delays).toEqual([RECONNECT_DELAY_MS, 2000, 4000, 8000, 16_000, MAX_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS]);
  });
});
