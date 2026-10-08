import { z } from 'zod';

/**
 * CAP-26's Jira tracker link ("Tooling Drive", CAP-19), epic 18. The
 * vendor-neutral shapes other packages may reference: the stored link
 * settings (never the token — AD-29 keeps it in the keychain alone,
 * `jiraCredentialName`) and the link request. Jira's own vocabulary (Issue
 * Type, Epic link, Priority, Issue Links) stays inside the `tickets-jira`
 * adapter (AD-27, AD-12) and is never named here.
 */

/** The keychain key for a linked board's token (AD-29): one bare value, matching `agent-api-key/<agentId>`'s shape. */
export const jiraCredentialName = (workspaceId: string): string => `jira-credential/${workspaceId}`;

/** A Jira site URL, as typed: validated for real by the outbound guard (AD-27, AD-29), not by this schema alone. */
const JiraSiteUrl = z.string().trim().min(1, 'Enter the site address.').max(500);
const JiraEmail = z.string().trim().email('Enter the Jira account email.').max(320);
const JiraToken = z
  .string()
  .trim()
  .min(4, 'That is too short to be a token.')
  .max(2000)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'That token has a line break or a hidden character in it. Paste it again.');
const JiraProjectKey = z.string().trim().min(1, 'Enter the project or board key.').max(100);

/** `POST .../jira-link`: what the user submits to link a board (AD-29's "Link a Jira board" flow). */
export const LinkJiraBoardRequest = z.object({
  siteUrl: JiraSiteUrl,
  email: JiraEmail,
  token: JiraToken,
  projectKey: JiraProjectKey,
});
export type LinkJiraBoardRequest = z.infer<typeof LinkJiraBoardRequest>;

/** A linked board's non-secret settings (AD-29: email and site URL are ordinary workspace settings, never in the keychain). */
export const JiraLinkSettings = z.object({
  siteUrl: JiraSiteUrl,
  email: JiraEmail,
  /** The resolved API base URL (AD-29): `<site>` directly for a classic token, `api.atlassian.com/ex/jira/<cloudId>` for a scoped one. */
  baseUrl: z.string().min(1),
  projectKey: JiraProjectKey,
  /** ISO time of the last successful sync, or `null` before the first one. */
  lastSyncedAt: z.string().nullable().default(null),
  /** The last sync failure's plain reason, or `null` when the last sync succeeded (AD-27's "last synced at — retry" notice). */
  lastSyncError: z.string().nullable().default(null),
});
export type JiraLinkSettings = z.infer<typeof JiraLinkSettings>;

/** `GET .../jira-link`: `null` when the workspace has no linked board. */
export const JiraLinkResponse = z.object({ link: JiraLinkSettings.nullable() });
export type JiraLinkResponse = z.infer<typeof JiraLinkResponse>;

/**
 * Why linking, or a sync, failed (AD-27, AD-29): the site URL failed the
 * outbound guard (`jira_url_rejected`: not https, a redirect, or a
 * loopback/link-local/private-range target), the credential was refused by
 * Jira's own test call (`jira_unauthorized`), the server could not be
 * reached at all (`jira_unreachable`), or a board is already linked
 * (`jira_already_linked`).
 */
export const JIRA_ERROR_CODES = ['jira_url_rejected', 'jira_unauthorized', 'jira_unreachable', 'jira_already_linked'] as const;
export type JiraErrorCode = (typeof JIRA_ERROR_CODES)[number];

export const JIRA_URL_REJECTED_MESSAGE = 'That address cannot be used: Jira must be reached over https, with no redirect, at a public address.';
export const JIRA_UNAUTHORIZED_MESSAGE = "Jira didn't accept that email and token. Check them and try again.";
export const JIRA_UNREACHABLE_MESSAGE = "Jira couldn't be reached. Check the address and try again.";
export const JIRA_ALREADY_LINKED_MESSAGE = 'This project already has a linked Jira board. Unlink it first.';

export const JIRA_ERROR_MESSAGES: Readonly<Record<JiraErrorCode, string>> = {
  jira_url_rejected: JIRA_URL_REJECTED_MESSAGE,
  jira_unauthorized: JIRA_UNAUTHORIZED_MESSAGE,
  jira_unreachable: JIRA_UNREACHABLE_MESSAGE,
  jira_already_linked: JIRA_ALREADY_LINKED_MESSAGE,
};
