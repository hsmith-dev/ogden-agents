/**
 * Core's `TerminalPort` over `node-pty` (story 3.1): the agent's own CLI in a
 * pseudo-terminal the server owns, through story 9.1's lazy loader, so a
 * computer where `node-pty` can't load still runs everything else (AD-19).
 *
 * Nothing here logs what the program prints or what is typed into it (AD-16).
 */
import type { PaneProcess, TerminalPort, TerminalProcess } from '@ogden-agents/core';
import { loadPty as defaultLoadPty, type PtyLoader } from './index.js';
import { createPaneMirror, type MirrorModules } from './pane-mirror.js';

/** The most lines of scrollback a pane's mirror may be asked to keep. */
const MAX_SCROLLBACK_LINES = 50_000;

export function createPtyTerminalPort(loadPty: PtyLoader = defaultLoadPty, mirrorModules?: MirrorModules): TerminalPort {
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

    async openPane({ file, args, cwd, env, cols, rows, scrollback }) {
      const loaded = await loadPty();
      if (!loaded.ok) throw new Error(loaded.reason);
      // The mirror first, so not one byte the program prints is missed by it.
      const mirror = await createPaneMirror({ cols, rows, scrollback: Math.min(Math.max(Math.floor(scrollback ?? 5_000), 0), MAX_SCROLLBACK_LINES) }, mirrorModules);
      let pty: ReturnType<typeof loaded.spawnHidden>;
      try {
        // An argument array and no shell: nothing in `args` is ever interpreted.
        pty = loaded.spawnHidden(file, args, { env, cwd, cols, rows });
      } catch (error) {
        mirror.dispose();
        throw error;
      }
      const data = new Set<(data: string) => void>();
      let ended = false;
      pty.onData((chunk) => {
        if (ended) return;
        // Parsed before any viewer hears it, so a snapshot taken at any moment is exactly what came before.
        mirror.write(chunk);
        for (const listener of [...data]) listener(chunk);
      });
      const pane: PaneProcess = {
        pid: pty.pid,
        onData(listener) {
          data.add(listener);
          return () => void data.delete(listener);
        },
        onExit(listener) {
          pty.onExit(({ exitCode, signal }) => listener({ exitCode: signal === null ? exitCode : null }));
        },
        attach(onSnapshot, onData) {
          let live = false;
          let subscribed = true;
          const waiting: string[] = [];
          // Subscribed now; what arrives before the snapshot is ready comes after it, in order.
          const listener = (chunk: string) => {
            if (live) onData(chunk);
            else waiting.push(chunk);
          };
          data.add(listener);
          mirror.snapshot((snapshot) => {
            if (!subscribed) return;
            onSnapshot(snapshot);
            live = true;
            for (const chunk of waiting.splice(0)) onData(chunk);
          });
          return () => {
            subscribed = false;
            data.delete(listener);
          };
        },
        screenLines: (count) => new Promise<string[]>((resolve) => mirror.lastLines(count, resolve)),
        write: (text) => pty.write(text),
        resize(columns, lines) {
          pty.resize?.(columns, lines);
          mirror.resize(columns, lines);
        },
        kill() {
          ended = true;
          data.clear();
          pty.kill();
          mirror.dispose();
        },
      };
      return pane;
    },
  };
}
