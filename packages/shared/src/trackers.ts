import { z } from 'zod';
import { TrackerAccountId } from './ids.js';

/**
 * Issue trackers a chat can start from (CAP-35, epic 27). Accounts are
 * install-level, like remote machines: connected once with the user's own
 * token, usable from any project, and never inferred from a project's git
 * remote, so a project need not be a git repository (user, 2026-11-10).
 * The token is never on this record, in an event or in a response: it
 * lives only in `SecretStorePort` under {@link trackerTokenName}.
 */

export const TRACKER_KINDS = ['github', 'linear'] as const;
export const TrackerKind = z.enum(TRACKER_KINDS);
export type TrackerKind = z.infer<typeof TrackerKind>;
export const TRACKER_KIND_LABELS: Readonly<Record<TrackerKind, string>> = { github: 'GitHub Issues', linear: 'Linear' };

/** The most tracker accounts one install keeps. */
export const MAX_TRACKER_ACCOUNTS = 10;
export const MAX_TRACKER_LABEL = 60;
export const MAX_TRACKER_TOKEN = 500;

/** The keychain name of an account's token (AD-16). */
export const trackerTokenName = (accountId: TrackerAccountId): string => `tracker-token/${accountId}`;

/** A GitHub repository as `owner/name`. */
export const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** A Linear team key (`ENG`). */
export const LINEAR_TEAM_KEY_PATTERN = /^[A-Za-z0-9]{1,10}$/;

const Label = z.string().trim().min(1, 'Give the account a name.').max(MAX_TRACKER_LABEL, `Use ${MAX_TRACKER_LABEL} characters or fewer.`);
const Token = z
  .string()
  .trim()
  .min(1, 'Paste the token.')
  .max(MAX_TRACKER_TOKEN, 'That token is too long.')
  .refine((value) => !/\s/.test(value), 'A token has no spaces.');

/**
 * What an account reads: for GitHub, one repository (`owner/name`, required);
 * for Linear, a team key, or `null` for every team the key can see.
 */
const Scope = z.string().trim().max(150).nullable();

/** One tracker account as stored and listed. Never its token. */
export const TrackerAccount = z.object({
  id: TrackerAccountId,
  kind: TrackerKind,
  label: Label,
  scope: Scope,
  createdAt: z.string().min(1),
});
export type TrackerAccount = z.infer<typeof TrackerAccount>;

/** `POST /api/v1/tracker-accounts`: the token is tested against the tracker before anything is stored. */
export const AddTrackerAccountRequest = z
  .object({ kind: TrackerKind, label: Label, token: Token, scope: Scope.optional() })
  .strict()
  .superRefine((request, ctx) => {
    const scope = request.scope ?? null;
    if (request.kind === 'github' && (scope === null || !GITHUB_REPOSITORY_PATTERN.test(scope))) {
      ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Enter the repository as owner/name.' });
    }
    if (request.kind === 'linear' && scope !== null && scope !== '' && !LINEAR_TEAM_KEY_PATTERN.test(scope)) {
      ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Enter a team key like ENG, or leave it empty for every team.' });
    }
  });
export type AddTrackerAccountRequest = z.infer<typeof AddTrackerAccountRequest>;

export const TrackerAccountsResponse = z.object({ accounts: z.array(TrackerAccount).max(MAX_TRACKER_ACCOUNTS) });
export type TrackerAccountsResponse = z.infer<typeof TrackerAccountsResponse>;
export const TrackerAccountResponse = z.object({ account: TrackerAccount });
export type TrackerAccountResponse = z.infer<typeof TrackerAccountResponse>;

/** An issue's key in its tracker: a GitHub issue number (`123`) or a Linear identifier (`ENG-42`). */
export const IssueKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'That is not an issue.');
export type IssueKey = z.infer<typeof IssueKey>;

/** The most of an issue's description kept anywhere (the context block caps it again, E27-R3). */
export const MAX_ISSUE_DESCRIPTION = 8 * 1024;
export const MAX_ISSUES_LISTED = 25;
export const MAX_ISSUE_QUERY = 200;

/** One issue as Ogden shows and uses it: no vendor shape crosses the adapter. */
export const Issue = z.object({
  kind: TrackerKind,
  key: IssueKey,
  /** As the tracker shows it: `#123`, `ENG-42`. */
  identifier: z.string().min(1).max(80),
  title: z.string().max(500),
  url: z.string().url().refine((value) => value.startsWith('https://'), 'An issue link is https.'),
  status: z.string().max(80).nullable(),
  assignees: z.array(z.string().max(100)).max(20),
  description: z.string().max(MAX_ISSUE_DESCRIPTION),
  updatedAt: z.string().nullable(),
});
export type Issue = z.infer<typeof Issue>;

/** `GET /api/v1/tracker-accounts/:accountId/issues?q=`: the most recently updated open issues, or those matching `q`. */
export const IssuesQuery = z.object({ q: z.string().trim().max(MAX_ISSUE_QUERY).optional() }).strict();
export const IssuesResponse = z.object({ issues: z.array(Issue).max(MAX_ISSUES_LISTED) });
export type IssuesResponse = z.infer<typeof IssuesResponse>;

/**
 * `GET /api/v1/tracker-accounts/:accountId/issues/:issueKey/context`: the
 * issue fetched again, the masked context block that leads the chat's first
 * message (shown in its composer before it is sent), and the chat's name.
 */
export const IssueContextResponse = z.object({ issue: Issue, context: z.string().min(1), chatName: z.string().min(1).max(80) });
export type IssueContextResponse = z.infer<typeof IssueContextResponse>;

// ---- Plain sentences (no dashes) ----

export const TRACKERS_SETTINGS_TITLE = 'Issue trackers';
export const TRACKER_SECRETS_UNAVAILABLE_MESSAGE = "Ogden Agents can't keep a tracker token safely here: this computer has no usable keychain, so nothing was saved.";
export const TRACKER_TOKEN_MISSING_MESSAGE = 'The token for this account is no longer in your keychain. Remove the account and add it again.';
export const TRACKER_UNAUTHORIZED_MESSAGE = 'The tracker refused the token. Check it can read issues, then add the account again.';
export const TRACKER_UNREACHABLE_MESSAGE = "Ogden Agents couldn't reach the tracker. Check your connection and try again.";
export const TRACKER_NOT_FOUND_MESSAGE = "The tracker couldn't find that repository, team or issue.";
export const FROM_AN_ISSUE_LABEL = 'From an issue';
