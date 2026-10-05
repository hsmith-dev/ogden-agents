import { PANE_CLOSE, TERMINAL_CLOSE, type Pane, type PaneState } from '@ogden-agents/shared';
import type { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { tokenNumber } from '@/ui/tokens';
import { cn } from '@/ui/utils';
import { MAX_NAME_LENGTH } from './layout-edit';
import { connectPane, type PaneConnection } from './pane-socket';
import { restartPane } from './panes-api';
import { RECONNECT_DELAYS_MS, STABLE_CONNECTION_MS } from './terminal-panel';
import { loadXterm, enableUnicode11 } from './xterm-setup';

/** How long a pane may print nothing after it started before the page offers Restart pane (spike 16.1 finding 2: Windows ConPTY can hold the first output back). */
export const SLOW_START_MS = 10_000;

/** Lines of scrollback xterm keeps in a pane (spike 16.1 finding 3). */
export const PANE_SCROLLBACK = 5_000;

/** The connection to a pane, as the view shows it. */
type Link = 'loading' | 'connected' | 'reconnecting' | 'disconnected' | 'tooMany' | 'failed' | 'gone' | 'developerOff';

const RETRY_CLOSES: ReadonlySet<number> = new Set([1001, 1006, TERMINAL_CLOSE.slowViewer]);

export interface PaneViewProps {
  wsId: string;
  pane: Pane;
  /** xterm's screen-reader mode (Settings, Appearance). */
  screenReaderMode: boolean;
  /** Close the pane (the page asks the server and refreshes its list). */
  onClose: (paneId: string) => void;
  /** Split this pane: a new one beside (`row`) or under (`column`) it. Absent: no split buttons. */
  onSplit?: ((paneId: string, direction: 'row' | 'column') => void) | undefined;
  /** Rename this pane. Absent: the name is not editable. */
  onRename?: ((paneId: string, title: string) => void) | undefined;
  /** Take keyboard focus when the terminal has loaded (a pane the user just opened). */
  focusOnOpen?: boolean | undefined;
  /** Why a split is not offered now (the limit of panes), in plain words. */
  splitDisabledReason?: string | undefined;
  className?: string;
}

/**
 * One terminal pane (epic 16, story 16.2; DESIGN.md Terminal panel): xterm
 * in the panel's dark box over the pane's socket. The first frame the page
 * sends is `attach` with its size; the server answers `reset` and the pane's
 * screen as it is (so a reload shows a full-screen program exactly), then
 * the live output. It says when the pane is starting, when it is slow to
 * start and when its program ended, and offers Restart pane for both.
 * After an abnormal close it reconnects as the chat terminal does. Nothing
 * typed or printed is kept or logged here.
 */
export function PaneView({ wsId, pane, screenReaderMode, onClose, onSplit, onRename, splitDisabledReason, focusOnOpen = false, className }: PaneViewProps) {
  const focusRef = useRef(focusOnOpen);
  focusRef.current = focusOnOpen;
  const [renaming, setRenaming] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const [link, setLink] = useState<Link>('loading');
  const [state, setState] = useState<PaneState>(pane.state);
  const [exitCode, setExitCode] = useState<number | null>(pane.exitCode);
  const [slow, setSlow] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | undefined>(undefined);
  const screenReader = useRef(screenReaderMode);
  screenReader.current = screenReaderMode;

  // Starting for too long: offer Restart pane.
  useEffect(() => {
    setSlow(false);
    if (state !== 'starting') return;
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const { Terminal, FitAddon, Unicode11Addon } = await loadXterm();
      const element = host.current;
      if (disposed || element === null) return;
      const style = getComputedStyle(element);
      const term = new Terminal({
        cursorBlink: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true,
        fontFamily: style.fontFamily,
        fontSize: tokenNumber('--type-mono-size', 13),
        scrollback: PANE_SCROLLBACK,
        screenReaderMode: screenReader.current,
        allowProposedApi: true,
        theme: { background: style.backgroundColor, foreground: style.color, cursor: style.color },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      enableUnicode11(term, Unicode11Addon);
      term.open(element);
      fit.fit();
      terminal.current = term;
      let connection: PaneConnection | undefined;
      let following = false;
      let tries = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let stable: ReturnType<typeof setTimeout> | undefined;
      let opened = false;
      const connect = () => {
        let frames = 0;
        connection = connectPane(pane.id, {
          size: () => ({ cols: term.cols, rows: term.rows }),
          onOpen: () => {
            opened = true;
            clearTimeout(stable);
            stable = setTimeout(() => (tries = 0), STABLE_CONNECTION_MS);
            setLink('connected');
          },
          onReset: () => {
            term.reset();
            frames = 0;
          },
          onBytes: (bytes) => {
            if (++frames > 1) tries = 0;
            term.write(bytes);
          },
          onState: (next) => {
            setState(next);
            if (next !== 'exited') setExitCode(null);
          },
          onExit: (code) => setExitCode(code),
          onSize: (cols, rows) => {
            if (cols === term.cols && rows === term.rows) return;
            following = true;
            try {
              term.resize(cols, rows);
            } finally {
              following = false;
            }
          },
          onClose: (code) => {
            clearTimeout(stable);
            stable = undefined;
            if (disposed) return;
            const delay = RETRY_CLOSES.has(code) ? RECONNECT_DELAYS_MS[tries] : undefined;
            if (delay !== undefined) {
              tries++;
              setLink('reconnecting');
              retry = setTimeout(() => {
                retry = undefined;
                if (disposed) return;
                connect();
                if (connection === undefined) setLink('disconnected');
              }, delay);
              return;
            }
            if (code === TERMINAL_CLOSE.tooManyViewers) setLink('tooMany');
            else if (code === PANE_CLOSE.developerModeOff) setLink('developerOff');
            else if (code === PANE_CLOSE.closed || (code === PANE_CLOSE.notAvailable && opened)) setLink('gone');
            else if (code === PANE_CLOSE.notAvailable) setLink('gone');
            else setLink('disconnected');
          },
        });
      };
      connect();
      if (connection === undefined) {
        term.dispose();
        terminal.current = undefined;
        setLink('failed');
        return;
      }
      const typing = term.onData((data) => connection?.type(data));
      const resizing = term.onResize(({ cols, rows }) => {
        if (!following) connection?.resize(cols, rows);
      });
      // One fit per frame: a divider drag changes the box many times a second, and each refit is a resize of the program.
      let frame: number | undefined;
      const observer = new ResizeObserver(() => {
        if (frame !== undefined) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (!disposed) fit.fit();
        });
      });
      observer.observe(element);
      if (focusRef.current) term.focus();
      cleanup = () => {
        clearTimeout(retry);
        clearTimeout(stable);
        observer.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
        typing.dispose();
        resizing.dispose();
        connection?.close();
        term.dispose();
        terminal.current = undefined;
      };
    })().catch(() => {
      if (!disposed) setLink('failed');
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [pane.id]);

  useEffect(() => {
    if (terminal.current !== undefined) terminal.current.options.screenReaderMode = screenReaderMode;
  }, [screenReaderMode]);

  const restart = () => {
    const term = terminal.current;
    setRestarting(true);
    setRestartError(undefined);
    restartPane(wsId, pane.id, { cols: term?.cols ?? 100, rows: term?.rows ?? 30 }).then(
      () => setRestarting(false),
      (failure: unknown) => {
        setRestarting(false);
        setRestartError(failure instanceof Error ? failure.message : "Ogden Agents couldn't restart that terminal. Try again.");
      },
    );
  };

  const words = restartError ?? linkWords(link) ?? stateWords(state, exitCode, slow);
  const canRestart = link === 'connected' && (state === 'exited' || (state === 'starting' && slow) || restartError !== undefined);
  return (
    <section
      aria-label={`${pane.title}`}
      data-testid="pane"
      data-pane-id={pane.id}
      data-state={state}
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-lg border-t border-signal bg-terminal p-3', className)}
    >
      <div className="flex items-center justify-between gap-2 text-terminal-foreground">
        {renaming && onRename !== undefined ? (
          <input
            autoFocus
            defaultValue={pane.title}
            aria-label="Terminal name"
            data-testid="pane-title-input"
            maxLength={MAX_NAME_LENGTH}
            className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-label text-terminal-foreground"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const title = event.currentTarget.value.trim();
                setRenaming(false);
                if (title !== '' && title !== pane.title) onRename(pane.id, title);
              } else if (event.key === 'Escape') setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            data-testid="pane-title"
            title={onRename === undefined ? undefined : 'Rename'}
            className="min-w-0 truncate text-left text-label text-terminal-foreground"
            onClick={() => onRename !== undefined && setRenaming(true)}
          >
            {pane.title}
          </button>
        )}
        <span className="flex items-center gap-2">
          {onSplit === undefined ? null : (
            <>
              <Button variant="outline" size="sm" onClick={() => onSplit(pane.id, 'row')} disabled={splitDisabledReason !== undefined} title={splitDisabledReason} data-testid="pane-split-row">
                Split right
              </Button>
              <Button variant="outline" size="sm" onClick={() => onSplit(pane.id, 'column')} disabled={splitDisabledReason !== undefined} title={splitDisabledReason} data-testid="pane-split-column">
                Split down
              </Button>
            </>
          )}
          {canRestart ? (
            <Button variant="outline" size="sm" onClick={restart} disabled={restarting} data-testid="pane-restart">
              Restart
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => onClose(pane.id)} data-testid="pane-close">
            Close
          </Button>
        </span>
      </div>
      <div ref={host} data-testid="pane-terminal" data-link={link} className="min-h-24 flex-1 bg-terminal font-mono text-terminal-foreground" />
      {words === undefined ? null : (
        <Text variant="caption" role="status" data-testid="pane-status" className="text-terminal-foreground">
          {words}
        </Text>
      )}
    </section>
  );
}

function linkWords(link: Link): string | undefined {
  switch (link) {
    case 'loading':
      return 'Opening the terminal';
    case 'reconnecting':
      return 'Reconnecting to the terminal';
    case 'disconnected':
      return 'The terminal is not connected. Reload to reconnect.';
    case 'tooMany':
      return 'Too many open views of this terminal. Close one, then reload.';
    case 'failed':
      return "The terminal couldn't open. Reload to try again.";
    case 'gone':
      return 'This terminal was closed.';
    case 'developerOff':
      return 'Terminals are only available in Developer mode.';
    case 'connected':
      return undefined;
  }
}

function stateWords(state: PaneState, exitCode: number | null, slow: boolean): string | undefined {
  if (state === 'starting') return slow ? 'This terminal is slow to start. You can restart it.' : 'Starting the terminal';
  if (state === 'exited') return exitCode === null ? 'The program in this terminal ended.' : `The program in this terminal ended with code ${exitCode}.`;
  return undefined;
}
