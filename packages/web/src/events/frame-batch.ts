/**
 * Applying socket messages once per frame (story 2.10): a streamed reply can
 * send hundreds of chunks a second, and each store update re-renders every
 * reader, so messages wait in a queue and the next frame applies them all in
 * one update.
 */

/** Asks for `callback` on the next frame; returns a function that cancels it. */
export type FrameScheduler = (callback: () => void) => () => void;

/**
 * The longest a queued message waits when no frame comes. A tab that is
 * hidden applies each message at once instead (see {@link pageHidden}).
 */
export const FRAME_FALLBACK_MS = 100;

/** The browser's next animation frame, or {@link FRAME_FALLBACK_MS}, whichever comes first. */
export const nextFrame: FrameScheduler = (callback) => {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cancel();
    callback();
  };
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : undefined;
  const timer = setTimeout(run, FRAME_FALLBACK_MS);
  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
  return () => {
    done = true;
    cancel();
  };
};

/**
 * Whether the page is hidden. A hidden tab gets no animation frames and its
 * timers are throttled (to once a second or less), so waiting for either would
 * leave its store behind: nothing is painted, so each message is applied at once.
 */
export const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

export interface FrameBatch<T> {
  /** Queues one item; the next frame applies it with everything else queued. */
  push(item: T): void;
  /** Applies what is queued now (before a page merges in, or the socket closes). */
  flush(): void;
  /** Drops what is queued and cancels the frame. */
  dispose(): void;
  readonly size: number;
}

/**
 * Collects items and hands them to `apply` together, at most once per frame,
 * in the order they came; while `immediate()` holds (a hidden page), at once.
 */
export function createFrameBatch<T>(apply: (items: T[]) => void, schedule: FrameScheduler = nextFrame, immediate: () => boolean = pageHidden): FrameBatch<T> {
  let queue: T[] = [];
  let cancel: (() => void) | undefined;
  const flush = () => {
    cancel?.();
    cancel = undefined;
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    apply(items);
  };
  return {
    push(item) {
      queue.push(item);
      if (immediate()) flush();
      else cancel ??= schedule(flush);
    },
    flush,
    dispose() {
      cancel?.();
      cancel = undefined;
      queue = [];
    },
    get size() {
      return queue.length;
    },
  };
}
