import { BMAD_NEW_PROJECTS_LINK, BMAD_REPO_HAS_BMAD_TEXT, newProjectsDefaultText, type BmadPiece } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useNewProjectDefaults } from '@/settings/new-project-defaults';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { useBmadDetection } from '@/workspaces/bmad-detection-api';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * The two slots of a project's BMad Method section (story 10.7; CAP-19,
 * E10-R7), filled from what the server says:
 *
 * - `offerSlot`: a quiet note when the project's repo already has `_bmad/`
 *   and every piece is off. It is context, not the offer: no buttons (the
 *   section's own switches turn pieces on), shown whatever the offer's Not
 *   now said.
 * - `defaultSlot`: the app-wide default for new projects in one line, with
 *   a link to Settings → New projects.
 *
 * Each hook answers `undefined` (no slot at all) while its answer is
 * unknown: loading, or a failed request.
 */

/** The repo note's view. */
export function BmadRepoNote() {
  return <Notice data-testid="bmad-repo-note">{BMAD_REPO_HAS_BMAD_TEXT}</Notice>;
}

/** The default line's view: what new projects start with, and where to change it. */
export function NewProjectsDefaultLine({ pieces }: { pieces: readonly BmadPiece[] }) {
  return (
    <Text variant="caption" data-testid="bmad-new-projects-default">
      {newProjectsDefaultText(pieces)}{' '}
      <Link to="/settings/new-projects" className="text-foreground underline underline-offset-4" data-testid="bmad-new-projects-link">
        {BMAD_NEW_PROJECTS_LINK}
      </Link>
    </Text>
  );
}

/** The repo note when the repo has `_bmad/` and every piece is off; otherwise (or while unknown) `undefined`. */
export function useBmadRepoNoteSlot(wsId: string): ReactNode | undefined {
  const detection = useBmadDetection(wsId);
  const settings = useWorkspaceSettings(wsId);
  if (detection.isError || settings.isError) return undefined;
  const hasBmad = detection.data?.hasBmad === true;
  const allOff = settings.data !== undefined && settings.data.bmadPieces.length === 0;
  return hasBmad && allOff ? <BmadRepoNote /> : undefined;
}

/** The default line once the default is known; `undefined` while it loads or if it couldn't. */
export function useNewProjectsDefaultSlot(): ReactNode | undefined {
  const defaults = useNewProjectDefaults();
  if (defaults.isError || defaults.data === undefined) return undefined;
  return <NewProjectsDefaultLine pieces={defaults.data.bmadPieces} />;
}
