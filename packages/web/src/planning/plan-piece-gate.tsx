import { type BmadPiece, FEATURE_OFF_MESSAGE, PLAN_OPEN_SETTINGS_LABEL, PLAN_PROJECT_LOADING_TEXT } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * The Plan and Board pages' piece gate (story 4.6, Board's since 4.9; AD-22):
 * with `piece` off in the project, the feature-off notice and a link to its
 * settings, and nothing BMad is asked for (no setup panel, no catalog, no
 * tickets). While the settings load, a skeleton; when they can't be read,
 * why (never the page, whose setup panel could run with the piece off); once
 * the piece is on, `children`.
 */
export function PlanPieceGate({ wsId, piece, children }: { wsId: string; piece: BmadPiece; children: ReactNode }) {
  const settings = useWorkspaceSettings(wsId);
  if (settings.isError) {
    return (
      <Text variant="caption" role="alert" data-testid="plan-settings-error">
        {settings.error.message}
      </Text>
    );
  }
  if (settings.data === undefined) {
    return (
      <div className="flex flex-col gap-2" data-testid="plan-loading">
        <Skeleton />
        <span role="status" className="sr-only">
          {PLAN_PROJECT_LOADING_TEXT}
        </span>
      </div>
    );
  }
  if (!settings.data.bmadPieces.includes(piece)) {
    return (
      <Notice
        className="max-w-(--space-chat-column)"
        data-testid="plan-feature-off"
        action={
          <Button variant="outline" asChild>
            <Link to="/w/$wsId/settings" params={{ wsId }} data-testid="plan-open-settings">
              {PLAN_OPEN_SETTINGS_LABEL}
            </Link>
          </Button>
        }
      >
        {FEATURE_OFF_MESSAGE}
      </Notice>
    );
  }
  return <>{children}</>;
}
