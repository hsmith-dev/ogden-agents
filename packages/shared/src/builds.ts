import { z } from 'zod';
import { Run, RunOutcome, Session } from './entities.js';
import { TICKET_REF_PATTERN } from './planning-board.js';

/**
 * Unattended builds (epic 5; story 5.2's tracer bullet, the minimal shapes
 * 5.3 will freeze): starting one ticket's build, reviewing its run, and
 * approving (a local merge with the `done` mark in the merge commit) or
 * rejecting it. Every route serves the `builds` piece (AD-22) and needs the
 * project's script trust. No UI text here holds an em or en dash.
 */

/** `POST /api/v1/workspaces/:wsId/builds`: build one named ticket. */
export const StartBuildRequest = z
  .object({
    ref: z.string().regex(TICKET_REF_PATTERN, 'That is not a ticket reference.'),
  })
  .strict();
export type StartBuildRequest = z.infer<typeof StartBuildRequest>;

/** 201 for {@link StartBuildRequest}: the run and its `build` session, whose activity streams like a chat's. */
export const BuildResponse = z.object({ run: Run, session: Session });
export type BuildResponse = z.infer<typeof BuildResponse>;

/** `GET …/sessions/:sesId/run`: the run of a `build` session (404 for a session without one). */
export const SessionRunResponse = z.object({ run: Run });
export type SessionRunResponse = z.infer<typeof SessionRunResponse>;

/**
 * `GET …/builds/:ref` (the review page), and the answer to Approve and
 * Reject: the ticket's latest run, its outcome and plain reason, the diff of
 * its branch against where it started (read-only text, capped), the files it
 * changed, and whether its branch is already merged into the checkout.
 */
export const ReviewResponse = z.object({
  run: Run,
  outcome: RunOutcome,
  reason: z.string().nullable(),
  diff: z.string(),
  /** Whether {@link diff} was cut at {@link MAX_REVIEW_DIFF_BYTES}. */
  truncated: z.boolean().default(false),
  files: z.array(z.string()),
  merged: z.boolean(),
});
export type ReviewResponse = z.infer<typeof ReviewResponse>;

/** The most diff text a review answers with, in bytes; longer is cut. */
export const MAX_REVIEW_DIFF_BYTES = 512 * 1024;

/** The prefix of every run's branch (`ogden/<ref>-<slug>`). */
export const BUILD_BRANCH_PREFIX = 'ogden/';

// ---- Plain sentences (EXPERIENCE.md Voice and Tone) ----

export const PREREQUISITE_UNMET_MESSAGE = 'This ticket waits for another one that is not done or in review yet.';
export const NOT_READY_MESSAGE = 'This ticket is not ready to build. Move it to Ready first.';
export const RUN_ACTIVE_MESSAGE = 'This ticket is already being built.';
export const SANDBOX_UNAVAILABLE_MESSAGE = "Unattended builds need a sandbox, and this computer doesn't have one Ogden Agents can use, so nothing was started.";
export const CHECKOUT_DIRTY_MESSAGE = 'Your project has uncommitted changes outside the BMad output folder. Commit or stash them, then approve again.';
export const MERGE_CONFLICT_MESSAGE = "The build's changes conflict with your project, so nothing was merged. The run needs a rebase.";
export const CHECKS_FAILED_MESSAGE = "This run didn't pass its checks, so it can't be approved.";
export const ALREADY_MERGED_MESSAGE = 'This run is already merged.';
export const PLAN_UNCOMMITTED_MESSAGE = "This ticket's plan or tickets.toml has uncommitted changes. Commit them, then build again.";
export const VCS_UNAVAILABLE_MESSAGE = 'Builds need this project to be a git repository with a branch checked out that has at least one commit.';

/** A run's outcome as the review page and the session header say it. */
export const RUN_OUTCOME_LABELS: Readonly<Record<RunOutcome, string>> = {
  running: 'Building',
  verified: 'Ready for review',
  failed: 'Failed',
  blocked: 'Blocked',
  stopped: 'Rejected',
};

/** The reasons core gives a run that ended other than `verified`. */
export const RUN_REASON_EMPTY_DIFF = 'The plan says built, but the branch has no changes.';
export const RUN_REASON_SCRIPTS_CHANGED = "The build changed this project's BMad Method scripts, so Ogden Agents didn't run them to read the result.";
export const RUN_REASON_NOT_BUILT = (status: string) => (status === '' ? 'The run ended without the plan saying built.' : `The run ended with the plan ${status}, not built.`);
export const RUN_REASON_AGENT_ERROR = 'The agent stopped with an error before the plan said built.';
export const RUN_REASON_UNREADABLE = "Ogden Agents couldn't read the plan's status in the run's worktree.";

/** The web app's Build, review, approve and reject words. */
export const BUILD_LABEL = 'Build';
export const BUILD_FAILED = "The build couldn't start. Try again.";
export const REVIEW_PAGE_TITLE = 'Review';
export const REVIEW_LOAD_FAILED = "The review couldn't be loaded. Try again.";
export const APPROVE_LABEL = 'Approve and merge';
export const REJECT_LABEL = 'Reject';
export const APPROVE_FAILED = "The run couldn't be approved. Try again.";
export const REJECT_FAILED = "The run couldn't be rejected. Try again.";
export const REVIEW_LINK_LABEL = 'Review';
export const REVIEW_MERGED_TEXT = 'Merged. The ticket is done.';
export const REVIEW_NO_CHANGES_TEXT = 'No changes.';
