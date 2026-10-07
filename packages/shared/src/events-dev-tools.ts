/**
 * Generic developer CLI tool events (CAP-25, story: generic developer CLI
 * tools detect, install, and sandbox-gate): the install-wide catalog
 * (seed and user-added tools, and whether Ogden's own install of one
 * succeeded or failed) and a project's unattended-build allowance per tool.
 * Never carries an installer's raw output or a resolved file path — a plain
 * reason only (never a secret).
 */
import { z } from 'zod';
import { DEV_TOOLS_STREAM } from './events-common.js';
import { assigned, onWorkspaceStream } from './events-envelope.js';
import { DevToolId } from './dev-tools.js';

const onDevToolsStream = { workspaceId: z.null(), streamId: z.literal(DEV_TOOLS_STREAM) };

/** Why the install-wide catalog changed: a confirmed install finished, failed, or a custom tool was added or removed. */
export const DevToolsCatalogChangeReason = z.enum(['installed', 'install_failed', 'tool_added', 'tool_removed']);
export type DevToolsCatalogChangeReason = z.infer<typeof DevToolsCatalogChangeReason>;

export const DevToolsCatalogChangedInput = z.object({
  type: z.literal('devtools.catalog_changed'),
  ...onDevToolsStream,
  payload: z.object({
    toolId: DevToolId,
    reason: DevToolsCatalogChangeReason,
    /** Plain words, only for `install_failed` (never raw stderr, never a path). */
    detail: z.string().max(500).optional(),
  }),
});
/** The dev tools catalog changed (CAP-25): other tabs re-fetch the list. */
export const DevToolsCatalogChangedEvent = DevToolsCatalogChangedInput.extend(assigned);
export type DevToolsCatalogChangedEvent = z.infer<typeof DevToolsCatalogChangedEvent>;

export const WorkspaceDevToolUnattendedAllowChangedInput = z.object({
  type: z.literal('workspace.dev_tool_unattended_allow_changed'),
  ...onWorkspaceStream,
  payload: z.object({ toolId: DevToolId, allowed: z.boolean() }),
});
/**
 * A project's unattended-build allowance for one tool changed (CAP-25,
 * deny-by-default): scoped to this workspace and this tool only.
 */
export const WorkspaceDevToolUnattendedAllowChangedEvent = WorkspaceDevToolUnattendedAllowChangedInput.extend(assigned);
export type WorkspaceDevToolUnattendedAllowChangedEvent = z.infer<typeof WorkspaceDevToolUnattendedAllowChangedEvent>;
