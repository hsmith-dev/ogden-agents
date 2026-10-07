import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { placeTourCard, type TourRect } from './tour-model';
import { backStep, closeTour, nextStep, useTourState } from './tour-store';

/**
 * Follows a step's target element, re-measuring every frame while the tour
 * is open (so it tracks layout, scroll and resize without wiring up a
 * ResizeObserver and a scroll listener on every ancestor that might move
 * it). `null` (the permissions step; AC1) and a selector that matches
 * nothing both read as `undefined`, which the overlay shows centered,
 * never as a stuck or empty highlight (AC4).
 */
function useTourTargetRect(selector: string | null): TourRect | undefined {
  const [rect, setRect] = useState<TourRect | undefined>(undefined);
  useLayoutEffect(() => {
    if (selector === null) {
      setRect(undefined);
      return;
    }
    let frame = 0;
    const measure = () => {
      const found = document.querySelector(selector)?.getBoundingClientRect();
      setRect((previous) => {
        if (found === undefined) return undefined;
        if (previous !== undefined && previous.top === found.top && previous.left === found.left && previous.width === found.width && previous.height === found.height) return previous;
        return { top: found.top, left: found.left, width: found.width, height: found.height };
      });
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [selector]);
  return rect;
}

/**
 * The guided tour's overlay (backlog story 19): a dimmed layer with a
 * spotlight cut out around the current step's target (or, with nothing to
 * point at, dimmed everywhere) and a small card with the step's words, Back
 * / Next, step dots, and Skip tour. Mounted once in the shell
 * (`TourController`); renders nothing while closed.
 *
 * AC5, never blocks the app: the dimming is `pointer-events-none`, so every
 * click reaches the real element underneath it, and a `pointerdown` or
 * `keydown` anywhere outside the card (or Escape) closes the tour first,
 * without stopping that event — so clicking the highlighted tab, or typing
 * into chat, both work immediately and close the tour as a side effect,
 * never a second click.
 */
export function TourOverlay() {
  const { open, steps, index } = useTourState();
  const step = open ? steps[index] : undefined;
  const target = useTourTargetRect(step?.target ?? null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>(undefined);
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setResizeTick((tick) => tick + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || step === undefined) {
      setPosition(undefined);
      return;
    }
    const size = cardRef.current?.getBoundingClientRect();
    if (size === undefined) return;
    setPosition(placeTourCard(target, { width: window.innerWidth, height: window.innerHeight }, { width: size.width, height: size.height }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, target, resizeTick]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !(cardRef.current?.contains(event.target) ?? false)) closeTour();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTour();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  if (!open || step === undefined) return null;

  const first = index === 0;
  const last = index === steps.length - 1;
  const spotlightPadding = 6;
  const box = target === undefined ? undefined : { top: target.top - spotlightPadding, left: target.left - spotlightPadding, width: target.width + spotlightPadding * 2, height: target.height + spotlightPadding * 2 };

  return createPortal(
    <div data-testid="tour-overlay">
      {box === undefined ? (
        <div data-testid="tour-dim" className="pointer-events-none fixed inset-0 z-50 bg-foreground/30" />
      ) : (
        <>
          <div data-testid="tour-dim" className="pointer-events-none fixed inset-x-0 top-0 z-50 bg-foreground/30" style={{ height: Math.max(box.top, 0) }} />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 bg-foreground/30" style={{ top: Math.max(box.top + box.height, 0) }} />
          <div className="pointer-events-none fixed left-0 z-50 bg-foreground/30" style={{ top: box.top, height: box.height, width: Math.max(box.left, 0) }} />
          <div className="pointer-events-none fixed right-0 z-50 bg-foreground/30" style={{ top: box.top, height: box.height, left: Math.max(box.left + box.width, 0) }} />
          <div
            data-testid="tour-highlight"
            className="pointer-events-none fixed z-50 rounded-lg border-2 border-signal transition-all duration-(--motion-base) ease-standard"
            style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
          />
        </>
      )}
      <div
        ref={cardRef}
        data-testid="tour-card"
        role="group"
        aria-label={`Guided tour, step ${index + 1} of ${steps.length}`}
        className="fixed z-50 flex w-80 flex-col gap-3 rounded-lg border border-border bg-popover p-(--panel-padding) text-popover-foreground shadow-float animate-in fade-in-0 duration-(--motion-base) ease-standard"
        style={position === undefined ? { top: 0, left: 0, visibility: 'hidden' } : { top: position.top, left: position.left }}
      >
        <Text as="h2" variant="heading" ref={headingRef} tabIndex={-1} data-testid="tour-title">
          {step.title}
        </Text>
        <Text variant="body" data-testid="tour-description">
          {step.description}
        </Text>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1" data-testid="tour-dots" aria-hidden>
            {steps.map((each, each_index) => (
              <span key={each.id} className={`size-1.5 rounded-full ${each_index === index ? 'bg-signal' : 'bg-border'}`} />
            ))}
          </span>
          <div className="flex items-center gap-2">
            {first ? null : (
              <Button variant="ghost" size="sm" data-testid="tour-back" onClick={() => backStep()}>
                Back
              </Button>
            )}
            <Button size="sm" data-testid="tour-next" onClick={() => nextStep()}>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
        <Button variant="link" size="sm" className="self-start" data-testid="tour-skip" onClick={() => closeTour()}>
          Skip tour
        </Button>
      </div>
    </div>,
    document.body,
  );
}
