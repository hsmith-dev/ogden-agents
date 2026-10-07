import { useSyncExternalStore } from 'react';
import type { TourStep } from './tour-model';

/**
 * The tour's own state, outside React (as `sidebar-data`'s `collapsedStore`
 * is): `TourController` arms and opens it from the onboarding query, and
 * Settings' Replay action (AC4) reaches it from a different page entirely,
 * before that page's project is even open. Nothing here is kept between
 * reloads — a fresh run starts closed, which is right: a reload never
 * re-arms the tour (AC3), and Replay asks for it again each time.
 */

export interface TourState {
  open: boolean;
  steps: readonly TourStep[];
  index: number;
  /** Settings' Replay action (AC4): the project whose page should start the tour once it is ready there. */
  pendingReplayWsId: string | undefined;
}

let state: TourState = { open: false, steps: [], index: 0, pendingReplayWsId: undefined };
const listeners = new Set<() => void>();

function setState(next: TourState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTourSnapshot(): TourState {
  return state;
}

/** Starts (or restarts) the tour at its first step, for this project's steps; clears any pending replay request. */
export function startTour(steps: readonly TourStep[]): void {
  setState({ open: true, steps, index: 0, pendingReplayWsId: undefined });
}

/**
 * Closes the tour — Skip, Done, or an outside interaction (AC4, AC5) all
 * call this. The index resets too, so nothing of this run is left over for
 * the next one (no partial highlight, ever).
 */
export function closeTour(): void {
  if (!state.open) return;
  setState({ ...state, open: false, index: 0 });
}

export function nextStep(): void {
  if (!state.open) return;
  if (state.index >= state.steps.length - 1) {
    closeTour();
    return;
  }
  setState({ ...state, index: state.index + 1 });
}

export function backStep(): void {
  if (!state.open || state.index === 0) return;
  setState({ ...state, index: state.index - 1 });
}

/** Settings' Replay action (AC4): the next time `wsId`'s page is ready, the tour starts there. */
export function requestTourReplay(wsId: string): void {
  setState({ ...state, pendingReplayWsId: wsId });
}

export function useTourState(): TourState {
  return useSyncExternalStore(subscribeTour, getTourSnapshot);
}
