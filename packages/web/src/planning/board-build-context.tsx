import { createContext, useContext } from 'react';

/**
 * What the board's Build this story does, for the detail sheet that opens over
 * it (story 11.3): the board owns the start (its Build dialog and its alerts),
 * the sheet only asks. `undefined` outside a board with Unattended builds on.
 */
export interface BoardBuildActions {
  onBuild: (ref: string) => void;
  /** While a build is being started: every Build waits. */
  building: boolean;
}

export const BoardBuildContext = createContext<BoardBuildActions | undefined>(undefined);

export function useBoardBuildActions(): BoardBuildActions | undefined {
  return useContext(BoardBuildContext);
}
