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
  type BmadSetupProgress,
} from '@ogden-agents/shared';
import { useState, type ReactNode } from 'react';
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
 * comes from `@ogden-agents/shared`.
 */

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

export function BmadSetupView({ phase, steps, reason, onSetUp, compact = false }: BmadSetupViewProps) {
  const busy = phase === 'starting' || phase === 'running';
  const showSteps = busy || ((phase === 'failed' || phase === 'done') && steps.length > 0);
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-3" data-testid="bmad-setup-panel" data-phase={phase}>
      {phase === 'idle' || phase === 'starting' ? (
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
          role="alert"
          data-testid="bmad-setup-failed"
          action={
            <Button variant="outline" onClick={onSetUp} data-testid="bmad-set-up-again">
              {BMAD_SET_UP_AGAIN_LABEL}
            </Button>
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
      {phase === 'done' ? (
        <Text role="status" data-testid="bmad-setup-done">
          {BMAD_SETUP_DONE_TEXT}
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
 * project has a `_bmad` entry (review Q7).
 */
export function useBmadSetup(wsId: string) {
  const progress = useBmadSetupProgress(wsId);
  const invalidate = useInvalidateSetup(wsId);
  /** The `seq` seen when Set up was pressed, while its request is answered or its start event awaited. */
  const [requestedAt, setRequestedAt] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [alreadySetUp, setAlreadySetUp] = useState(false);
  const started = requestedAt !== undefined && progress.startedSeq > requestedAt;
  const waiting = requestedAt !== undefined && !started;
  // Started by this view, or seen starting after the backlog arrived.
  const live = started || (progress.liveAfter !== undefined && progress.startedSeq > progress.liveAfter);

  let phase: BmadSetupPhase;
  if (progress.running) phase = 'running';
  else if (waiting) phase = 'starting';
  else if (live && progress.failedReason !== undefined) phase = 'failed';
  else if (live && progress.completed !== undefined) phase = 'done';
  else phase = 'idle';

  const start = () => {
    if (phase === 'starting' || phase === 'running') return;
    setError(undefined);
    setAlreadySetUp(false);
    setRequestedAt(progress.lastSeq);
    startBmadSetup(wsId).then(
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
        setError(failure instanceof Error && failure.message !== '' ? failure.message : BMAD_SETUP_FAILED);
      },
    );
  };
  return { phase, steps: progress.steps, reason: phase === 'failed' ? progress.failedReason : error, start, running: progress.running, alreadySetUp };
}

/** The panel for one workspace. */
export function BmadSetupPanel({ wsId, compact }: { wsId: string; compact?: boolean }) {
  const setup = useBmadSetup(wsId);
  return <BmadSetupView phase={setup.phase} steps={setup.steps} reason={setup.reason} onSetUp={setup.start} compact={compact} />;
}

/**
 * Plan's and Board's gate (story 4.3): the setup panel instead of `children`
 * while the project has no `_bmad/` (the lstat-only detection, so a page view
 * never runs `setup.py`) or a setup runs; `children` otherwise, with the done
 * line above them right after a setup here finished.
 */
export function BmadSetupGate({ wsId, children }: { wsId: string; children: ReactNode }) {
  const detection = useBmadDetection(wsId);
  const setup = useBmadSetup(wsId);
  // Unknown (loading, or a failed check) shows the page: its own fetches say what's wrong.
  const needsSetup = detection.data !== undefined && !detection.data.hasBmad;
  // A `_bmad` link or file reads as no `_bmad/`, and the server refuses Set up: say so instead of offering it again (review Q7).
  if (needsSetup && setup.alreadySetUp && setup.phase === 'idle') {
    return (
      <Notice variant="blocked" role="alert" data-testid="bmad-setup-unusable">
        {BMAD_SETUP_UNUSABLE_TEXT}
      </Notice>
    );
  }
  if (needsSetup || setup.phase === 'running' || setup.phase === 'starting') {
    return <BmadSetupView phase={setup.phase} steps={setup.steps} reason={setup.reason} onSetUp={setup.start} />;
  }
  return (
    <>
      {setup.phase === 'done' ? (
        <Text role="status" className="mb-3" data-testid="bmad-setup-done">
          {BMAD_SETUP_DONE_TEXT}
        </Text>
      ) : null}
      {children}
    </>
  );
}
