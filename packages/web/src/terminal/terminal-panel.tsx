import { TERMINAL_CLOSE } from '@ogden-agents/shared';
import { useEffect, useRef, useState } from 'react';
import { AGENT_NAME } from '@/chat/chat-api';
import { Text } from '@/ui/typography';
import { connectTerminal, type TerminalConnection } from './terminal-socket';

/** What the panel says under the terminal, if anything. */
type PanelStatus = 'loading' | 'connected' | 'ended' | 'disconnected' | 'failed';

const STATUS_WORDS: Partial<Record<PanelStatus, string>> = {
  loading: 'Opening the terminal',
  ended: `${AGENT_NAME} left the terminal.`,
  disconnected: 'The terminal is not connected. Reload to reconnect.',
  failed: "The terminal couldn't open. Reload to try again.",
};

/**
 * The session's terminal while it drives the chat (story 3.1, bare: the
 * design, banner and keyboard rules are entry 6): xterm, loaded only when
 * shown, over the session's terminal socket. Its colors and font are the
 * `terminal` tokens, read from the page.
 */
export function TerminalPanel({ sesId }: { sesId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PanelStatus>('loading');

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
      const element = host.current;
      if (disposed || element === null) return;
      const style = getComputedStyle(element);
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: style.fontFamily,
        theme: { background: style.backgroundColor, foreground: style.color, cursor: style.color },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      let connection: TerminalConnection | undefined;
      let ended = false;
      const connect = () => {
        connection = connectTerminal(sesId, {
          onOpen: () => {
            setStatus('connected');
            connection?.resize(term.cols, term.rows);
          },
          onBytes: (bytes) => term.write(bytes),
          onExit: () => {
            ended = true;
            setStatus('ended');
          },
          onClose: (code) => {
            // Fell behind a flood of output (story 3.1 review F2): start again from the recent output.
            if (code === TERMINAL_CLOSE.slowViewer && !ended && !disposed) {
              term.reset();
              connect();
              return;
            }
            setStatus((current) => (current === 'ended' ? current : 'disconnected'));
          },
        });
      };
      connect();
      if (connection === undefined) {
        term.dispose();
        setStatus('failed');
        return;
      }
      const typing = term.onData((data) => connection?.type(data));
      const resizing = term.onResize(({ cols, rows }) => connection?.resize(cols, rows));
      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);
      term.focus();
      cleanup = () => {
        observer.disconnect();
        typing.dispose();
        resizing.dispose();
        connection?.close();
        term.dispose();
      };
    })().catch(() => {
      if (!disposed) setStatus('failed');
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [sesId]);

  const words = STATUS_WORDS[status];
  return (
    <section aria-label={`${AGENT_NAME} terminal`} className="flex min-h-0 flex-1 flex-col gap-2 bg-terminal p-(--panel-padding)">
      <div ref={host} data-testid="terminal" data-status={status} className="min-h-0 flex-1 bg-terminal font-mono text-terminal-foreground" />
      {words === undefined ? null : (
        <Text variant="caption" role="status" data-testid="terminal-status" className="text-terminal-foreground">
          {words}
        </Text>
      )}
    </section>
  );
}
