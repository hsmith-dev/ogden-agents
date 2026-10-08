/**
 * The Jira link's events (epic 18; CAP-26, AD-29), re-exported from
 * `events.ts`. The site URL, email, and token are never in an event
 * (AD-16, AD-29's whole-value redaction): the page that follows one reads
 * the link settings again (`GET .../jira-link`).
 */
import { z } from 'zod';
import { onWorkspaceStream } from './events-envelope.js';
import { assigned } from './events-envelope.js';

/** What changed about the workspace's Jira link. */
export const JIRA_LINK_CHANGES = ['linked', 'unlinked', 'sync_succeeded', 'sync_failed'] as const;
export type JiraLinkChange = (typeof JIRA_LINK_CHANGES)[number];

export const WorkspaceJiraLinkChangedInput = z.object({
  type: z.literal('workspace.jira_link_changed'),
  ...onWorkspaceStream,
  payload: z.object({ change: z.enum(JIRA_LINK_CHANGES) }),
});
/** A board was linked or unlinked, or a sync succeeded or failed (every tab reads the link settings again). */
export const WorkspaceJiraLinkChangedEvent = WorkspaceJiraLinkChangedInput.extend(assigned);
export type WorkspaceJiraLinkChangedEvent = z.infer<typeof WorkspaceJiraLinkChangedEvent>;
