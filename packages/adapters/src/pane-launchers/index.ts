/**
 * The launcher list as data (epic 16, story 16.3): what a terminal pane can
 * run. Core and shared name no program; this is the one place that does
 * (story 16.5 adds the agents' own CLIs, each found by detection and never
 * installed by Ogden). Every launcher passes `PaneLauncher`.
 */
import { PaneLauncher } from '@ogden-agents/shared';

/** The user's own shell: found at spawn by absolute path (`defaultPaneShell`), so it lists no executable. */
export const SHELL_LAUNCHER: PaneLauncher = PaneLauncher.parse({
  id: 'shell',
  label: 'Shell',
  kind: 'shell',
  executables: {},
});

/** Every launcher, in the order the page offers them. */
export const PANE_LAUNCHERS: readonly PaneLauncher[] = [SHELL_LAUNCHER];
