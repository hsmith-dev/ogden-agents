/**
 * A pane's screen, mirrored in memory (epic 16, spike 16.1 findings 3, 12):
 * a headless xterm that parses everything the pane prints, so a viewer that
 * comes later is given the screen as it is now by serializing it. A raw tail
 * of the output cannot do that for a full-screen program (it painted once, a
 * long time ago), and on Windows ConPTY's byte stream is not the program's
 * bytes anyway. Pure JavaScript, loaded lazily; about 20 MB per pane at 5,000
 * lines of scrollback and 120 columns, a snapshot in about 60 to 130 ms.
 *
 * What it holds is the user's content: in memory only, never logged, evented
 * or stored (AD-6, AD-16).
 */

/** What {@link createPaneMirror} needs of `@xterm/headless` and `@xterm/addon-serialize`; replaced in tests. */
export interface MirrorModules {
  Terminal: new (options: { cols: number; rows: number; scrollback: number; allowProposedApi: boolean }) => HeadlessTerminal;
  SerializeAddon: new () => HeadlessSerializer;
  /** The Unicode 11 width table, as the page's xterm uses (emoji are two cells), so a replayed screen lays out as the page drew it. Optional for stand-ins. */
  Unicode11Addon?: new () => unknown;
}

interface HeadlessTerminal {
  write(data: string, callback?: () => void): void;
  resize(cols: number, rows: number): void;
  loadAddon(addon: unknown): void;
  unicode?: { activeVersion: string };
  dispose(): void;
}

interface HeadlessSerializer {
  serialize(options?: { scrollback?: number }): string;
}

export interface PaneMirror {
  /** Parses `data`; in order, after everything written before. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /**
   * Calls `done` with the serialized screen once everything written before
   * this call has been parsed, and nothing written after it: the call runs
   * inside the parser's own loop. Never called after {@link dispose}.
   */
  snapshot(done: (snapshot: string) => void): void;
  /** Frees the screen. Later calls do nothing. */
  dispose(): void;
}

export interface PaneMirrorOptions {
  cols: number;
  rows: number;
  scrollback: number;
}

type Loaded = { Terminal?: unknown; default?: { Terminal?: unknown; SerializeAddon?: unknown; Unicode11Addon?: unknown }; SerializeAddon?: unknown; Unicode11Addon?: unknown };

/** Both packages are CommonJS: their classes are named exports or on `default`, whichever the loader gives. */
async function loadModules(): Promise<MirrorModules> {
  const headless = (await import('@xterm/headless')) as unknown as Loaded;
  const serialize = (await import('@xterm/addon-serialize')) as unknown as Loaded;
  const Terminal = headless.Terminal ?? headless.default?.Terminal;
  const SerializeAddon = serialize.SerializeAddon ?? serialize.default?.SerializeAddon;
  const unicode = (await import('@xterm/addon-unicode11')) as unknown as Loaded;
  const Unicode11Addon = unicode.Unicode11Addon ?? unicode.default?.Unicode11Addon;
  if (typeof Terminal !== 'function' || typeof SerializeAddon !== 'function') throw new Error('the terminal mirror could not be loaded');
  return { Terminal, SerializeAddon, Unicode11Addon } as MirrorModules;
}

export async function createPaneMirror(options: PaneMirrorOptions, modules?: MirrorModules): Promise<PaneMirror> {
  const { Terminal, SerializeAddon, Unicode11Addon } = modules ?? (await loadModules());
  const term = new Terminal({ cols: options.cols, rows: options.rows, scrollback: options.scrollback, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  if (Unicode11Addon !== undefined && term.unicode !== undefined) {
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
  }
  let disposed = false;
  return {
    write(data) {
      if (disposed) return;
      try {
        term.write(data);
      } catch {
        // xterm refuses data once 50 MB wait unparsed (a flood outran the parser): this chunk is not in the mirror; the pane goes on.
      }
    },
    resize(cols, rows) {
      // In the parser's queue, so what the program printed at the old size is parsed at the old size.
      if (!disposed) term.write('', () => !disposed && term.resize(cols, rows));
    },
    snapshot(done) {
      if (disposed) return;
      // An empty write is a marker in the parser's queue: its callback runs right after everything before it.
      term.write('', () => {
        if (!disposed) done(serializer.serialize({ scrollback: options.scrollback }));
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      term.dispose();
    },
  };
}
