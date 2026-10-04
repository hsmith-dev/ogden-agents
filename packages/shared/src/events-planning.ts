import { z } from 'zod';
import { assigned, onWorkspaceStream } from './events-envelope.js';
import { BmadSetupProgress, BmadSetupStatus } from './planning.js';

/**
 * Epic 4's event schemas (story 4.2's contract): the per-project script
 * trust, a ticket's files changing, and BMad Method's setup in a project.
 * Moved from `events.ts` in entry 4.12, which re-exports the events; the
 * `*Input` schemas stay internal to the event modules.
 */

export const WorkspaceBmadScriptsTrustedInput = z.object({
  type: z.literal('workspace.bmad_scripts_trusted'),
  ...onWorkspaceStream,
  payload: z.object({}),
});
/**
 * The user allowed Ogden Agents to run this project's own BMad Method
 * scripts (story 4.2, AD-22 note 2026-10-02): core keeps it on the workspace
 * row, and the routes and use-cases that run project scripts stop refusing
 * with `scripts_not_trusted`. Appended once; a repeat changes nothing, and
 * turning pieces off never revokes it. Logs from before 4.2 lack it, and
 * their workspaces read as not trusted.
 */
export const WorkspaceBmadScriptsTrustedEvent = WorkspaceBmadScriptsTrustedInput.extend(assigned);
export type WorkspaceBmadScriptsTrustedEvent = z.infer<typeof WorkspaceBmadScriptsTrustedEvent>;

export const TicketChangedInput = z.object({
  type: z.literal('ticket.changed'),
  ...onWorkspaceStream,
  payload: z.object({ ref: z.string().min(1) }),
});
/**
 * A ticket's files changed (story 4.2's contract; entry 4.8's watcher
 * appends it). Carries only the ref, never status or content (AD-7): the
 * UI refetches the tickets over REST.
 */
export const TicketChangedEvent = TicketChangedInput.extend(assigned);
export type TicketChangedEvent = z.infer<typeof TicketChangedEvent>;

export const BmadSetupStartedInput = z.object({
  type: z.literal('bmad.setup_started'),
  ...onWorkspaceStream,
  payload: z.object({}),
});
/** BMad Method's setup started in the project (story 4.2's contract; entry 4.3 appends the `bmad.setup_*` events). */
export const BmadSetupStartedEvent = BmadSetupStartedInput.extend(assigned);
export type BmadSetupStartedEvent = z.infer<typeof BmadSetupStartedEvent>;

export const BmadSetupProgressInput = z.object({
  type: z.literal('bmad.setup_progress'),
  ...onWorkspaceStream,
  payload: BmadSetupProgress,
});
/** A setup step began: its code and its line in the progress list. */
export const BmadSetupProgressEvent = BmadSetupProgressInput.extend(assigned);
export type BmadSetupProgressEvent = z.infer<typeof BmadSetupProgressEvent>;

export const BmadSetupCompletedInput = z.object({
  type: z.literal('bmad.setup_completed'),
  ...onWorkspaceStream,
  payload: z.object({ status: BmadSetupStatus }),
});
/** The setup finished; `status` is the project's setup status now. */
export const BmadSetupCompletedEvent = BmadSetupCompletedInput.extend(assigned);
export type BmadSetupCompletedEvent = z.infer<typeof BmadSetupCompletedEvent>;

export const BmadSetupFailedInput = z.object({
  type: z.literal('bmad.setup_failed'),
  ...onWorkspaceStream,
  payload: z.object({ reason: z.string().min(1) }),
});
/** The setup failed. `reason` is plain words: no path, no script output, no secret. */
export const BmadSetupFailedEvent = BmadSetupFailedInput.extend(assigned);
export type BmadSetupFailedEvent = z.infer<typeof BmadSetupFailedEvent>;
