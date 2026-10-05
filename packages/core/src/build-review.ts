/**
 * The review answer (story 5.9; story 5.10 split `builds.ts`): a plain
 * summary, the diff and its size, the findings in the plan.
 */
import { MAX_REVIEW_DIFF_BYTES, type ReviewResponse, type Run, type VerificationResult, type DiffStats } from '@ogden-agents/shared';
import { readPlanFindings } from './build-findings.js';
import { isBuildBranch } from './build-names.js';
import type { BuildCtx } from './build-context.js';

export function createReviewer(ctx: BuildCtx) {
  const { vcs, mask, verificationOf } = ctx;

  /** A plain summary of what a run changed and checked (story 5.9). */
  const summaryOf = (run: Run, stats: DiffStats, verification: VerificationResult | undefined): string => {
    const changed = `Ticket ${run.ticketRef} changed ${stats.files} ${stats.files === 1 ? 'file' : 'files'}, with ${stats.insertions} ${stats.insertions === 1 ? 'line' : 'lines'} added and ${stats.deletions} removed.`;
    if (verification === undefined) return changed;
    const tests = verification.attended ? 'You watched this build, so its tests were not re-run.' : verification.checks[1]?.result === 'pass' ? 'Its tests passed when Ogden Agents ran them again.' : '';
    return tests === '' ? changed : `${changed} ${tests}`;
  };

  /** The workspace's latest run of `ref`, as the review page shows it. */
  const reviewOf = async (repoPath: string, run: Run, plan: string | null = null): Promise<ReviewResponse> => {
    const verification = verificationOf(run);
    const findings = readPlanFindings(run.worktreePath, plan, mask);
    const base = { run, outcome: run.outcome, reason: run.reason, summary: null as string | null, verification: verification ?? null, findings, diffStats: null as DiffStats | null };
    if (run.branch === null || run.baseRevision === null || !isBuildBranch(run.branch)) return { ...base, diff: '', truncated: false, files: [], merged: run.decision === 'approved', headRevision: null };
    const headRevision = (await vcs.branchRevision(repoPath, run.branch)) ?? null;
    // An approved run's branch is deleted with its worktree (story 5.5): it is merged.
    if (headRevision === null) return { ...base, diff: '', truncated: false, files: [], merged: run.decision === 'approved', headRevision };
    const changes = await vcs.diff(repoPath, run.baseRevision, run.branch, { maxBytes: MAX_REVIEW_DIFF_BYTES });
    const merged = changes.files.length > 0 && (await vcs.isMerged(repoPath, run.branch));
    const diffStats = await vcs.diffStats(repoPath, run.baseRevision, run.branch).catch(() => null);
    return { ...base, summary: diffStats === null ? null : summaryOf(run, diffStats, verification), diffStats, diff: changes.diff, truncated: changes.truncated, files: changes.files, merged, headRevision };
  };

  return { summaryOf, reviewOf };
}
