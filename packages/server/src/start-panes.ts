/**
 * Terminal panes' wiring (epic 16, story 16.2): core's pane use-cases over
 * the `terminal-pty` port, the user's own shell and the pane environment.
 * Split out of `start.ts` to keep it short.
 */
import { defaultPaneShell, paneEnvironment, type PaneShell } from '@ogden-agents/adapters';
import { createPanes, type Core, type Panes, type TerminalPort } from '@ogden-agents/core';
import type { StartOptions } from './start-types.js';
import type { TestHooks } from './test-hooks.js';

export interface PanesWiringOptions {
  options: Pick<StartOptions, 'paneShell'>;
  hooks: Pick<TestHooks, 'paneShell'>;
  core: Pick<Core, 'entities' | 'installSettings' | 'events'>;
  terminal: TerminalPort;
  onError: (error: unknown) => void;
}

export function createPanesWiring({ options, hooks, core, terminal, onError }: PanesWiringOptions): Panes {
  const shell = (): PaneShell => {
    // A test's fake shell (a Node script), else the user's own shell by absolute path (spike 16.1 finding 9).
    if (options.paneShell !== undefined) return options.paneShell;
    if (hooks.paneShell !== undefined) return { file: process.execPath, args: [hooks.paneShell] };
    const found = defaultPaneShell();
    if (found === undefined) throw new Error('no shell was found on this computer');
    return found;
  };
  return createPanes({
    entities: core.entities,
    installSettings: core.installSettings,
    events: core.events,
    terminal,
    shell,
    // The allowlist and nothing else (AD-16): no key, no token, no Ogden switch. Proxies and the SSH agent stay off until the user opts in (story 16.9).
    env: () => paneEnvironment(),
    onError,
  });
}
