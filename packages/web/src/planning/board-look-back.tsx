import { BMAD_CAPABILITY_REDUCED_TEXT, LOOK_BACK_FAILED, LOOK_BACK_LABEL, type Catalog } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { dismissLookBackOffer, fetchCatalog, fetchLookBackOffers, startLookBack } from './planning-api';

/** Look back on an epic (epic 7): given only with Retrospectives on; `onStarted` opens the new session. */
export interface BoardLookBack {
  onStarted: (sessionId: string) => void;
}

/** What one epic's header needs to show the look-back (story 7.4); built once for the board. */
export interface EpicLookBackControls {
  /** The action's plain label, from the catalog's epic-scoped action. */
  label: string;
  /** While a look-back is being started: every Look back waits. */
  busy: boolean;
  start: (epic: string) => void;
  /** The epics whose finished-epic offer was answered with Not now; `undefined` until the server has said (the offer waits for it). */
  dismissed: ReadonlySet<string> | undefined;
  dismiss: (epic: string) => void;
}

/** What the board knows of the look-back once the catalog answered. */
export interface BoardLookBackState {
  /** Per-epic controls, or `undefined` while there is no action (Retrospectives off, loading, or reduced mode). */
  controls: EpicLookBackControls | undefined;
  /** The reduced-mode sentence to show in place of the action, when the project's BMad Method has no look-back step. */
  reducedText: string | undefined;
  failure: string | undefined;
}

/** The catalog's epic-scoped action: its label, or `undefined` when there is none. */
function epicAction(catalog: Catalog): { label: string } | undefined {
  const action = catalog.skills.find((skill) => skill.scope === 'epic');
  return action === undefined ? undefined : { label: action.label ?? LOOK_BACK_LABEL };
}

/**
 * The look-back on the board (epic 7): the action comes from the catalog's
 * epic-scoped skill (core and web name no skill, AD-12), shown only with
 * Retrospectives on (`lookBack` given); a project whose BMad Method has none
 * gets the reduced-mode sentence instead (AD-14). Starting is one at a time;
 * a refusal says why in the board's alert line in the server's plain words.
 * Not now on a finished epic's offer is kept by the server and read back.
 */
export function useBoardLookBack(wsId: string, lookBack: BoardLookBack | undefined): BoardLookBackState {
  const on = lookBack !== undefined;
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ['catalog', wsId], queryFn: () => fetchCatalog(wsId), enabled: on, retry: false });
  const offers = useQuery({ queryKey: ['look-back-offers', wsId], queryFn: () => fetchLookBackOffers(wsId), enabled: on, retry: false });
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const pending = useRef(false);
  const started = useRef(lookBack?.onStarted);
  started.current = lookBack?.onStarted;
  const start = useCallback(
    (epic: string) => {
      if (pending.current) return;
      pending.current = true;
      setStarting(true);
      setFailure(undefined);
      startLookBack(wsId, epic)
        .then(
          (session) => started.current?.(session.id),
          (error: unknown) => setFailure(error instanceof Error && error.message !== '' ? error.message : `${LOOK_BACK_FAILED}. Try again.`),
        )
        .finally(() => {
          pending.current = false;
          setStarting(false);
        });
    },
    [wsId],
  );
  const dismiss = useCallback(
    (epic: string) => {
      setFailure(undefined);
      dismissLookBackOffer(wsId, epic)
        .then(() => queryClient.invalidateQueries({ queryKey: ['look-back-offers', wsId], exact: true }))
        .catch((error: unknown) => setFailure(error instanceof Error && error.message !== '' ? error.message : `${LOOK_BACK_FAILED}. Try again.`));
    },
    [queryClient, wsId],
  );
  const action = catalog.data === undefined ? undefined : epicAction(catalog.data);
  const dismissed = useMemo(() => (offers.data === undefined ? undefined : new Set(offers.data.dismissed)), [offers.data]);
  const controls = useMemo<EpicLookBackControls | undefined>(
    () => (on && action !== undefined && catalog.data?.capabilities.look_back !== false ? { label: action.label, busy: starting, start, dismissed, dismiss } : undefined),
    [on, action, catalog.data, starting, start, dismissed, dismiss],
  );
  const reducedText = on && catalog.data !== undefined && (action === undefined || !catalog.data.capabilities.look_back) ? BMAD_CAPABILITY_REDUCED_TEXT.look_back : undefined;
  return { controls, reducedText, failure };
}
