import { ArrowClockwise, Copy } from '@phosphor-icons/react';
import { useState } from 'react';
import type { StoppedReason } from '@/events/event-stream';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';

export const LAUNCH_COMMAND = 'npx ogden-agents';

const TITLES: Record<StoppedReason, string> = {
  quit: 'Ogden Agents has stopped.',
  restart: 'Ogden Agents is updating.',
  unreachable: 'Ogden Agents is not running.',
};

/**
 * The full-surface state once the server has gone (EXPERIENCE.md State
 * Patterns: Server stopped), in every open tab: after Quit, during a restart
 * for an update, or when it has been unreachable for a while. The server is
 * gone, so nothing here talks to it.
 */
export function ServerStopped({ reason = 'quit' }: { reason?: StoppedReason | undefined }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const onCopy = () => {
    navigator.clipboard.writeText(LAUNCH_COMMAND).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };
  return (
    <main data-testid="server-stopped" data-reason={reason} className="flex min-h-dvh flex-col">
      <PageBody>
        <EmptyState
          title={TITLES[reason]}
          description={
            reason === 'restart' ? (
              <>
                Reload this page in a moment, or run <code>{LAUNCH_COMMAND}</code> to open it again.
              </>
            ) : (
              <>
                Run <code>{LAUNCH_COMMAND}</code> to start it again.
              </>
            )
          }
          actions={
            <>
              <Button variant="outline" onClick={onCopy}>
                <Copy aria-hidden />
                {copy === 'copied' ? 'Copied' : 'Copy command'}
              </Button>
              {reason === 'quit' ? null : (
                <Button variant="outline" onClick={() => window.location.reload()}>
                  <ArrowClockwise aria-hidden />
                  Reload
                </Button>
              )}
            </>
          }
          footnote={copy === 'failed' ? "Couldn't copy. Type the command in a terminal." : undefined}
        />
      </PageBody>
    </main>
  );
}
