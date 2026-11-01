import { afterEach, describe, expect, it } from 'vitest';
import { lastNeedsYouOpened, markNeedsYouOpened, needsYouOpenCount, needsYouTarget, nextNeedsYou, resetNeedsYouOpened, subscribeNeedsYouOpened } from '../src/shell/needs-you-target';

const A = { id: 'a' };
const B = { id: 'b' };

describe('g y: the next Needs you row (epic 26, E26-R1)', () => {
  afterEach(resetNeedsYouOpened);

  it('opens the row after the one last opened', () => {
    expect(nextNeedsYou([A, B], 'a')).toBe(B);
  });

  it('wraps from the last row to the first', () => {
    expect(nextNeedsYou([A, B], 'b')).toBe(A);
  });

  it('opens the first row when nothing was opened, or the one last opened is gone', () => {
    expect(nextNeedsYou([A, B], undefined)).toBe(A);
    expect(nextNeedsYou([A, B], 'x')).toBe(A);
  });

  it('does nothing on an empty list', () => {
    expect(nextNeedsYou([], 'a')).toBeUndefined();
    expect(nextNeedsYou([], undefined)).toBeUndefined();
  });

  it('a click and g y share the row last opened, once per tab', () => {
    expect(lastNeedsYouOpened()).toBeUndefined();
    markNeedsYouOpened('a');
    expect(lastNeedsYouOpened()).toBe('a');
    expect(nextNeedsYou([A, B], lastNeedsYouOpened())).toBe(B);
  });

  it('every open counts and tells its listeners, the same row again too', () => {
    const before = needsYouOpenCount();
    let heard = 0;
    const unsubscribe = subscribeNeedsYouOpened(() => (heard += 1));
    markNeedsYouOpened('a');
    markNeedsYouOpened('a');
    unsubscribe();
    expect(needsYouOpenCount()).toBe(before + 2);
    expect(heard).toBe(2);
  });
});

describe("a Needs you row's target", () => {
  it('a permission request opens its chat on its card', () => {
    expect(needsYouTarget({ id: 'req_x', kind: 'permission', wsId: 'ws_w', sesId: 'ses_s' })).toEqual({ to: '/w/$wsId/s/$sesId', params: { wsId: 'ws_w', sesId: 'ses_s' }, hash: 'permission-req_x' });
  });

  it('a question, a quiet agent, a sign in or a blocked run opens its chat', () => {
    for (const kind of ['waiting', 'check_in', 'sign_in', 'run_blocked'] as const) {
      expect(needsYouTarget({ id: `${kind}:1`, kind, wsId: 'ws_w', sesId: 'ses_s' })).toEqual({ to: '/w/$wsId/s/$sesId', params: { wsId: 'ws_w', sesId: 'ses_s' } });
    }
  });

  it('a run ready for review opens its review page; a pane its project\'s Terminals', () => {
    expect(needsYouTarget({ id: 'run_review:r', kind: 'run_review', wsId: 'ws_w', sesId: 'ses_s', reviewRef: '1.2' })).toEqual({ to: '/w/$wsId/review/$ref', params: { wsId: 'ws_w', ref: '1.2' } });
    expect(needsYouTarget({ id: 'pane:p:1', kind: 'pane', wsId: 'ws_w', sesId: '', paneId: 'pane_1' })).toEqual({ to: '/w/$wsId/terminals', params: { wsId: 'ws_w' } });
  });
});
