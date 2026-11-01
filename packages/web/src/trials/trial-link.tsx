import { TRIAL_PART_OF_LABEL } from '@ogden-agents/shared';
import { Columns } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useTrials } from './trials-api';

/**
 * A worktree chat's link to the try it is part of (27.8), in its header
 * beside the branch: nothing for a chat that is part of none.
 */
export function TrialLink({ wsId, sesId }: { wsId: string; sesId: string }) {
  const trials = useTrials(wsId);
  const trial = trials.data?.find((each) => each.sessionIds.some((id) => id === sesId));
  if (trial === undefined) return null;
  return (
    <Link
      to="/w/$wsId/try/$tryId"
      params={{ wsId, tryId: trial.id }}
      data-testid="session-try-link"
      className="inline-flex min-h-(--control-height) shrink-0 items-center gap-1 rounded-md px-1 text-caption text-muted-foreground underline-offset-4 hover:underline [&_svg]:size-(--icon)"
    >
      <Columns aria-hidden />
      <span className="max-sm:sr-only">{TRIAL_PART_OF_LABEL}</span>
    </Link>
  );
}
