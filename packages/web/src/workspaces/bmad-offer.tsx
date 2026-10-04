import { BMAD_OFFER_CHOOSE, BMAD_OFFER_NOT_NOW, BMAD_OFFER_TEXT, WORKSPACE_SETTINGS_BMAD_ANCHOR } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { bmadOfferVisible, useBmadDetection, useDismissBmadOffer } from './bmad-detection-api';
import { useWorkspaceSettings } from './workspace-settings-api';

/**
 * The offer on a project whose repo already uses BMad Method (CAP-19,
 * E10-R5; story 10.3): one quiet notice while the repo has `_bmad/`, every
 * piece is off and the user hasn't answered Not now. **Choose features**
 * opens the project's BMad Method settings (it turns nothing on itself);
 * **Not now** hides it at once and for good in this project. It never
 * shows while the detection or the pieces are unknown, and a failed Not
 * now says why in place.
 */
export function BmadOffer({ wsId }: { wsId: string }) {
  const detection = useBmadDetection(wsId);
  const settings = useWorkspaceSettings(wsId);
  const dismiss = useDismissBmadOffer(wsId);
  // Not now hides it in the same render as the click; only a failed answer brings it back, saying why.
  const [answered, setAnswered] = useState(false);
  if (answered && !dismiss.isError) return null;
  if (!bmadOfferVisible(detection.data, settings.data?.bmadPieces)) return null;
  return (
    <Notice
      variant={dismiss.isError ? 'blocked' : 'info'}
      className="max-w-(--space-chat-column)"
      data-testid="bmad-offer"
      action={
        <span className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/w/$wsId/settings" params={{ wsId }} hash={WORKSPACE_SETTINGS_BMAD_ANCHOR} data-testid="bmad-offer-choose">
              {BMAD_OFFER_CHOOSE}
            </Link>
          </Button>
          <Button variant="ghost" onClick={() => {
              setAnswered(true);
              dismiss.mutate();
            }} data-testid="bmad-offer-not-now">
            {BMAD_OFFER_NOT_NOW}
          </Button>
        </span>
      }
    >
      {dismiss.isError ? <span role="alert">{dismiss.error.message}</span> : BMAD_OFFER_TEXT}
    </Notice>
  );
}
