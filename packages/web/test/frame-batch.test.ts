import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameBatch, FRAME_FALLBACK_MS, nextFrame, type FrameScheduler } from '../src/events/frame-batch';

/** A frame every 16 ms, on the fake clock. */
const frames: FrameScheduler = (callback) => {
  const timer = setTimeout(callback, 16);
  return () => clearTimeout(timer);
};

describe('frame batching (story 2.10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1,000 chunks in one frame are one update, in the order they came', () => {
    const updates: number[][] = [];
    const batch = createFrameBatch<number>((items) => updates.push(items), frames);
    for (let i = 0; i < 1000; i++) batch.push(i);
    expect(updates).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    // Nothing queued: no update on the next frame.
    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(1);
  });

  it('at most one update per frame while chunks keep coming', () => {
    const updates: number[][] = [];
    const batch = createFrameBatch<number>((items) => updates.push(items), frames);
    for (let i = 0; i < 100; i++) {
      batch.push(i);
      vi.advanceTimersByTime(4);
    }
    vi.advanceTimersByTime(16);
    // 400 ms of chunks every 4 ms: one update per 16 ms frame, every chunk once.
    expect(updates.length).toBe(25);
    expect(updates.flat()).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('flush applies what is queued now and cancels the frame; dispose drops it', () => {
    const updates: string[][] = [];
    const batch = createFrameBatch<string>((items) => updates.push(items), frames);
    batch.push('a');
    batch.flush();
    expect(updates).toEqual([['a']]);
    vi.advanceTimersByTime(16);
    expect(updates).toEqual([['a']]);
    batch.push('b');
    expect(batch.size).toBe(1);
    batch.dispose();
    vi.advanceTimersByTime(16);
    expect(updates).toEqual([['a']]);
    expect(batch.size).toBe(0);
  });

  it('without animation frames (a hidden tab), the fallback timer still applies the queue', () => {
    const updates: number[][] = [];
    const batch = createFrameBatch<number>((items) => updates.push(items), nextFrame);
    batch.push(1);
    vi.advanceTimersByTime(FRAME_FALLBACK_MS - 1);
    expect(updates).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(updates).toEqual([[1]]);
  });

  it('a hidden page applies each message at once, in order, with anything still queued from before', () => {
    const updates: number[][] = [];
    let hidden = false;
    const batch = createFrameBatch<number>((items) => updates.push(items), frames, () => hidden);
    batch.push(1);
    hidden = true;
    batch.push(2);
    expect(updates).toEqual([[1, 2]]);
    batch.push(3);
    expect(updates).toEqual([[1, 2], [3]]);
    // The frame asked for before it was hidden finds nothing left.
    vi.advanceTimersByTime(16);
    expect(updates).toHaveLength(2);
    hidden = false;
    batch.push(4);
    vi.advanceTimersByTime(16);
    expect(updates).toEqual([[1, 2], [3], [4]]);
  });
});
