import { useRouterState } from '@tanstack/react-router';
import { useEffect, useSyncExternalStore } from 'react';
import { dismissAppShortcutOffer, useAppShortcut, useAppShortcutActions, useOfferAnswerPending } from '@/appearance/app-shortcut-api';
import { useOnboarding } from '@/onboarding/onboarding-api';
import { redirectsToWelcome } from '@/onboarding/welcome-model';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';

/*
 * The banner's life in this page load (epic 26, 26.5): `unseen` until the
 * offer is first pending here, then `showing` (the offer is marked answered
 * on the server at that moment, so the next load has no banner), then
 * `closed` once Add shortcut works or Not now is chosen. Help's tip sets
 * `showing` again. A module store, not component state: one page load,
 * whatever remounts the banner.
 */
export type AppShortcutOfferPhase = 'unseen' | 'showing' | 'closed';

let phase: AppShortcutOfferPhase = 'unseen';
const listeners = new Set<() => void>();

function setPhase(next: AppShortcutOfferPhase) {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getPhase = () => phase;

/** The banner's phase in this page load. */
export function useAppShortcutOfferPhase(): AppShortcutOfferPhase {
  return useSyncExternalStore(subscribe, getPhase, getPhase);
}

/** Help's tip: shows the banner again (where it may show: not on Welcome, supported, not installed). */
export function showAppShortcutTip(): void {
  setPhase('showing');
}

/** Back to a fresh page load, for tests. */
export function resetAppShortcutOffer(): void {
  setPhase('unseen');
}

/**
 * The Ogden Agents app shortcut banner (E2-R10, story 2.4; shows once from
 * epic 26), at the top of the workspace area. The first page load with the
 * offer pending shows it and marks the offer answered on the server, so it
 * stays for that load only (EXPERIENCE.md Shortcut banner: the next launch
 * ends it). **Add shortcut** and **Not now** close it; a failed Add says why
 * in place. Never on `/welcome` or on its way there (a first run), whose own
 * shortcut step makes the offer (9.5), nor while an answer is still being sent or retried (9.6), nor on a
 * computer that can't have it (the desktop app). Help's tip brings it back.
 */
export function AppShortcutOffer() {
  const { data } = useAppShortcut();
  const { add, dismiss } = useAppShortcutActions();
  const onWelcome = useRouterState({ select: (state) => state.location.pathname === '/welcome' });
  // An answer still being sent (Welcome's retries included) counts as answered; one that failed for good brings the offer back.
  const answering = useOfferAnswerPending();
  const current = useAppShortcutOfferPhase();
  // A first run is on its way to Welcome, whose shortcut step makes the offer: not seen here, or Welcome would skip that step.
  const onboarding = useOnboarding();
  const firstRunKnown = !onboarding.isPending;
  const firstRun = redirectsToWelcome(onboarding.data);
  const offerable = data !== undefined && data.supported && !data.installed;
  const pending = offerable && data.offerPending;

  useEffect(() => {
    // The store's phase, not this render's: StrictMode runs the effect twice, and the mark is sent once.
    if (getPhase() !== 'unseen' || !pending || onWelcome || answering || !firstRunKnown || firstRun) return;
    setPhase('showing');
    // Seeing it answers it. A plain call: the cache keeps `offerPending` so nothing else moves; a failure only means it may show again next load.
    dismissAppShortcutOffer().catch(() => {});
  }, [current, pending, onWelcome, answering, firstRunKnown, firstRun]);

  if (current !== 'showing' || onWelcome || answering || firstRun || !offerable) return null;
  const busy = add.isPending || dismiss.isPending;
  return (
    <div className="px-(--panel-padding) pt-(--panel-padding)" data-testid="app-shortcut-offer">
      <Notice
        variant={add.isError ? 'blocked' : 'info'}
        action={
          <span className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => add.mutate(undefined, { onSuccess: () => setPhase('closed') })}>
              Add shortcut
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPhase('closed');
                // Already answered when it showed, unless that call failed: this makes sure.
                if (pending) dismiss.mutate();
              }}
            >
              Not now
            </Button>
          </span>
        }
      >
        {add.isError ? <span role="alert">{add.error.message}</span> : 'Open Ogden Agents from your apps menu next time.'}
      </Notice>
    </div>
  );
}
