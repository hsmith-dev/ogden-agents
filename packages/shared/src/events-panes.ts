/**
 * Terminal pane events (epic 16, story 16.3): STATE ONLY. A pane's output and
 * what is typed into it are never events: no payload has a text field, and a
 * test keeps it so (AD-6, AD-16; E16-R6). They sit on the project's workspace
 * stream and travel on the existing `/ws` workspace subscription, so every tab
 * follows a pane's state and the Needs you sidebar can count the panes that
 * need attention. Re-exported from `events.ts`.
 */
import { z } from 'zod';
import { assigned, onWorkspaceStream } from './events-envelope.js';
import { PaneId } from './ids.js';
import { PaneLauncherId, PaneStatus, PaneTitle } from './panes.js';

export const TerminalPaneOpenedInput = z.object({
  type: z.literal('terminal.pane_opened'),
  ...onWorkspaceStream,
  payload: z.object({ paneId: PaneId, launcherId: PaneLauncherId, title: PaneTitle }),
});
/** A pane was opened in the project. */
export const TerminalPaneOpenedEvent = TerminalPaneOpenedInput.extend(assigned);
export type TerminalPaneOpenedEvent = z.infer<typeof TerminalPaneOpenedEvent>;

export const TerminalPaneStatusChangedInput = z.object({
  type: z.literal('terminal.pane_status_changed'),
  ...onWorkspaceStream,
  payload: z.object({ paneId: PaneId, status: PaneStatus, previous: PaneStatus }),
});
/** A pane's guessed status changed (story 16.6): working, needs attention, idle or exited. */
export const TerminalPaneStatusChangedEvent = TerminalPaneStatusChangedInput.extend(assigned);
export type TerminalPaneStatusChangedEvent = z.infer<typeof TerminalPaneStatusChangedEvent>;

export const TerminalPaneExitedInput = z.object({
  type: z.literal('terminal.pane_exited'),
  ...onWorkspaceStream,
  payload: z.object({ paneId: PaneId, exitCode: z.number().int().nullable() }),
});
/** A pane's program ended (`exitCode` is its own; `null` when it did not report one, such as a Restart pane that could not start). The pane stays, startable again. A Restart pane that works emits nothing here: story 16.6's `pane_status_changed` tells it is working again. */
export const TerminalPaneExitedEvent = TerminalPaneExitedInput.extend(assigned);
export type TerminalPaneExitedEvent = z.infer<typeof TerminalPaneExitedEvent>;

export const TerminalPaneClosedInput = z.object({
  type: z.literal('terminal.pane_closed'),
  ...onWorkspaceStream,
  payload: z.object({ paneId: PaneId, cause: z.enum(['user', 'developer_mode_off', 'server_stopped']) }),
});
/** A pane was closed and forgotten: by the user, by Developer mode turning off, or by the server stopping. */
export const TerminalPaneClosedEvent = TerminalPaneClosedInput.extend(assigned);
export type TerminalPaneClosedEvent = z.infer<typeof TerminalPaneClosedEvent>;

export const TerminalPaneRenamedInput = z.object({
  type: z.literal('terminal.pane_renamed'),
  ...onWorkspaceStream,
  payload: z.object({ paneId: PaneId, title: PaneTitle }),
});
/** A pane was renamed (story 16.4). */
export const TerminalPaneRenamedEvent = TerminalPaneRenamedInput.extend(assigned);
export type TerminalPaneRenamedEvent = z.infer<typeof TerminalPaneRenamedEvent>;

export const TerminalLayoutChangedInput = z.object({
  type: z.literal('terminal.layout_changed'),
  ...onWorkspaceStream,
  payload: z.object({ tabCount: z.number().int().min(0), paneCount: z.number().int().min(0) }),
});
/** The project's terminal layout changed (story 16.4); tabs read it again. The layout itself is read, never carried. */
export const TerminalLayoutChangedEvent = TerminalLayoutChangedInput.extend(assigned);
export type TerminalLayoutChangedEvent = z.infer<typeof TerminalLayoutChangedEvent>;
