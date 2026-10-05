import {
  BMAD_NOT_SET_UP_TEXT,
  BMAD_SET_UP_AGAIN_LABEL,
  BMAD_SET_UP_LABEL,
  BMAD_SETUP_DONE_TEXT,
  BMAD_SETUP_FAILED,
  BMAD_SETUP_PROGRESS_LABEL,
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_STEPS,
  BMAD_SETUP_UNUSABLE_TEXT,
  BMAD_UPGRADE_DONE_TEXT,
  type BmadSetupProgress,
  type BmadSetupStatus,
} from '@ogden-agents/shared';
import { useRef, useState, type ReactNode } from 'react';
import { isApiError } from '@/api/http';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { useBmadDetection } from '@/workspaces/bmad-detection-api';
import { startBmadSetup, useBmadSetupProgress, useInvalidateSetup } from './bmad-setup-api';

/**
 * BMad Method's setup panel (story 4.3): on Plan and Board when the project
 * has no `_bmad/` (or a setup runs), and inline in Workspace settings. Not
 * set up: one sentence and Set up. Running: the four steps, each done,
 * current or still to come, as `bmad.setup_progress` reports them. Failed:
 * the plain reason and Set up again. Done: "Ready to plan." Every text
 * comes from `@ogden-agents/shared`. Entry 4.11: in `upgrade` mode (Upgrade
 * this project) the same progress list, without the Set up row and without a
 * retry button after a failure (the reduced-mode notice's Upgrade is the
 * retry), and the upgrade's done line only once the completed status lacks
 * no capability; the caller announces the end in its own live region, and
 * the done line can take focus.
 */

/** What a setup run is: Set up (no `_bmad/`) or Upgrade this project (entry 4.11). */
export type BmadSetupMode = 'setup' | 'upgrade';

export type BmadSetupPhase = 'idle' | 'starting' | 'running' | 'failed' | 'done';

export interface BmadSetupViewProps {
  phase: BmadSetupPhase;
  /** The steps reported so far, in order. */
  steps: readonly BmadSetupProgress[];
  /** Why the setup failed (`phase: 'failed'`), or why it couldn't be started. */
  reason?: string | undefined;
  onSetUp: () => void;
  /** Hide the not-set-up sentence (the settings' status line already says it). */
  compact?: boolean;
  /** Set up (default) or an upgrade's progress (entry 4.11): no Set up row, no retry button, its own done line. */
  mode?: BmadSetupMode;
  /** The completed run's status: in `upgrade` mode the done line shows only when it lacks no capability. */
  completed?: BmadSetupStatus | undefined;
}

/** Whether an upgrade that completed with `completed` may say it is done: nothing it needs is still missing. */
export function upgradeComplete(completed: BmadSetupStatus | undefined): boolean {
  return completed !== undefined && (completed.missingCapabilities ?? []).length === 0;
}

/** Each shared step's state: done once a later one began, current while it is the latest, pending before. */
function stepStates(steps: readonly BmadSetupProgress[], phase: BmadSetupPhase) {
  const reached = steps.length === 0 ? -1 : Math.max(...steps.map((step) => BMAD_SETUP_STEPS.indexOf(step.step as (typeof BMAD_SETUP_STEPS)[number])));
  return BMAD_SETUP_STEPS.map((step, index) => {
    const label = steps.find((each) => each.step === step)?.label ?? BMAD_SETUP_STEP_LABELS[step];
    const state = phase === 'done' || index < reached ? 'done' : index === reached && phase !== 'failed' ? 'current' : index === reached ? 'failed' : 'pending';
    return { step, label, state } as const;
  });
}

export function BmadSetupView({ phase, steps, reason, onSetUp, compact = false, mode = 'setup', completed }: BmadSetupViewProps) {
  const busy = phase === 'starting' || phase === 'running';
  const showSteps = busy || ((phase === 'failed' || phase === 'done') && steps.length > 0);
  const upgrade = mode === 'upgrade';
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-3" data-testid="bmad-setup-panel" data-phase={phase} data-mode={mode}>
      {!upgrade && (phase === 'idle' || phase === 'starting') ? (
        <div className="flex flex-wrap items-center gap-3">
          {compact ? null : (
            <Text className="min-w-0 flex-1" data-testid="bmad-setup-text">
              {BMAD_NOT_SET_UP_TEXT}
            </Text>
          )}
          <Button aria-disabled={busy} onClick={busy ? undefined : onSetUp} data-testid="bmad-set-up">
            {BMAD_SET_UP_LABEL}
          </Button>
        </div>
      ) : null}
      {showSteps ? (
        <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label={BMAD_SETUP_PROGRESS_LABEL} aria-busy={busy} data-testid="bmad-setup-steps">
          {stepStates(steps, phase).map(({ step, label, state }) => (
            <li
              key={step}
              className="flex items-center gap-2 text-label"
              data-testid="bmad-setup-step"
              data-step={step}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <StateGlyph
                state={state === 'done' ? 'done' : state === 'current' ? 'working' : state === 'failed' ? 'error' : 'idle'}
                labelMode="none"
              />
              <span className={state === 'pending' ? 'text-muted-foreground' : undefined}>{label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {phase === 'failed' ? (
        <Notice
          variant="blocked"
          role={upgrade ? undefined : 'alert'}
          data-testid="bmad-setup-failed"
          action={
            upgrade ? undefined : (
              <Button variant="outline" onClick={onSetUp} data-testid="bmad-set-up-again">
                {BMAD_SET_UP_AGAIN_LABEL}
              </Button>
            )
          }
        >
          {reason ?? BMAD_SETUP_FAILED}
        </Notice>
      ) : null}
      {phase === 'idle' && reason !== undefined ? (
        <Text variant="caption" role="alert" data-testid="bmad-setup-error">
          {reason}
        </Text>
      ) : null}
      {phase === 'done' && !upgrade ? (
        <Text role="status" data-testid="bmad-setup-done">
          {BMAD_SETUP_DONE_TEXT}
        </Text>
      ) : null}
      {phase === 'done' && upgrade && upgradeComplete(completed) ? (
        // Announced by the caller's live region; focusable so focus can land here when the notice it was on goes.
        <Text tabIndex={-1} className="outline-none" data-testid="bmad-upgrade-done">
          {BMAD_UPGRADE_DONE_TEXT}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * The setup's state for one workspace, from its events, and Set up: a
 * request in flight is `starting` until the server's `bmad.setup_started`
 * arrives (or the request fails). A setup's done or failed line shows only
 * when this view started it or saw it start live, never for replayed
 * history (review Q3). `alreadySetUp`: the server refused Set up because the
 * project has a `_bmad` entry (review Q7). `start(true)` is Upgrade this
 * project (entry 4.11); `mode` is what this view last started.
 */
export function useBmadSetup(wsId: string) {
  const progress = useBmadSetupProgress(wsId);
  const invalidate = useInvalidateSetup(wsId);
  /** The `seq` seen when Set up was pressed, while its request is answered or its start event awaited. */
  const [requestedAt, setRequestedAt] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  /** The `seq` when the start `error` refused was asked for: a refusal newer than the last run's end shows instead of that run (entry 4.11). */
  const [refusedAt, setRefusedAt] = useState<number | undefined>(undefined);
  const [alreadySetUp, setAlreadySetUp] = useState(false);
  const [mode, setMode] = useState<BmadSetupMode>('setup');
  const started = requestedAt !== undefined && progress.startedSeq > requestedAt;
  const waiting = requestedAt !== undefined && !started;
  // A run this view saw running (mounted mid-run, or started in another tab) is live too (entry 4.11).
  const sawRunning = useRef<number | undefined>(undefined);
  if (progress.running) sawRunning.current = progress.startedSeq;
  // Started by this view, seen starting after the backlog arrived, or seen running.
  const live = started || (progress.liveAfter !== undefined && progress.startedSeq > progress.liveAfter) || (sawRunning.current !== undefined && sawRunning.current === progress.startedSeq);

  // Refused after the last run ended (Upgrade again, say): the refusal shows, not that run's end.
  const refusedSince = error !== undefined && refusedAt !== undefined && progress.seq <= refusedAt;

  let phase: BmadSetupPhase;
  if (progress.running) phase = 'running';
  else if (waiting) phase = 'starting';
  else if (refusedSince) phase = 'idle';
  else if (live && progress.failedReason !== undefined) phase = 'failed';
  else if (live && progress.completed !== undefined) phase = 'done';
  else phase = 'idle';

  const start = (upgrade = false) => {
    if (phase === 'starting' || phase === 'running') return;
    setError(undefined);
    setAlreadySetUp(false);
    setMode(upgrade ? 'upgrade' : 'setup');
    const askedAt = progress.lastSeq;
    setRequestedAt(askedAt);
    startBmadSetup(wsId, upgrade ? { upgrade: true } : {}).then(
      () => {
        // The events say the rest; `requestedAt` clears once they arrive (`started`).
      },
      (failure: unknown) => {
        setRequestedAt(undefined);
        // Already set up after all: the detection was stale, so the page shows its content once it refetches.
        if (isApiError(failure, 'bmad_already_set_up')) {
          setAlreadySetUp(true);
          invalidate();
        }
        setRefusedAt(askedAt);
        setError(failure instanceof Error && failure.message !== '' ? failure.message : BMAD_SETUP_FAILED);
      },
    );
  };
  return {
    phase,
    steps: progress.steps,
    reason: phase === 'failed' ? progress.failedReason : error,
    start,
    running: progress.running,
    alreadySetUp,
    mode,
    /** Whether the latest run is one this view started (its `mode` is then that run's). */
    ownRun: started,
    /** The latest run's status when it completed. */
    completed: progress.completed,
  };
}

/** The panel for one workspace. */
export function BmadSetupPanel({ wsId, compact }: { wsId: string; compact?: boolean }) {
  const setup = useBmadSetup(wsId);
  return <BmadSetupView phase={setup.phase} steps={setup.steps} reason={setup.reason} onSetUp={() => setup.start()} compact={compact} />;
}

/**
 * Plan's and Board's gate (story 4.3): the setup panel instead of `children`
 * while the project has no `_bmad/` (the lstat-only detection, so a page view
 * never runs `setup.py`) or a setup runs; `children` otherwise, with the done
 * line above them right after a setup here finished. An upgrade (entry 4.11)
 * runs in a project with `_bmad/`: the page stays, and its reduced-mode
 * notice shows the progress.
 */
export function BmadSetupGate({ wsId, children }: { wsId: string; children: ReactNode }) {
  const detection = useBmadDetection(wsId);
  const setup = useBmadSetup(wsId);
  // Unknown (loading, or a failed check) shows the page: its own fetches say what's wrong.
  const needsSetup = detection.data !== undefined && !detection.data.hasBmad;
  // Whether this gate showed the setup panel: only then is a finished run its setup (an upgrade never is).
  const showedPanel = useRef(false);
  // A `_bmad` link or file reads as no `_bmad/`, and the server refuses Set up: say so instead of offering it again (review Q7).
  if (needsSetup && setup.alreadySetUp && setup.phase === 'idle') {
    return (
      <Notice variant="blocked" role="alert" data-testid="bmad-setup-unusable">
        {BMAD_SETUP_UNUSABLE_TEXT}
      </Notice>
    );
  }
  if (needsSetup || ((setup.phase === 'running' || setup.phase === 'starting') && detection.data?.hasBmad !== true)) {
    // Only a project known to lack `_bmad/` (never while the detection loads) makes a finished run this gate's setup.
    if (needsSetup) showedPanel.current = true;
    return <BmadSetupView phase={setup.phase} steps={setup.steps} reason={setup.reason} onSetUp={() => setup.start()} />;
  }
  return (
    <>
      {setup.phase === 'done' && showedPanel.current ? (
        <Text role="status" className="mb-3" data-testid="bmad-setup-done">
          {BMAD_SETUP_DONE_TEXT}
        </Text>
      ) : null}
      {children}
    </>
  );
}
