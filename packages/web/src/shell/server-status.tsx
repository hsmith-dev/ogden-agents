import { useServerStatus, type ServerStatus as Status } from '@/events/event-stream';
import { StateGlyph } from '@/ui/state-glyph';

const WORDS: Record<Status, string> = {
  connecting: 'Connecting...',
  connected: 'Running on this computer',
  reconnecting: 'Reconnecting...',
};

/**
 * The sidebar footer's server line, from the live WebSocket. A live server
 * shows the working glyph (it reports a real running process); while the
 * socket is gone it shows the idle glyph.
 */
export function ServerStatus() {
  const status = useServerStatus();
  return (
    <div data-testid="server-status" data-status={status} role="status" className="flex h-(--row-height) items-center px-2 md:max-lg:justify-center md:max-lg:px-0">
      <StateGlyph state={status === 'connected' ? 'working' : 'idle'} label={WORDS[status]} labelMode="rail" />
    </div>
  );
}
