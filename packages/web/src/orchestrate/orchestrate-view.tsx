import {
  MANAGER_LIMITS,
  ORCHESTRATION_BUILD_BUTTON,
  ORCHESTRATION_BUILD_STEP_NOTE,
  ORCHESTRATION_DECISION_UNAVAILABLE_WORDS,
  ORCHESTRATION_MODE_INFO,
  ORCHESTRATION_NEEDS_YOUR_APPROVAL,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  ORCHESTRATION_TOLD_WORDS,
  ORCHESTRATION_WAITING_BUILD_WORDS,
  ORCHESTRATION_WAITING_CARD_WORDS,
  ORCHESTRATION_WAITING_INTERRUPTED_WORDS,
  REVIEW_LIMITS,
  orchestrationBuildTitle,
  orchestrationReviewNote,
  orchestrationStopWords,
  type OrchestrationActivityEntry,
  type OrchestrationMode,
  type OrchestrationRunView,
  type OrchestrationStepView,
} from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';

/**
 * The Orchestrate page's body (epic 15, 15.3 the tracer, 15.6 the plan review):
 * a goal box, the manager's plan listed as steps, and for each step its worker,
 * chat, instruction, requested mode and prerequisites, with Edit, Skip, move up
 * and down, Approve and send, then where it went and how the worker is doing.
 * A Stop ends the run. It only shows and asks: core decides what may be
 * approved, changed, moved or sent, and the page shows its plain refusal.
 * While the manager works the page says so, and nothing else is held. Plain
 * words, no dashes.
 */

/** What the page says first: every instruction waits for the user (the mode is fixed to this for now). */
const ORCHESTRATE_INTRO = 'A manager turns your goal into steps for your agents. You see every instruction here, and you can stop at any time.';

/** What the page says while the manager works: nothing else on the page, and none of the workers' chats, waits for it. */
const THINKING_WORDS = 'The manager is thinking. A small model on a modest computer can take a minute. Your chats keep working, and you can leave this page.';

const STEP_STATE_WORDS: Readonly<Record<OrchestrationStepView['state'], string>> = {
  proposed: 'Waiting for you',
  approved: 'Approved, not sent yet',
  skipped: 'Skipped',
  dispatched: 'Sent, the worker is on it',
  done: 'Finished',
  failed: 'Failed',
};

const RUN_STATE_WORDS: Readonly<Record<OrchestrationRunView['run']['state'], string>> = {
  planning: 'The manager is thinking',
  awaiting_user: 'Waiting for you',
  running: 'Working',
  paused: 'Paused, waiting for you',
  stopped: 'Stopped',
  finished: 'Finished',
  failed: 'The run failed',
};

/** What a build step reads as, in its own words: it is a build the user starts, not an instruction that is sent. */
const BUILD_STATE_WORDS: Readonly<Record<OrchestrationStepView['state'], string>> = {
  proposed: 'Waiting for you to start the build',
  approved: 'Waiting for you to start the build',
  skipped: 'Skipped',
  dispatched: 'Building',
  done: 'Built, ready for you to review',
  failed: 'The build did not finish',
};

/** The words for a step once its run has been stopped: what was never sent, and what was cut off. */
const STOPPED_STEP_WORDS: Partial<Record<OrchestrationStepView['state'], string>> = {
  proposed: 'Not sent. The run was stopped.',
  approved: 'Not sent. The run was stopped.',
  failed: 'Stopped before it finished',
};
/** A failed step the worker's own error caused keeps its own words even in a stopped run. */

const isLive = (state: OrchestrationRunView['run']['state']): boolean => state === 'planning' || state === 'awaiting_user' || state === 'running' || state === 'paused';
const canChange = (state: OrchestrationStepView['state']): boolean => state === 'proposed' || state === 'approved';

export interface OrchestrateViewProps {
  wsId: string;
  /** Whether a manager is set up in this install. */
  managerReady: boolean;
  /** Where the manager stands in plain words (15.4): why it is not ready, or where it runs. Absent from an older server. */
  managerMessage?: string | undefined;
  /** The latest run, if any. */
  run: OrchestrationRunView | undefined;
  /** A request is in flight (starting, approving or sending). */
  busy: boolean;
  /** Why the last request failed, in plain words. */
  error: string | undefined;
  onStart: (goal: string) => void;
  onApprove: (stepId: string) => void;
  onSend: (stepId: string) => void;
  /** Saves a new instruction; resolves true when it was kept (the editor closes), false when the server refused (it stays open with the reason). */
  onEdit: (stepId: string, instruction: string) => Promise<boolean>;
  onSkip: (stepId: string) => void;
  /** The whole new order of the steps, by step id. */
  onReorder: (order: string[]) => void;
  onStop: () => void;
  /** Opens the Build dialog for a build step (15.11): the page holds the dialog, so the person confirms there and nowhere else. */
  onOpenBuild?: ((stepId: string, ticketRef: string) => void) | undefined;
  /** Sends the user's answer to the manager's question; resolves true when it was kept (the box clears). */
  onAnswer?: ((answer: string) => Promise<boolean>) | undefined;
  /** A stop request is in flight. */
  stopping: boolean;
  /** The project's mode now (15.8). Absent from an older server: Approve each instruction. */
  mode?: OrchestrationMode | undefined;
  /** The activity log, newest first (15.8); `undefined` while it loads. */
  activity?: readonly OrchestrationActivityEntry[] | undefined;
  /** Why the activity log could not be read. */
  activityError?: string | undefined;
}

/** The actions the plan review gives each step. */
interface StepActions {
  busy: boolean;
  onApprove: (stepId: string) => void;
  onSend: (stepId: string) => void;
  onEdit: (stepId: string, instruction: string) => Promise<boolean>;
  onSkip: (stepId: string) => void;
  onMove: (stepId: string, by: -1 | 1) => void;
  onOpenBuild?: ((stepId: string, ticketRef: string) => void) | undefined;
}

export function OrchestrateView({ wsId, managerReady, managerMessage, run, busy, error, onStart, onApprove, onSend, onEdit, onSkip, onReorder, onStop, onOpenBuild, onAnswer, stopping, mode = 'approve_each', activity, activityError }: OrchestrateViewProps) {
  const [goal, setGoal] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (goal.trim() === '' || busy || !managerReady) return;
    onStart(goal);
  };
  return (
    <div className="flex flex-col gap-6" data-testid="orchestrate">
      <PageSection title="Goal">
        <Text>{ORCHESTRATE_INTRO}</Text>
        <Text variant="caption" data-testid="orchestrate-mode" data-mode={mode}>
          Mode: {ORCHESTRATION_MODE_INFO[mode].label}. {ORCHESTRATION_MODE_INFO[mode].sentence} You can change it in the project settings.
        </Text>
        {managerReady ? (
          managerMessage === undefined ? null : (
            <Text variant="caption" data-testid="orchestrate-manager" data-manager="ready">
              {managerMessage}
            </Text>
          )
        ) : (
          <Notice data-testid="orchestrate-no-manager" role="status">
            {managerMessage ?? ORCHESTRATION_NO_MANAGER_MESSAGE}
          </Notice>
        )}
        <form className="flex flex-col gap-3" onSubmit={submit} data-testid="orchestrate-goal-form">
          <Field id="orchestrate-goal" label="What should get done?" description="One or two sentences. The manager turns it into steps for your agents.">
            <Input id="orchestrate-goal" data-testid="orchestrate-goal" value={goal} maxLength={MANAGER_LIMITS.maxGoalChars} disabled={busy || !managerReady} onChange={(event) => setGoal(event.target.value)} />
          </Field>
          <Button type="submit" className="self-start" data-testid="orchestrate-plan" aria-disabled={busy || !managerReady || goal.trim() === ''}>
            {busy && run === undefined ? 'Making a plan...' : 'Make a plan'}
          </Button>
        </form>
        {busy && (run === undefined || run.run.state === 'planning') ? <Thinking /> : null}
        {error === undefined ? null : (
          <Notice variant="blocked" role="alert" data-testid="orchestrate-error">
            {error}
          </Notice>
        )}
      </PageSection>
      {run === undefined ? null : <RunSection wsId={wsId} view={run} where={managerReady ? managerMessage : undefined} busy={busy} stopping={stopping} onApprove={onApprove} onSend={onSend} onEdit={onEdit} onSkip={onSkip} onReorder={onReorder} onStop={onStop} onOpenBuild={onOpenBuild} onAnswer={onAnswer} />}
      <ActivityLog wsId={wsId} entries={activity} error={activityError} />
    </div>
  );
}

function Thinking() {
  return (
    <Text variant="caption" role="status" data-testid="orchestrate-thinking">
      {THINKING_WORDS}
    </Text>
  );
}

interface RunSectionProps {
  wsId: string;
  view: OrchestrationRunView;
  /** Where the manager runs, in plain words, when it is set up. */
  where: string | undefined;
  busy: boolean;
  stopping: boolean;
  onApprove: (stepId: string) => void;
  onSend: (stepId: string) => void;
  onEdit: (stepId: string, instruction: string) => Promise<boolean>;
  onSkip: (stepId: string) => void;
  onReorder: (order: string[]) => void;
  onStop: () => void;
  onOpenBuild?: ((stepId: string, ticketRef: string) => void) | undefined;
  onAnswer?: ((answer: string) => Promise<boolean>) | undefined;
}

function RunSection({ wsId, view, where, busy, stopping, onApprove, onSend, onEdit, onSkip, onReorder, onStop, onOpenBuild, onAnswer }: RunSectionProps) {
  const { run, steps, waiting, decision } = view;
  const live = isLive(run.state);
  // While the run is paused on a worker's card, nothing is approved or sent from here: the user answers on the worker's own card.
  const canAct = live && run.state !== 'paused';
  const suggested = live && decision?.action === 'dispatch' && ['proposed', 'approved'].includes(steps.find((one) => one.stepId === decision.stepId)?.state ?? '') ? decision.stepId : undefined;
  const stateOf = new Map(steps.map((step) => [step.stepId, step.state]));
  // The instruction counter: what was sent, nothing about money.
  const sent = steps.filter((step) => step.sessionId !== null).length;
  const move = (stepId: string, by: -1 | 1) => {
    const ids = steps.map((step) => step.stepId);
    const at = ids.indexOf(stepId);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    onReorder(ids);
  };
  return (
    <PageSection title="Plan" data-testid="orchestrate-run" data-run-state={run.state}>
      <Text variant="label" data-testid="orchestrate-run-goal">
        {run.goal}
      </Text>
      <div className="flex flex-wrap items-center gap-3">
        <Text variant="caption" data-testid="orchestrate-run-state">
          {run.state === 'failed' && run.stopReason === 'worker_error' ? 'A worker hit an error, so the run stopped' : RUN_STATE_WORDS[run.state]}
        </Text>
        {live ? (
          <Button variant="destructive" size="sm" data-testid="orchestrate-stop" aria-disabled={stopping} onClick={stopping ? undefined : onStop}>
            {stopping ? 'Stopping...' : 'Stop'}
          </Button>
        ) : null}
      </div>
      <Text variant="caption" data-testid="orchestrate-run-counter">
        {sent} of {run.limits.maxInstructions} {run.limits.maxInstructions === 1 ? 'instruction' : 'instructions'} sent
        {run.mode === 'automatic' ? '. Dispatching automatically.' : '.'}
      </Text>
      {where === undefined ? null : (
        <Text variant="caption" data-testid="orchestrate-run-where">
          {where}
        </Text>
      )}
      {run.state === 'planning' || view.thinking === true ? <Thinking /> : null}
      {run.stopReason === 'user' && run.state === 'stopped' ? (
        <Text variant="caption" data-testid="orchestrate-stopped-note">
          {orchestrationStopWords('user', run.limits)}
        </Text>
      ) : null}
      {run.stopReason !== null && run.stopReason !== 'user' && run.stopReason !== 'worker_error' && (run.state === 'stopped' || run.state === 'failed') ? (
        <Notice variant="info" infoGlyph role="status" data-testid="orchestrate-stop-reason" data-stop-reason={run.stopReason}>
          {orchestrationStopWords(run.stopReason, run.limits)}
        </Notice>
      ) : null}
      {waiting == null ? null : <WaitingNote wsId={wsId} waiting={waiting} onAnswer={onAnswer} onOpenBuild={canAct ? onOpenBuild : undefined} busy={busy} />}
      <DecisionNote view={view} />
      {waiting == null && run.mode === 'automatic' && run.state === 'awaiting_user' && steps.some((step) => step.state === 'proposed' && step.dependsOn.every((id) => stateOf.get(id) === 'done')) ? (
        <Text variant="caption" data-testid="orchestrate-needs-approval">
          {ORCHESTRATION_NEEDS_YOUR_APPROVAL}
        </Text>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="orchestrate-steps">
        {steps.map((step, at) => (
          <StepRow
            key={step.stepId}
            wsId={wsId}
            step={step}
            stateOf={stateOf}
            first={at === 0}
            last={at === steps.length - 1}
            live={canAct}
            stopped={run.state === 'stopped'}
            ended={run.state === 'finished' || run.state === 'failed' ? run.state : undefined}
            denied={run.stopReason === 'permission_denied'}
            suggested={suggested === step.stepId}
            actions={{ busy, onApprove, onSend, onEdit, onSkip, onMove: move, onOpenBuild }}
          />
        ))}
      </ol>
    </PageSection>
  );
}

/** Where a step goes: a new chat, or one the manager named. */
const chatWords = (step: OrchestrationStepView): string => (step.chat === 'new' ? 'a new chat' : 'an existing chat');

interface StepRowProps {
  wsId: string;
  step: OrchestrationStepView;
  /** The state of every step of the run, by id, to say what this one waits for. */
  stateOf: ReadonlyMap<string, OrchestrationStepView['state']>;
  first: boolean;
  last: boolean;
  live: boolean;
  stopped: boolean;
  /** The run ended another way than a stop: finished (steps never sent are not needed) or failed. */
  ended?: 'finished' | 'failed' | undefined;
  /** A Deny ended the run: the step that failed was the one denied. */
  denied?: boolean | undefined;
  /** The manager suggested this step as the next one (15.9). */
  suggested?: boolean | undefined;
  actions: StepActions;
}

function StepRow({ wsId, step, stateOf, first, last, live, stopped, ended, denied = false, suggested = false, actions }: StepRowProps) {
  const { busy, onApprove, onSend, onEdit, onSkip, onMove, onOpenBuild } = actions;
  /** A build step (15.11): a proposed build of a ticket, started only by the user in the Build dialog. */
  const build = step.build ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(step.instruction);
  const waitingOn = step.dependsOn.filter((id) => stateOf.get(id) !== 'done');
  const skippedNeeds = waitingOn.filter((id) => stateOf.get(id) === 'skipped');
  const ready = waitingOn.length === 0;
  const changeable = live && canChange(step.state);
  /** A build step has nothing to edit and nothing to approve here: only the Build dialog moves it. */
  const editable = changeable && build === null;
  const stateWords =
    (denied && step.state === 'failed' ? 'Denied, the step ended' : undefined) ??
    (ended === 'finished' && (step.state === 'proposed' || step.state === 'approved') ? 'Not needed, the manager said the goal is done' : undefined) ??
    (stopped && !(step.state === 'failed' && step.sessionState === 'error') ? STOPPED_STEP_WORDS[step.state] : undefined) ??
    (build !== null && !(stopped && (step.state === 'proposed' || step.state === 'approved')) ? BUILD_STATE_WORDS[step.state] : undefined) ??
    STEP_STATE_WORDS[step.state];
  const save = () => {
    if (busy || text.trim() === '') return;
    void onEdit(step.stepId, text).then((kept) => {
      if (kept) setEditing(false);
    });
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-(--panel-padding)" data-testid="orchestrate-step" data-step-id={step.stepId} data-state={step.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Text variant="label">Step {step.stepId}</Text>
        {build === null ? (
          <Badge variant="outline" data-testid="orchestrate-step-worker">
            {step.workerLabel}
          </Badge>
        ) : (
          <Badge variant="outline" data-testid="orchestrate-step-build-badge">
            {orchestrationBuildTitle(build.ticketRef)}
          </Badge>
        )}
        <Badge data-testid="orchestrate-step-state">{stateWords}</Badge>
        {step.reviewOf === null ? null : (
          <Badge variant="outline" data-testid="orchestrate-step-review-badge">
            Review of step {step.reviewOf}
          </Badge>
        )}
        {suggested ? (
          <Badge variant="outline" data-testid="orchestrate-step-suggested">
            The manager suggests this next
          </Badge>
        ) : null}
        {step.approvedBy === 'mode' && step.state !== 'proposed' ? (
          <Badge variant="outline" data-testid="orchestrate-step-approver">
            Sent automatically
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {build === null ? (
          <>
            <Text variant="caption" data-testid="orchestrate-step-target">
              Goes to {chatWords(step)}
            </Text>
            <Text variant="caption" data-testid="orchestrate-step-mode">
              Mode: Ask
            </Text>
          </>
        ) : null}
        <Text variant="caption" data-testid="orchestrate-step-needs">
          {step.dependsOn.length === 0 ? 'Needs nothing first' : `Needs ${step.dependsOn.join(', ')} first`}
        </Text>
      </div>
      {editing && editable ? (
        <div className="flex flex-col gap-2" data-testid="orchestrate-edit-form">
          <Textarea
            aria-label={`Instruction for step ${step.stepId}`}
            data-testid="orchestrate-edit-text"
            value={text}
            maxLength={step.reviewOf === null ? MANAGER_LIMITS.maxInstructionChars : REVIEW_LIMITS.maxQuestionChars}
            onChange={(event) => setText(event.target.value)}
            className="rounded-lg border border-border p-2"
          />
          <div className="flex gap-2">
            <Button size="sm" data-testid="orchestrate-edit-save" aria-disabled={busy || text.trim() === ''} onClick={save}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="orchestrate-edit-cancel"
              onClick={() => {
                setEditing(false);
                setText(step.instruction);
              }}
            >
              Cancel
            </Button>
          </div>
          {step.state === 'approved' ? (
            <Text variant="caption" data-testid="orchestrate-edit-note">
              This step is approved. A change takes the approval back, and you will need to approve it again.
            </Text>
          ) : null}
        </div>
      ) : (
        <Text data-testid="orchestrate-step-instruction" className="whitespace-pre-wrap">
          {build === null ? step.instruction : `Why: ${step.instruction}`}
        </Text>
      )}
      {build === null ? null : (
        <Text variant="caption" data-testid="orchestrate-step-build-note">
          {ORCHESTRATION_BUILD_STEP_NOTE}
        </Text>
      )}
      {step.reviewOf === null ? null : (
        <div className="flex flex-col gap-1" data-testid="orchestrate-step-review">
          <Text variant="caption" data-testid="orchestrate-step-review-note">
            {orchestrationReviewNote(step.reviewOf)}
          </Text>
          {step.review == null ? null : step.review.kind === 'build_review' ? (
            <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: step.review.ticketRef }} className="text-label underline" data-testid="orchestrate-step-review-link" data-review-kind="build_review">
              Open the review page for step {step.reviewOf}
            </Link>
          ) : (
            <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: step.review.sessionId }} className="text-label underline" data-testid="orchestrate-step-review-link" data-review-kind="worker_chat">
              Open the chat that did step {step.reviewOf}
            </Link>
          )}
        </div>
      )}
      {step.state === 'proposed' && !ready && live ? (
        <Text variant="caption" data-testid="orchestrate-step-waits">
          {skippedNeeds.length === 0
            ? `Waits for ${waitingOn.join(', ')} to finish.`
            : `Waits for ${waitingOn.join(', ')}. ${skippedNeeds.join(', ')} ${skippedNeeds.length === 1 ? 'was' : 'were'} skipped, so this step will not go ahead. Skip it too if you do not want it.`}
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {live && build !== null && step.state === 'proposed' && ready && onOpenBuild !== undefined ? (
          <Button size="sm" data-testid="orchestrate-build-open" aria-disabled={busy} onClick={busy ? undefined : () => onOpenBuild(step.stepId, build.ticketRef)}>
            {ORCHESTRATION_BUILD_BUTTON}
          </Button>
        ) : null}
        {live && build === null && step.state === 'proposed' && ready ? (
          <Button size="sm" data-testid="orchestrate-approve" aria-disabled={busy} onClick={busy ? undefined : () => onApprove(step.stepId)}>
            Approve and send
          </Button>
        ) : null}
        {live && build === null && step.state === 'approved' ? (
          <Button size="sm" data-testid="orchestrate-send" aria-disabled={busy} onClick={busy ? undefined : () => onSend(step.stepId)}>
            Send
          </Button>
        ) : null}
        {editable && !editing ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="orchestrate-edit"
            aria-disabled={busy}
            onClick={
              busy
                ? undefined
                : () => {
                    setText(step.instruction);
                    setEditing(true);
                  }
            }
          >
            Edit
          </Button>
        ) : null}
        {changeable ? (
          <Button size="sm" variant="outline" data-testid="orchestrate-skip" aria-disabled={busy} onClick={busy ? undefined : () => onSkip(step.stepId)}>
            Skip
          </Button>
        ) : null}
        {changeable ? (
          <>
            <Button size="sm" variant="ghost" data-testid="orchestrate-move-up" aria-label={`Move step ${step.stepId} up`} aria-disabled={busy || first} onClick={busy || first ? undefined : () => onMove(step.stepId, -1)}>
              Move up
            </Button>
            <Button size="sm" variant="ghost" data-testid="orchestrate-move-down" aria-label={`Move step ${step.stepId} down`} aria-disabled={busy || last} onClick={busy || last ? undefined : () => onMove(step.stepId, 1)}>
              Move down
            </Button>
          </>
        ) : null}
      </div>
      {build === null || step.buildRun == null ? null : (
        <div className="flex flex-col gap-1" data-testid="orchestrate-step-build" data-build-outcome={step.buildRun.outcome}>
          <Text variant="caption" data-testid="orchestrate-step-build-state">
            {step.state === 'dispatched' ? 'The build is running.' : step.state === 'done' ? 'The build passed its checks and waits for your review. Nothing is merged until you approve it.' : 'The build did not pass or did not finish.'}
          </Text>
          {step.buildRun.checks === null ? null : (
            <Text variant="caption" data-testid="orchestrate-step-build-checks">
              Checks: {step.buildRun.checks.passed} passed, {step.buildRun.checks.failed} failed, {step.buildRun.checks.notRun} not run.
            </Text>
          )}
          {step.buildRun.decision === null ? null : (
            <Text variant="caption" data-testid="orchestrate-step-build-decision">
              You {step.buildRun.decision === 'approved' ? 'approved and merged' : 'rejected'} this build.
            </Text>
          )}
          <div className="flex flex-wrap gap-3">
            <Link to="/w/$wsId/runs" params={{ wsId }} className="text-label underline" data-testid="orchestrate-step-build-runs">
              Open Runs
            </Link>
            <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: build.ticketRef }} className="text-label underline" data-testid="orchestrate-step-build-review">
              Open the review page
            </Link>
          </div>
        </div>
      )}
      {step.sessionId === null ? null : (
        <div className="flex flex-col gap-1" data-testid="orchestrate-step-status">
          <Text variant="caption" data-testid="orchestrate-step-session-state" data-session-state={step.sessionState ?? undefined}>
            The worker is {step.sessionState === 'working' ? 'working' : step.sessionState === 'waiting' ? 'waiting for you' : step.sessionState === 'error' ? 'stuck on an error' : 'idle'}.
          </Text>
          {step.report === null || step.report.summary === '' ? null : (
            <Text as="pre" variant="mono-compact" className="m-0 max-h-48 overflow-auto whitespace-pre-wrap" data-testid="orchestrate-step-report">
              {step.report.summary}
            </Text>
          )}
          {step.report?.truncated === true ? (
            <Text variant="caption" data-testid="orchestrate-step-truncated">
              This is the start of a longer reply. Open the chat to read all of it.
            </Text>
          ) : null}
          <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: step.sessionId }} className="text-label underline" data-testid="orchestrate-step-chat">
            Open the worker chat
          </Link>
        </div>
      )}
    </li>
  );
}

/** Why the run waits, in plain words: a worker's card (answered on the worker's own card), the manager's question, or a worker the restart cut off. */
function WaitingNote({ wsId, waiting, onAnswer, onOpenBuild, busy }: { wsId: string; waiting: NonNullable<OrchestrationRunView['waiting']>; onAnswer?: ((answer: string) => Promise<boolean>) | undefined; onOpenBuild?: ((stepId: string, ticketRef: string) => void) | undefined; busy: boolean }) {
  const [answer, setAnswer] = useState('');
  if (waiting.kind === 'question') {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (answer.trim() === '' || busy || onAnswer === undefined) return;
      void onAnswer(answer).then((kept) => {
        if (kept) setAnswer('');
      });
    };
    return (
      <Notice variant="info" infoGlyph role="status" data-testid="orchestrate-waiting" data-waiting="question">
        <div className="flex flex-col gap-2">
          <Text variant="label">The manager is asking you a question</Text>
          <Text data-testid="orchestrate-question">{waiting.question}</Text>
          <form className="flex flex-col gap-2" onSubmit={submit} data-testid="orchestrate-answer-form">
            <Field id="orchestrate-answer" label="Your answer" description="The manager reads it as information, then decides what comes next.">
              <Input id="orchestrate-answer" data-testid="orchestrate-answer" value={answer} maxLength={MANAGER_LIMITS.maxGoalChars} disabled={busy} onChange={(event) => setAnswer(event.target.value)} />
            </Field>
            <Button type="submit" size="sm" className="self-start" data-testid="orchestrate-answer-send" aria-disabled={busy || answer.trim() === ''}>
              Send answer
            </Button>
          </form>
        </div>
      </Notice>
    );
  }
  if (waiting.kind === 'build') {
    return (
      <Notice variant="info" infoGlyph role="status" data-testid="orchestrate-waiting" data-waiting="build">
        <div className="flex flex-col gap-2">
          <Text data-testid="orchestrate-waiting-words">{ORCHESTRATION_WAITING_BUILD_WORDS}</Text>
          {onOpenBuild === undefined ? null : (
            <Button size="sm" className="self-start" data-testid="orchestrate-waiting-build-open" aria-disabled={busy} onClick={busy ? undefined : () => onOpenBuild(waiting.stepId, waiting.ticketRef)}>
              {ORCHESTRATION_BUILD_BUTTON}
            </Button>
          )}
        </div>
      </Notice>
    );
  }
  const card = waiting.kind === 'permission_card';
  return (
    <Notice variant="info" infoGlyph role="status" data-testid="orchestrate-waiting" data-waiting={waiting.kind}>
      <div className="flex flex-col gap-2">
        <Text data-testid="orchestrate-waiting-words">{card ? ORCHESTRATION_WAITING_CARD_WORDS : ORCHESTRATION_WAITING_INTERRUPTED_WORDS}</Text>
        <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: waiting.sessionId }} className="text-label underline" data-testid="orchestrate-waiting-chat">
          {card ? 'Open the worker chat to answer the card' : 'Open the worker chat'}
        </Link>
      </div>
    </Notice>
  );
}

/** What the manager decided last, in plain words (15.9): its suggestion, its question's answer pending, that it said done or stop, or that it could not decide. */
function DecisionNote({ view }: { view: OrchestrationRunView }) {
  const { run, decision } = view;
  if (decision == null) return null;
  const live = isLive(run.state);
  let words: string | undefined;
  if (decision.told !== undefined) words = `${ORCHESTRATION_TOLD_WORDS[decision.told]} It said: ${decision.action === 'unavailable' ? 'nothing usable' : `${decision.action.replace('_', ' ')}. ${decision.reason}`}`;
  else if (decision.action === 'dispatch' && live) words = `The manager suggests step ${decision.stepId ?? ''} next. ${decision.reason}`;
  else if (decision.action === 'done') words = `The manager says the goal is done. ${decision.reason}`;
  else if (decision.action === 'stop') words = `The manager chose to stop. ${decision.reason}`;
  else if (decision.action === 'unavailable' && live) words = ORCHESTRATION_DECISION_UNAVAILABLE_WORDS;
  if (words === undefined) return null;
  return (
    <Text variant="caption" data-testid="orchestrate-decision" data-action={decision.action} data-told={decision.told}>
      {words}
    </Text>
  );
}

const ACTIVITY_RESULT_WORDS: Readonly<Record<OrchestrationActivityEntry['result'], string>> = {
  working: 'The worker is on it',
  finished: 'Finished',
  failed: 'Failed',
  refused: 'Not sent',
  stopped: 'Stopped before it finished',
  denied: 'Denied, the step ended',
};

/** When something happened, in the reader's own time zone, to the minute. */
const whenWords = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export interface ActivityLogProps {
  wsId: string;
  /** Newest first; `undefined` while loading. */
  entries: readonly OrchestrationActivityEntry[] | undefined;
  error?: string | undefined;
}

/**
 * The activity log (epic 15, 15.8): every instruction that was sent or refused in this project, read from the events: when, which
 * worker, which chat, who approved it and how it stands. Instructions only; nothing here counts money.
 */
export function ActivityLog({ wsId, entries, error }: ActivityLogProps) {
  return (
    <PageSection title="Activity" data-testid="orchestrate-activity">
      <Text variant="caption">Every instruction that was sent, or could not be, in this project.</Text>
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="orchestrate-activity-error">
          {error}
        </Notice>
      )}
      {entries === undefined || entries.length > 0 ? null : (
        <Text variant="caption" data-testid="orchestrate-activity-empty">
          Nothing has been sent yet.
        </Text>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="orchestrate-activity-list">
        {(entries ?? []).map((entry) => (
          <li key={`${entry.runId}:${entry.stepId}:${entry.kind}:${entry.at}`} className="flex flex-col gap-1 rounded-lg border border-border p-(--panel-padding)" data-testid="orchestrate-activity-entry" data-kind={entry.kind} data-result={entry.result}>
            <div className="flex flex-wrap items-center gap-2">
              <Text variant="label">Step {entry.stepId}</Text>
              <Badge variant="outline" data-testid="orchestrate-activity-worker">
                {entry.workerLabel}
              </Badge>
              <Badge data-testid="orchestrate-activity-result">{ACTIVITY_RESULT_WORDS[entry.result]}</Badge>
              <Text variant="caption" data-testid="orchestrate-activity-when">
                {whenWords(entry.at)}
              </Text>
            </div>
            <Text variant="caption" data-testid="orchestrate-activity-who">
              {entry.kind === 'refused' ? 'Not sent' : `Approved by ${entry.approvedBy === 'mode' ? 'the mode, automatically' : entry.approvedBy === 'user' ? 'you' : 'someone'}`}
              {entry.kind === 'refused' ? '' : `, sent to ${entry.chat === 'new' ? 'a new chat' : 'an existing chat'}`}
            </Text>
            <Text className="whitespace-pre-wrap" data-testid="orchestrate-activity-instruction">
              {entry.instruction}
            </Text>
            {entry.note === '' ? null : (
              <Text variant="caption" data-testid="orchestrate-activity-note">
                {entry.note}
              </Text>
            )}
            {entry.sessionId === null ? null : (
              <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: entry.sessionId }} className="text-label underline" data-testid="orchestrate-activity-chat">
                Open the chat
              </Link>
            )}
          </li>
        ))}
      </ol>
    </PageSection>
  );
}
