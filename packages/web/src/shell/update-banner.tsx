import { useState } from 'react';
import { useUpdateNotice } from '@/updates/update-api';
import { availableSentence, HOW_TO_UPDATE, readDismissed, updateCommand, writeDismissed } from '@/updates/update-model';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';

/**
 * "Ogden 0.5.0 is available" (story 13.7, E13-R7): a quiet, dismissible
 * banner (a polite status, not a modal) with the command that updates, shown
 * when the server found a newer version on npm. Dismissing it hides that
 * version in this browser; a newer one shows it again. It reads the server's
 * notice only: the browser never asks npm.
 */
export function UpdateBanner() {
  const { data } = useUpdateNotice();
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const available = data?.available;
  if (data === undefined || available === null || available === undefined || dismissed.includes(available.version)) return null;
  return (
    <Banner
      data-testid="update-banner"
      action={
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Dismiss the notice about Ogden ${available.version}`}
          onClick={() => {
            writeDismissed(available.version);
            setDismissed((list) => [...list, available.version]);
          }}
        >
          Dismiss
        </Button>
      }
    >
      {availableSentence(available)} {HOW_TO_UPDATE} <code className="font-mono">{updateCommand(data, available)}</code> in a terminal.
    </Banner>
  );
}
