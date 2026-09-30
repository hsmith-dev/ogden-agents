/**
 * Core's `TerminalPort` over `node-pty` (story 3.1): the agent's own CLI in a
 * pseudo-terminal the server owns, through story 9.1's lazy loader, so a
 * computer where `node-pty` can't load still runs everything else (AD-19).
 *
 * Nothing here logs what the program prints or what is typed into it (AD-16).
 */
import type { TerminalPort, TerminalProcess } from '@ogden-agents/core';
import { loadPty as defaultLoadPty, type PtyLoader } from './index.js';

export function createPtyTerminalPort(loadPty: PtyLoader = defaultLoadPty): TerminalPort {
  return {
    async available() {
      const loaded = await loadPty();
      return loaded.ok ? { ok: true } : { ok: false, reason: loaded.reason };
    },

    async open({ file, args, cwd, env, cols, rows }) {
      const loaded = await loadPty();
      if (!loaded.ok) throw new Error(loaded.reason);
      // An argument array and no shell: nothing in `args` is ever interpreted.
      const pty = loaded.spawnHidden(file, args, { env, cwd, cols, rows });
      const data = new Set<(data: string) => void>();
      pty.onData((chunk) => {
        for (const listener of [...data]) listener(chunk);
      });
      const cli: TerminalProcess = {
        onData(listener) {
          data.add(listener);
          return () => void data.delete(listener);
        },
        onExit(listener) {
          pty.onExit(({ exitCode, signal }) => listener({ exitCode: signal === null ? exitCode : null }));
        },
        write: (text) => pty.write(text),
        resize: (columns, lines) => pty.resize?.(columns, lines),
        kill: () => pty.kill(),
      };
      return cli;
    },
  };
}
