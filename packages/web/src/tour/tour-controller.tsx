import { useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useOnboarding } from '@/onboarding/onboarding-api';
import { useBmadPieces, useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { tourArms, tourSteps } from './tour-model';
import { startTour, useTourState } from './tour-store';
import { TourOverlay } from './tour-overlay';

/**
 * Arms the tour the moment Welcome's `welcomeCompleted` changes from not
 * done to done in this tab (AC1) — never on arrival, so a user whose
 * Welcome was already finished before this ran is never shown it out of
 * nowhere, and a reload or restart never re-arms it either, since the watch
 * starts over and sees no transition (AC3). Once armed, waits for a project
 * (`wsId`) and that project's BMad pieces to be known before opening, so
 * Plan and Board show only when this project actually has them (AC2).
 * Settings' Replay action (AC4) reaches the same opening path through the
 * tour store, from a page that has no project of its own.
 *
 * Mounted once in `AppShell`, beside `AppShortcutOffer`.
 */
export function TourController() {
  const onboarding = useOnboarding();
  const { wsId } = useParams({ strict: false }) as { wsId?: string };
  const { pendingReplayWsId } = useTourState();
  const [armed, setArmed] = useState(false);
  const openedOnce = useRef(false);
  const previousWelcomeCompleted = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const now = onboarding.data?.welcomeCompleted;
    if (now === undefined) return;
    const previous = previousWelcomeCompleted.current;
    previousWelcomeCompleted.current = now;
    if (!openedOnce.current && tourArms(previous, now)) setArmed(true);
  }, [onboarding.data?.welcomeCompleted]);

  return (
    <>
      {wsId === undefined ? null : (
        <TourStarter
          wsId={wsId}
          armed={armed}
          replaying={pendingReplayWsId === wsId}
          onArmedConsumed={() => setArmed(false)}
          onOpened={() => (openedOnce.current = true)}
        />
      )}
      <TourOverlay />
    </>
  );
}

/**
 * Only mounted with a project in view (`useWorkspaceSettings`/`useBmadPieces`
 * need one): opens the tour, built for this project, once its settings and
 * this install's BMad availability have both loaded (or failed), whether
 * that is because the auto-start just armed or because Settings asked for a
 * replay here.
 */
function TourStarter({
  wsId,
  armed,
  replaying,
  onArmedConsumed,
  onOpened,
}: {
  wsId: string;
  armed: boolean;
  replaying: boolean;
  onArmedConsumed(): void;
  onOpened(): void;
}) {
  const settings = useWorkspaceSettings(wsId);
  const availability = useBmadPieces();
  const settled = (settings.data !== undefined || settings.isError) && (availability.data !== undefined || availability.isError);

  useEffect(() => {
    if (!settled || (!armed && !replaying)) return;
    startTour(tourSteps(settings.isError ? undefined : settings.data?.bmadPieces, availability.isError ? undefined : availability.data));
    onOpened();
    if (armed) onArmedConsumed();
    // onArmedConsumed/onOpened are stable setState/ref wrappers from the parent; only re-run on what actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, armed, replaying, settings.data, settings.isError, availability.data, availability.isError]);

  return null;
}
