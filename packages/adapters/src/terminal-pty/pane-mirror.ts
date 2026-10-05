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
}

interface HeadlessTerminal {
  write(data: string, callback?: () => void): void;
  resize(cols: number, rows: number): void;
  loadAddon(addon: unknown): void;
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

type Loaded = { Terminal?: unknown; default?: { Terminal?: unknown; SerializeAddon?: unknown }; SerializeAddon?: unknown };

/** Both packages are CommonJS: their classes are named exports or on `default`, whichever the loader gives. */
async function loadModules(): Promise<MirrorModules> {
  const headless = (await import('@xterm/headless')) as unknown as Loaded;
  const serialize = (await import('@xterm/addon-serialize')) as unknown as Loaded;
  const Terminal = headless.Terminal ?? headless.default?.Terminal;
  const SerializeAddon = serialize.SerializeAddon ?? serialize.default?.SerializeAddon;
  if (typeof Terminal !== 'function' || typeof SerializeAddon !== 'function') throw new Error('the terminal mirror could not be loaded');
  return { Terminal, SerializeAddon } as MirrorModules;
}

export async function createPaneMirror(options: PaneMirrorOptions, modules?: MirrorModules): Promise<PaneMirror> {
  const { Terminal, SerializeAddon } = modules ?? (await loadModules());
  const term = new Terminal({ cols: options.cols, rows: options.rows, scrollback: options.scrollback, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  let disposed = false;
  return {
    write(data) {
      if (!disposed) term.write(data);
    },
    resize(cols, rows) {
      if (!disposed) term.resize(cols, rows);
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
