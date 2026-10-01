import { TERMINAL_CLOSE } from '@ogden-agents/shared';
import type { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { AGENT_NAME } from '@/chat/chat-api';
import { tokenNumber } from '@/ui/tokens';
import { cn } from '@/ui/utils';
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


export interface TerminalPanelProps {
  sesId: string;
  /** xterm's screen-reader mode (Settings → Appearance, "Terminal screen-reader mode"; off by default). */
  screenReaderMode: boolean;
  className?: string;
}

/**
 * The session's terminal while it drives the chat (stories 3.1, 3.6; DESIGN.md
 * Terminal panel): dark in both themes, `rounded.lg`, a hairline signal top
 * edge, xterm in Geist Mono at the `mono` size (in both densities) with the
 * panel's inner padding, loaded only when shown.
 * The socket's first frame is `attach` with the size; a `size` frame (another
 * viewer resized) resizes xterm to match. Keyboard focus goes into xterm when
 * the panel opens. Nothing typed or printed is kept or logged here.
 */
export function TerminalPanel({ sesId, screenReaderMode, className }: TerminalPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus>('loading');
  // Read when xterm is created; later changes go through the effect below.
  const screenReader = useRef(screenReaderMode);
  screenReader.current = screenReaderMode;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
      const element = host.current;
      if (disposed || element === null) return;
      const style = getComputedStyle(element);
      const term = new Terminal({
        // Reduced motion (DESIGN.md Motion): a steady cursor.
        cursorBlink: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true,
        fontFamily: style.fontFamily,
        // The `mono` type size of Comfortable density, also in Compact (DESIGN.md Terminal panel).
        fontSize: tokenNumber('--type-mono-size', 13),
        screenReaderMode: screenReader.current,
        theme: { background: style.backgroundColor, foreground: style.color, cursor: style.color },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      terminal.current = term;
      let connection: TerminalConnection | undefined;
      let ended = false;
      /** True while xterm takes a size the server sent: that resize is not this viewer's to send back. */
      let following = false;
      const connect = () => {
        connection = connectTerminal(sesId, {
          size: () => ({ cols: term.cols, rows: term.rows }),
          onOpen: () => setStatus('connected'),
          onBytes: (bytes) => term.write(bytes),
          onSize: (cols, rows) => {
            if (cols === term.cols && rows === term.rows) return;
            following = true;
            try {
              term.resize(cols, rows);
            } finally {
              following = false;
            }
          },
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
        terminal.current = undefined;
        setStatus('failed');
        return;
      }
      const typing = term.onData((data) => connection?.type(data));
      const resizing = term.onResize(({ cols, rows }) => {
        if (!following) connection?.resize(cols, rows);
      });
      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);
      term.focus();
      cleanup = () => {
        observer.disconnect();
        typing.dispose();
        resizing.dispose();
        connection?.close();
        term.dispose();
        terminal.current = undefined;
      };
    })().catch(() => {
      if (!disposed) setStatus('failed');
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [sesId]);

  useEffect(() => {
    if (terminal.current !== undefined) terminal.current.options.screenReaderMode = screenReaderMode;
  }, [screenReaderMode]);

  const words = STATUS_WORDS[status];
  return (
    <section
      aria-label={`${AGENT_NAME} terminal`}
      data-testid="terminal-panel"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-lg border-t border-signal bg-terminal p-3', className)}
    >
      <div ref={host} data-testid="terminal" data-status={status} className="min-h-0 flex-1 bg-terminal font-mono text-terminal-foreground" />
      {words === undefined ? null : (
        <Text variant="caption" role="status" data-testid="terminal-status" className="text-terminal-foreground">
          {words}
        </Text>
      )}
    </section>
  );
}
