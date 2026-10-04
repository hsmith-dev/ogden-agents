import { applyBmadPieceChoice, BMAD_COMING_SOON_LABEL, type BmadPiece } from '@ogden-agents/shared';
import { Badge } from '@/ui/badge';

/**
 * What the two BMad Method choosers share (story 10.8): Workspace settings'
 * section (switches, per project) and Settings → New projects (checkboxes,
 * the app-wide default).
 */

/**
 * Whether `piece`, off now, may be turned on: turning it on would turn on
 * only pieces this install ships (it and what it still needs), by the shared
 * dependency rule. `isAvailable` is `undefined` while the install's pieces
 * load, when nothing can be turned on. Turning a piece off is always allowed,
 * so callers ask only for one that is off.
 */
export function canTurnOnBmadPiece(current: readonly BmadPiece[], piece: BmadPiece, isAvailable: ((piece: BmadPiece) => boolean) | undefined): boolean {
  if (isAvailable === undefined) return false;
  return applyBmadPieceChoice(current, piece, true).pieces.every((each) => current.includes(each) || isAvailable(each));
}

/** The Coming soon badge after a piece's sentence, with the space before it. */
export function ComingSoonBadge({ testId }: { testId: string }) {
  return (
    <>
      {' '}
      <Badge variant="outline" data-testid={testId}>
        {BMAD_COMING_SOON_LABEL}
      </Badge>
    </>
  );
}
