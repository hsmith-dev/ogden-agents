import type { SessionDriver } from '@ogden-agents/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long "Switching..." waits for `session.driver_changed` before checking with the server (3.6 review F1). */
export const SWITCH_CONFIRM_MS = 8_000;

/** What the page says when the switch was neither seen nor confirmed in time. */
export const SWITCH_UNCONFIRMED = "Ogden Agents couldn't confirm the switch. Try again.";

export interface DriverSwitchOptions {
  /** Who drives now, from `session.driver_changed` (the view follows only that). */
  driver: SessionDriver;
  /** Sends the switch request; rejects when the server refuses it. */
  send(next: SessionDriver): Promise<unknown>;
  /** Reads the session again and answers its driver (`undefined` when it couldn't be read). */
  confirm(): Promise<SessionDriver | undefined>;
  /** A request that failed, or a switch that was not confirmed: the words to show. */
  onError(message: string, failure: unknown): void;
  timeoutMs?: number;
}

/**
 * One switch of the chat's driver at a time (story 3.6): `switchingTo` holds
 * the requested driver ("Switching...") until the driver changes. If the
 * request succeeded but no `session.driver_changed` arrives within
 * {@link SWITCH_CONFIRM_MS}, the session is read again: when it already has the
 * requested driver, the wait just ends; otherwise it ends with
 * {@link SWITCH_UNCONFIRMED}. So "Switching..." never stays for good.
 */
export function useDriverSwitch({ driver, send, confirm, onError, timeoutMs = SWITCH_CONFIRM_MS }: DriverSwitchOptions) {
  const [switchingTo, setSwitchingTo] = useState<SessionDriver | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Bumped on every end of a wait, so a late answer of an older one does nothing. */
  const attempt = useRef(0);
  const latest = useRef({ send, confirm, onError });
  latest.current = { send, confirm, onError };

  const stop = useCallback(() => {
    attempt.current += 1;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    setSwitchingTo(undefined);
  }, []);

  // The driver changed (as asked, or by itself): the wait is over.
  useEffect(() => stop(), [driver, stop]);
  useEffect(() => () => {
    attempt.current += 1;
    if (timer.current !== undefined) clearTimeout(timer.current);
  }, []);

  const start = useCallback(
    (next: SessionDriver) => {
      const mine = ++attempt.current;
      setSwitchingTo(next);
      latest.current.send(next).then(
        () => {
          if (mine !== attempt.current) return;
          timer.current = setTimeout(() => {
            timer.current = undefined;
            if (mine !== attempt.current) return;
            latest.current.confirm().then(
              (now) => {
                if (mine !== attempt.current) return;
                stop();
                if (now !== next) latest.current.onError(SWITCH_UNCONFIRMED, undefined);
              },
              (failure: unknown) => {
                if (mine !== attempt.current) return;
                stop();
                latest.current.onError(SWITCH_UNCONFIRMED, failure);
              },
            );
          }, timeoutMs);
        },
        (failure: unknown) => {
          if (mine !== attempt.current) return;
          stop();
          latest.current.onError(failure instanceof Error ? failure.message : "Ogden Agents couldn't switch this chat. Try again.", failure);
        },
      );
    },
    [stop, timeoutMs],
  );

  return { switchingTo, start };
}
