/**
 * Terminal panes' wiring (epic 16, story 16.2): core's pane use-cases over
 * the `terminal-pty` port, the user's own shell and the pane environment.
 * Split out of `start.ts` to keep it short.
 */
import { createPaneLaunchers, createPanePidRecords, defaultPaneShell, sweepPanePids, nodeDetectSystem, PANE_LAUNCHERS, paneEnvironment, type PaneShell } from '@ogden-agents/adapters';
import type { PaneLaunchers } from '@ogden-agents/core';
import { createPanes, type Core, type Panes, type TerminalPort } from '@ogden-agents/core';
import { isAbsolute, relative } from 'node:path';
import type { StartOptions } from './start-types.js';
import type { TestHooks } from './test-hooks.js';

/** Whether `path` is inside `folder` (a folder of the same prefix is not). */
const inside = (folder: string, path: string): boolean => {
  const from = relative(folder, path);
  return from !== '' && !from.startsWith('..') && !isAbsolute(from);
};

export interface PanesWiringOptions {
  options: Pick<StartOptions, 'paneShell' | 'paneLaunchers'>;
  hooks: Pick<TestHooks, 'paneShell' | 'panePath'>;
  core: Pick<Core, 'entities' | 'installSettings' | 'events' | 'paneStore' | 'terminalsSettings'>;
  /** The data folder: the pids of the panes' programs are recorded in it. */
  dataDir: string;
  terminal: TerminalPort;
  onError: (error: unknown) => void;
  /** Told how many programs the sweep stopped and how many records it dropped (counts only). */
  onSweep: (result: { stopped: number; dropped: number }) => void;
}

export function createPanesWiring({ options, hooks, core, terminal, onError, onSweep, dataDir }: PanesWiringOptions): Panes {
  const pids = createPanePidRecords(dataDir);
  // A hard stop of the server last time may have left a pane's program running: only the pids Ogden Agents recorded itself, and only if still the same process.
  const swept = sweepPanePids(pids);
  if (swept.stopped + swept.dropped > 0) onSweep(swept);
  const shell = (): PaneShell => {
    // A test's fake shell (a Node script), else the user's own shell by absolute path (spike 16.1 finding 9).
    if (options.paneShell !== undefined) return options.paneShell;
    if (hooks.paneShell !== undefined) return { file: process.execPath, args: [hooks.paneShell] };
    const found = defaultPaneShell();
    if (found === undefined) throw new Error('no shell was found on this computer');
    return found;
  };
  // The launchers: a test's own, or (a test run) a folder of fake programs as the only PATH, else the real computer's.
  const launchers: PaneLaunchers =
    options.paneLaunchers ??
    createPaneLaunchers({
      launchers: PANE_LAUNCHERS,
      system:
        hooks.panePath === undefined
          ? nodeDetectSystem
          : ((folder: string) => ({
              ...nodeDetectSystem,
              // Only a file inside the test's folder is ever looked at or run (`''`: nothing is).
              runnable: (path: string) => folder !== '' && inside(folder, path) && nodeDetectSystem.runnable(path),
              env: { PATH: folder, HOME: folder, ...(process.platform === 'win32' ? { PATHEXT: '.EXE;.CMD', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', ComSpec: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe' } : {}) },
            }))(hooks.panePath),
    });
  return createPanes({
    store: core.paneStore,
    pids,
    launchers,
    entities: core.entities,
    installSettings: core.installSettings,
    events: core.events,
    terminal,
    shell,
    // The allowlist and nothing else (AD-16): no key, no token, no Ogden switch. Proxies and the SSH agent only when the user opted in (Settings, Terminals), read at each start.
    env: () => {
      const settings = core.terminalsSettings.get();
      return paneEnvironment({ proxies: settings.passProxies, sshAgent: settings.passSshAgent });
    },
    notifyLaunchers: () => core.terminalsSettings.get().notifyLaunchers,
    onError,
  });
}
