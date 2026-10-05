import { BMAD_DOWNLOAD_LABEL, BMAD_DOWNLOAD_OFFLINE_MESSAGE, BMAD_DOWNLOADING_TEXT, BMAD_NOT_DOWNLOADED_TEXT } from '@ogden-agents/shared';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { downloadBmadSource } from './planning-api';

/**
 * The Board's notice when the pinned BMad Method isn't downloaded yet
 * (`bmad_not_downloaded`, story 4.14, AD-13): one sentence and **Download
 * BMad Method**, which asks the server to download and verify it
 * (`POST /api/v1/bmad/source`), shows that it is downloading meanwhile, then
 * calls `onDownloaded` so the Board fetches again. A failure shows the
 * server's plain reason (offline, or a download that didn't match) and keeps
 * the button. Nothing downloads until the user clicks.
 */
export function BmadDownloadPrompt({ onDownloaded }: { onDownloaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const download = () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    downloadBmadSource().then(
      () => {
        setBusy(false);
        onDownloaded();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : BMAD_DOWNLOAD_OFFLINE_MESSAGE);
      },
    );
  };
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-2" data-testid="bmad-download-prompt">
      <Notice
        action={
          <Button data-testid="bmad-download" aria-disabled={busy} onClick={download}>
            {BMAD_DOWNLOAD_LABEL}
          </Button>
        }
      >
        {BMAD_NOT_DOWNLOADED_TEXT}
      </Notice>
      {busy ? (
        <Text variant="caption" role="status" data-testid="bmad-downloading">
          {BMAD_DOWNLOADING_TEXT}
        </Text>
      ) : null}
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="bmad-download-error">
          {error}
        </Text>
      )}
    </div>
  );
}
