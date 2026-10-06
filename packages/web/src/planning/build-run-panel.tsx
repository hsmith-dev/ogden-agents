import {
  APPLY_FIX_LABEL,
  blockedSentence,
  HIDE_DETAILS_LABEL,
  REVIEW_CHECKS_TITLE,
  RUN_AGENT_LABEL,
  RUN_SANDBOX_LABEL,
  RUN_TIME_LEFT_LABEL,
  SANDBOX_LABELS,
  SHOW_DETAILS_LABEL,
  timeLeftWords,
  runPhase,
  type Run,
} from '@ogden-agents/shared';
import { useEffect, useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { agentNameOf } from '@/chat/chat-api';
import { useChatAgents } from '@/chat/use-chat-agents';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { useRunAction, useRunDetail } from './builds-api';
import { CheckAgainButton, VerificationChecks } from './verification-checks';

/** The words on the run view's Retry buttons. */
export const RETRY_LABEL = 'Retry';
export const CONTINUE_LABEL = 'Continue the build';

/** The sentence a run's notice gives: the blocked code's own, else the run's plain reason. */
export function runSentence(run: Pick<Run, 'blockedCode' | 'reason' | 'outcome'>): string | null {
  if (run.outcome === 'blocked' && run.blockedCode !== null) {
    // The time limit's own sentence names the run's minutes (the reason stored it).
    if (run.blockedCode === 'time_limit') return run.reason ?? blockedSentence('time_limit');
    return blockedSentence(run.blockedCode);
  }
  return run.reason;
}

/** The current time, read again every `ms` while `active`. */
function useNow(active: boolean, ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
  return now;
}

/**
 * The live run view's body (story 11.1; EXPERIENCE.md Live run view): what
 * runs it (agent, sandbox used), the time left before the run's limit while
 * it runs, and, for a blocked, failed or stopped run, the notice with its
 * plain sentence, **Retry** (**Continue the build** at a checkpoint pause),
 * **Apply the saved fix and retry** for an intent gap, and **Show details**
 * with the raw code (open always in Developer mode).
 */
export function BuildRunPanel({ wsId, run }: { wsId: string; run: Run | undefined }) {
  const { appearance } = useAppearance();
  const agents = useChatAgents();
  const retry = useRunAction(wsId, 'retry');
  const applyFix = useRunAction(wsId, 'apply_fix');
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const detail = useRunDetail(wsId, run?.id);
  // A refusal from an earlier action says nothing once the run has moved on.
  useEffect(() => setFailure(undefined), [run?.id, run?.outcome]);
  const running = run?.outcome === 'running' && run.queuePosition === null;
  const now = useNow(running, 10_000);
  if (run === undefined) return null;
  const phase = runPhase(run);
  const paused = phase === 'checkpoint';
  const retryable = run.worktreePath !== null && (run.decision ?? null) === null && (run.outcome === 'failed' || run.outcome === 'stopped' || (run.outcome === 'blocked' && run.blockedCode !== 'merge_conflict'));
  const fixable = retryable && run.blockedCode === 'intent_gap';
  const acting = retry.isPending || applyFix.isPending;
  const act = (action: typeof retry) => {
    if (acting) return;
    setFailure(undefined);
    action.mutateAsync(run.id).catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  };
  const sandbox = run.sandbox === null ? null : (SANDBOX_LABELS[run.sandbox as keyof typeof SANDBOX_LABELS] ?? run.sandbox);
  const timeLeft = running ? timeLeftWords(run.deadline, now) : null;
  const sentence = run.outcome === 'running' ? null : runSentence(run);
  const hasDetails = run.blockedCode !== null && run.outcome === 'blocked';
  const showDetails = hasDetails && (appearance.developerMode || open);
  return (
    <section aria-label="This build" className="flex flex-col gap-3 border-b border-border px-(--panel-padding) py-3" data-testid="build-run-panel" data-phase={phase}>
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-caption text-muted-foreground">
        <div className="flex gap-1">
          <dt>{RUN_AGENT_LABEL}:</dt>
          <dd className="m-0 text-foreground" data-testid="build-run-agent">
            {agentNameOf(agents.data, run.agent ?? undefined)}
          </dd>
        </div>
        {sandbox === null ? null : (
          <div className="flex gap-1">
            <dt>{RUN_SANDBOX_LABEL}:</dt>
            <dd className="m-0 text-foreground" data-testid="build-run-sandbox">
              {sandbox}
            </dd>
          </div>
        )}
        {timeLeft === null ? null : (
          <div className="flex gap-1">
            <dt>{RUN_TIME_LEFT_LABEL}:</dt>
            <dd className="m-0 text-foreground" data-testid="build-run-time-left">
              {timeLeft}
            </dd>
          </div>
        )}
        {run.queuePosition === null ? null : (
          <div className="flex gap-1" data-testid="build-run-queue-position">
            <dt>Place in the queue:</dt>
            <dd className="m-0 text-foreground">{run.queuePosition}</dd>
          </div>
        )}
      </dl>
      {sentence === null || phase === 'built' || phase === 'approved' || phase === 'rejected' ? null : (
        <Notice
          variant={phase === 'needs_you' || phase === 'failed' || phase === 'interrupted' ? 'blocked' : 'info'}
          data-testid="build-run-notice"
          action={
            <span className="flex flex-wrap items-center gap-2">
              {hasDetails && !appearance.developerMode ? (
                <Button variant="outline" size="sm" data-testid="build-run-details-toggle" aria-expanded={showDetails} aria-controls="build-run-details" onClick={() => setOpen((current) => !current)}>
                  {showDetails ? HIDE_DETAILS_LABEL : SHOW_DETAILS_LABEL}
                </Button>
              ) : null}
              {fixable ? (
                <Button size="sm" data-testid="build-run-apply-fix" aria-disabled={acting || undefined} onClick={() => act(applyFix)}>
                  {APPLY_FIX_LABEL}
                </Button>
              ) : null}
              {retryable ? (
                <Button variant="outline" size="sm" data-testid="build-run-retry" aria-disabled={acting || undefined} onClick={() => act(retry)}>
                  {paused ? CONTINUE_LABEL : RETRY_LABEL}
                </Button>
              ) : null}
            </span>
          }
        >
          <span data-testid="build-run-reason">{sentence}</span>
        </Notice>
      )}
      {showDetails ? (
        <dl className="m-0 flex flex-col gap-1 rounded-md border border-border bg-muted p-3 text-caption" id="build-run-details" data-testid="build-run-details">
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Code:</dt>
            <dd className="m-0 font-mono text-mono-compact" data-testid="build-run-code">
              {run.blockedCode}
            </dd>
          </div>
          {run.reason !== null && run.reason !== sentence ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Reason:</dt>
              <dd className="m-0 min-w-0 break-words" data-testid="build-run-raw-reason">
                {run.reason}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {detail.data?.verification == null || run.outcome === 'running' ? null : (
        <section aria-label={REVIEW_CHECKS_TITLE} className="flex flex-col gap-2" data-testid="build-run-checks">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-label">{REVIEW_CHECKS_TITLE}</span>
            <CheckAgainButton wsId={wsId} run={run} onError={setFailure} />
          </span>
          <VerificationChecks verification={detail.data.verification} idPrefix="run" />
        </section>
      )}
      {failure === undefined ? null : (
        <span role="alert" className="text-caption text-state-error" data-testid="build-run-panel-error">
          {failure}
        </span>
      )}
    </section>
  );
}
