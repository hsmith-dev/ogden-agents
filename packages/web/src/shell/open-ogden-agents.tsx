import { Copy } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { EmptyState, PageBody } from '@/ui/page';
import { LAUNCH_COMMAND } from './server-stopped';

/**
 * The launch state (EXPERIENCE.md State Patterns: Unauthenticated; AD-15 as
 * amended): a tab without a token (a bookmark, a typed URL, a tab restored
 * after the server restarted) or whose token the server refused. The app's
 * files load without a token, so this is the app's own page; nothing here
 * talks to the server. Opening the app again through the launcher gives the
 * new tab its own token. The shortcut clause joins the copy with story 2.4.
 */
export function OpenOgdenAgents() {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(LAUNCH_COMMAND).then(
        () => setCopy('copied'),
        () => setCopy('failed'),
      );
    } catch {
      setCopy('failed');
    }
  };
  return (
    <main data-testid="open-ogden-agents" className="flex min-h-dvh flex-col">
      <PageBody>
        <EmptyState
          title="Open Ogden Agents"
          description={
            <>
              This tab isn't connected. Run <code>{LAUNCH_COMMAND}</code> in a terminal.
            </>
          }
          actions={
            <Button variant="outline" onClick={onCopy}>
              <Copy aria-hidden />
              {copy === 'copied' ? 'Copied' : 'Copy command'}
            </Button>
          }
          footnote={
            copy === 'failed' ? <span role="status">Couldn't copy. Type the command in a terminal.</span> : undefined
          }
        />
      </PageBody>
    </main>
  );
}
