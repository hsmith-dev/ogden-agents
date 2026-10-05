import { LOOK_BACK_FAILED } from '@ogden-agents/shared';
import { useCallback, useRef, useState } from 'react';
import { startLookBack } from './planning-api';

/** Look back on an epic (story 7.1): given only with Retrospectives on; `onStarted` opens the new session. */
export interface BoardLookBack {
  onStarted: (sessionId: string) => void;
}

/**
 * Starts a look-back from an epic's header, one at a time. A refusal
 * (`scripts_not_trusted`, a missing epic, …) says why in the board's alert
 * line, in the server's plain words.
 */
export function useBoardLookBack(wsId: string, lookBack: BoardLookBack | undefined) {
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
  return { onLookBack: lookBack === undefined ? undefined : start, lookingBack: starting, lookBackFailure: failure };
}
