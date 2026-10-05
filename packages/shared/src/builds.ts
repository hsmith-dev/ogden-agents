import { z } from 'zod';
import { BuildAgent, RunQueueEntry } from './build-runs.js';
import { VerificationResult } from './build-verification.js';
import { Run, RunOutcome, Session } from './entities.js';
import { TICKET_REF_PATTERN } from './planning-board.js';

/**
 * Unattended builds (epic 5; story 5.2's tracer bullet, frozen by story 5.3
 * for epics 5 and 11): starting a build (one ticket, or every ready one),
 * a run and the workspace's runs, reviewing a run, approving (a local merge
 * with the `done` mark in the merge commit), rejecting, retrying and
 * stopping it. Every route serves the `builds` piece (AD-22) and needs the
 * project's script trust. No UI text here holds an em or en dash.
 */

/**
 * `POST /api/v1/workspaces/:wsId/builds`: build one named ticket (`ref`),
 * or every ready one (`all: true`, which keeps dispatching newly ready
 * tickets until none is left or the user stops it; 5.8). `agent` defaults
 * to the install's build runner's agent, Claude Code in v1 (story 5.3).
 */
export const UNKNOWN_BUILD_AGENT_MESSAGE = 'That agent cannot build here.';
export const BUILD_TARGET_MESSAGE = 'Name one ticket to build, or ask for every ready one.';
export const StartBuildRequest = z
  .object({
    agent: BuildAgent.optional(),
    ref: z.string().regex(TICKET_REF_PATTERN, 'That is not a ticket reference.').optional(),
    all: z.literal(true, { error: BUILD_TARGET_MESSAGE }).optional(),
  })
  .strict()
  .refine((request) => (request.ref === undefined) !== (request.all === undefined), BUILD_TARGET_MESSAGE);
export type StartBuildRequest = z.infer<typeof StartBuildRequest>;

/** 202 for an all-ready {@link StartBuildRequest} (5.8): the runs it started and the queue now. */
export const AllReadyBuildsResponse = z.object({ runs: z.array(Run), queue: z.array(RunQueueEntry) });
export type AllReadyBuildsResponse = z.infer<typeof AllReadyBuildsResponse>;

/** 201 for {@link StartBuildRequest}: the run and its `build` session, whose activity streams like a chat's. */
export const BuildResponse = z.object({ run: Run, session: Session });
export type BuildResponse = z.infer<typeof BuildResponse>;

/** `POST …/builds/:ref/commit-plan` (story 5.5): the files committed, repo-relative, and the commit. */
export const CommitPlanFilesResponse = z.object({ committed: z.array(z.string()), revision: z.string() });
export type CommitPlanFilesResponse = z.infer<typeof CommitPlanFilesResponse>;

/** `GET …/sessions/:sesId/run`: the run of a `build` session (404 for a session without one). */
export const SessionRunResponse = z.object({ run: Run });
export type SessionRunResponse = z.infer<typeof SessionRunResponse>;

/** A branch's diff size against its base. */
export const DiffStats = z.object({
  files: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type DiffStats = z.infer<typeof DiffStats>;

/** One review finding as the plan records it (its Review Triage Log or deferred list), in plain text. */
export const REVIEW_FINDING_KINDS = ['finding', 'deferred'] as const;
export const ReviewFinding = z.object({
  kind: z.enum(REVIEW_FINDING_KINDS),
  severity: z.enum(['high', 'medium', 'low']).nullable(),
  text: z.string().min(1).max(2000),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

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
  /**
   * The commit the run's branch points at now (review loop 1): Approve sends
   * it back and merges exactly it. `null` when the branch is gone.
   */
  headRevision: z.string().nullable().default(null),
  /** A plain summary of what changed (5.9), `null` until there is one. */
  summary: z.string().max(4000).nullable().default(null),
  /** The run's verification (5.8 runs it; 11.2 adds detail), `null` until it ran. */
  verification: VerificationResult.nullable().default(null),
  /** The plan's review findings (its Review Triage Log and deferred list; 5.9). Ogden runs no review of its own. */
  findings: z.array(ReviewFinding).default([]),
  /** The diff's size (5.5's `diffStats`), `null` until known. */
  diffStats: DiffStats.nullable().default(null),
});
export type ReviewResponse = z.infer<typeof ReviewResponse>;

/**
 * `POST …/builds/:ref/approve` (review loop 1): the branch revision the user
 * reviewed (`ReviewResponse.headRevision`). Approve merges exactly it, and
 * only while the branch still points at it.
 */
export const ApproveBuildRequest = z.object({ revision: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, 'That is not a commit.') }).strict();
export type ApproveBuildRequest = z.infer<typeof ApproveBuildRequest>;

/** The most characters a note to the agent may have (Reject and retry, Retry). */
export const MAX_RUN_NOTE_LENGTH = 4000;
const runNote = z.string().trim().min(1).max(MAX_RUN_NOTE_LENGTH, `A note can be at most ${MAX_RUN_NOTE_LENGTH} characters.`);

/**
 * `POST …/builds/:ref/reject` (5.9): Reject and retry, with an optional
 * note the next run's first message carries. An empty body is no note.
 */
export const RejectBuildRequest = z.object({ note: runNote.optional() }).strict();
export type RejectBuildRequest = z.infer<typeof RejectBuildRequest>;

/**
 * How a blocked or failed run is run again: `resume` (Retry: mark the
 * plan's resume status in the run's worktree and redispatch there, 5.8; a
 * checkpoint pause resumes), `rebase` (Update and retry after a merge
 * conflict, 5.9), `apply_fix` (Apply the saved fix and retry after an
 * intent gap, 11.1).
 */
export const RETRY_MODES = ['resume', 'rebase', 'apply_fix'] as const;
export const RetryMode = z.enum(RETRY_MODES);
export type RetryMode = z.infer<typeof RetryMode>;

/** `POST …/runs/:runId/retry` → `RunResponse` (the run that continues the work). */
export const RetryRunRequest = z.object({ mode: RetryMode.default('resume'), note: runNote.optional() }).strict();
export type RetryRunRequest = z.infer<typeof RetryRunRequest>;

/** `POST …/runs/:runId/stop` (5.8): stops a running or queued run. No fields. */
export const StopRunRequest = z.object({}).strict();
export type StopRunRequest = z.infer<typeof StopRunRequest>;

/** `GET …/runs/:runId` (the run view, 11.1), and the answer to Stop, Retry and Check again. */
export const RunResponse = z.object({
  run: Run,
  verification: VerificationResult.nullable().default(null),
});
export type RunResponse = z.infer<typeof RunResponse>;

/** `GET …/runs` (the Runs tab, 11.1): every run of the workspace, newest first, and its queue. */
export const RunsResponse = z.object({ runs: z.array(Run), queue: z.array(RunQueueEntry) });
export type RunsResponse = z.infer<typeof RunsResponse>;

/** The most diff text a review answers with, in bytes; longer is cut. */
export const MAX_REVIEW_DIFF_BYTES = 512 * 1024;

/** The prefix of every run's branch (`ogden/<run8>/<ref>-<slug>`). */
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
export const VCS_NOT_TOP_LEVEL_MESSAGE = "Builds need the project to be the top folder of its git repository, and this one is inside another.";
export const BMAD_FILES_UNCOMMITTED_MESSAGE = "This project's BMad Method scripts aren't committed as you trusted them, so a build can't run them. Commit the _bmad folder, then build again.";
export const REVIEW_STALE_MESSAGE = 'The build changed after you reviewed it. Review it again.';
export const MERGE_REFUSED_MESSAGE = "Git couldn't merge the build into your project (it would overwrite files you have), so nothing was merged.";
export const CHECKOUT_BUSY_MESSAGE = 'Your project has staged changes, changes to this ticket\'s plan, or a merge, rebase, cherry-pick or revert in progress. Finish or undo it, then approve again.';
export const VCS_UNAVAILABLE_MESSAGE = 'Builds need this project to be a git repository with a branch checked out that has at least one commit.';
/** The oldest git builds work with (story 5.5): `rev-parse --path-format` (2.31) and `git apply`'s refusal to write beyond a symbolic link (2.39.2, CVE-2023-23946). */
export const MIN_GIT_VERSION = '2.39.2';
export const GIT_MISSING_MESSAGE = "Builds need git, and Ogden Agents couldn't find it on this computer. Install git, then build again.";
export const gitTooOldMessage = (found: string) => `Builds need git ${MIN_GIT_VERSION} or newer, and this computer has git ${found}. Update git, then try again.`;
/** The least free space the data folder's disk must have for a new worktree (story 5.5). */
export const MIN_FREE_DISK_BYTES = 1024 * 1024 * 1024;
export const DISK_SPACE_LOW_MESSAGE = 'Your disk has less than 1 GB free, so a build has no room for its own copy of the project. Free some space, then build again.';
export const CHECKOUT_MOVED_MESSAGE = "Your project isn't on the branch this build started from (it switched branches, or none is checked out). Check that branch out, then approve again.";
export const NO_PLAN_FILES_TO_COMMIT_MESSAGE = "This ticket's plan files have no uncommitted changes.";
export const COMMIT_PLAN_FILES_LABEL = 'Commit plan files';
export const COMMIT_PLAN_FILES_FAILED = "The plan files couldn't be committed. Try again.";
export const PLAN_FILES_COMMITTED_TEXT = 'Plan files committed. Build again.';
export const RUN_NOT_ACTIVE_MESSAGE = 'This run has already finished.';
/** `POST …/runs/:runId/retry` for a run not paused at a checkpoint, until 5.8 builds Retry. */
export const RETRY_NOT_AVAILABLE_MESSAGE = 'Retry for this run is not available yet.';
export const ALL_READY_NOT_AVAILABLE_MESSAGE = 'Building every ready story is not available yet.';

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
export const RUN_REASON_PROTECTED_DIFF = "The build changed files it may not change (protected files, BMad Method's own, tickets.toml, or another ticket's plan), so it can't be approved.";
export const RUN_REASON_NO_NETWORK = 'Builds have no network, so installs such as npm install fail.';
export const RUN_REASON_INTERRUPTED = 'interrupted';
export const RUN_REASON_START_FAILED = "The build couldn't start its agent.";

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
