import type { Terminal } from '@xterm/xterm';

/**
 * What every xterm in the app is loaded with (epic 16, spike 16.1 finding 5):
 * xterm, the fit addon and the Unicode 11 addon, loaded only when a terminal
 * is shown. Without Unicode 11, xterm counts an emoji as one cell wide where
 * the program counts two, and the line goes out of line.
 */
export async function loadXterm() {
  const [{ Terminal }, { FitAddon }, { Unicode11Addon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-unicode11'),
    import('@xterm/xterm/css/xterm.css'),
  ]);
  return { Terminal, FitAddon, Unicode11Addon };
}

/** The Unicode 11 width table, on `term` (the addon needs xterm's proposed API, so `allowProposedApi` must be set when the terminal is made). */
export function enableUnicode11(term: Terminal, Unicode11Addon: new () => { activate(terminal: unknown): void; dispose(): void }): void {
  term.loadAddon(new Unicode11Addon() as never);
  term.unicode.activeVersion = '11';
}
