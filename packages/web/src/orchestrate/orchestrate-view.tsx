import { MANAGER_LIMITS, ORCHESTRATION_NO_MANAGER_MESSAGE, type OrchestrationRunView, type OrchestrationStepView } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';

/**
 * The Orchestrate page's body (epic 15, 15.3, the tracer): a goal box, the
 * manager's plan listed as steps, and for each step Approve and send, then
 * where it went and how the worker is doing. It only shows and asks: core
 * decides what may be approved or sent. Plain words, no dashes.
 */

/** What the page says first: every instruction waits for the user (the mode is fixed to this for now). */
const ORCHESTRATE_INTRO = 'A manager turns your goal into steps. You see every instruction and approve it before an agent gets it.';

const STEP_STATE_WORDS: Readonly<Record<OrchestrationStepView['state'], string>> = {
  proposed: 'Waiting for you',
  approved: 'Approved, not sent yet',
  skipped: 'Skipped',
  dispatched: 'Sent, the worker is on it',
  done: 'Finished',
  failed: 'Failed',
};

const RUN_STATE_WORDS: Readonly<Record<OrchestrationRunView['run']['state'], string>> = {
  planning: 'Making a plan',
  awaiting_user: 'Waiting for you',
  running: 'Working',
  paused: 'Paused',
  stopped: 'Stopped',
  finished: 'Finished',
  failed: 'The manager could not make a plan',
};

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
}

export function OrchestrateView({ wsId, managerReady, managerMessage, run, busy, error, onStart, onApprove, onSend }: OrchestrateViewProps) {
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
        {error === undefined ? null : (
          <Notice variant="blocked" role="alert" data-testid="orchestrate-error">
            {error}
          </Notice>
        )}
      </PageSection>
      {run === undefined ? null : <RunSection wsId={wsId} view={run} busy={busy} onApprove={onApprove} onSend={onSend} />}
    </div>
  );
}

function RunSection({ wsId, view, busy, onApprove, onSend }: { wsId: string; view: OrchestrationRunView; busy: boolean; onApprove: (stepId: string) => void; onSend: (stepId: string) => void }) {
  const { run, steps } = view;
  const doneIds = new Set(steps.filter((step) => step.state === 'done').map((step) => step.stepId));
  return (
    <PageSection title="Plan" data-testid="orchestrate-run" data-run-state={run.state}>
      <Text variant="label" data-testid="orchestrate-run-goal">
        {run.goal}
      </Text>
      <Text variant="caption" data-testid="orchestrate-run-state">
        {RUN_STATE_WORDS[run.state]}
      </Text>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="orchestrate-steps">
        {steps.map((step) => {
          const ready = step.dependsOn.every((id) => doneIds.has(id));
          return <StepRow key={step.stepId} wsId={wsId} step={step} ready={ready} busy={busy} onApprove={onApprove} onSend={onSend} />;
        })}
      </ol>
    </PageSection>
  );
}

function StepRow({ wsId, step, ready, busy, onApprove, onSend }: { wsId: string; step: OrchestrationStepView; ready: boolean; busy: boolean; onApprove: (stepId: string) => void; onSend: (stepId: string) => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-(--panel-padding)" data-testid="orchestrate-step" data-step-id={step.stepId} data-state={step.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Text variant="label">Step {step.stepId}</Text>
        <Badge variant="outline" data-testid="orchestrate-step-worker">
          {step.workerLabel}
        </Badge>
        <Badge data-testid="orchestrate-step-state">{STEP_STATE_WORDS[step.state]}</Badge>
      </div>
      <Text data-testid="orchestrate-step-instruction" className="whitespace-pre-wrap">
        {step.instruction}
      </Text>
      {step.state === 'proposed' && !ready ? (
        <Text variant="caption" data-testid="orchestrate-step-waits">
          Waits for {step.dependsOn.join(', ')} to finish.
        </Text>
      ) : null}
      {step.state === 'proposed' && ready ? (
        <Button className="self-start" data-testid="orchestrate-approve" aria-disabled={busy} onClick={busy ? undefined : () => onApprove(step.stepId)}>
          Approve and send
        </Button>
      ) : null}
      {step.state === 'approved' ? (
        <Button className="self-start" data-testid="orchestrate-send" aria-disabled={busy} onClick={busy ? undefined : () => onSend(step.stepId)}>
          Send
        </Button>
      ) : null}
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
