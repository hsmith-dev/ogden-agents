import { MANAGER_LIMITS, ORCHESTRATION_NO_MANAGER_MESSAGE, type OrchestrationRunView, type OrchestrationStepView } from '@ogden-agents/shared';
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
const ORCHESTRATE_INTRO = 'A manager turns your goal into steps. You see every instruction and approve it before an agent gets it.';

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
  paused: 'Paused',
  stopped: 'Stopped',
  finished: 'Finished',
  failed: 'The run failed',
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
  /** A stop request is in flight. */
  stopping: boolean;
}

/** The actions the plan review gives each step. */
interface StepActions {
  busy: boolean;
  onApprove: (stepId: string) => void;
  onSend: (stepId: string) => void;
  onEdit: (stepId: string, instruction: string) => Promise<boolean>;
  onSkip: (stepId: string) => void;
  onMove: (stepId: string, by: -1 | 1) => void;
}

export function OrchestrateView({ wsId, managerReady, managerMessage, run, busy, error, onStart, onApprove, onSend, onEdit, onSkip, onReorder, onStop, stopping }: OrchestrateViewProps) {
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
        {busy && (run === undefined || run.run.state === 'planning') ? <Thinking /> : null}
        {error === undefined ? null : (
          <Notice variant="blocked" role="alert" data-testid="orchestrate-error">
            {error}
          </Notice>
        )}
      </PageSection>
      {run === undefined ? null : <RunSection wsId={wsId} view={run} where={managerReady ? managerMessage : undefined} busy={busy} stopping={stopping} onApprove={onApprove} onSend={onSend} onEdit={onEdit} onSkip={onSkip} onReorder={onReorder} onStop={onStop} />}
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
}

function RunSection({ wsId, view, where, busy, stopping, onApprove, onSend, onEdit, onSkip, onReorder, onStop }: RunSectionProps) {
  const { run, steps } = view;
  const live = isLive(run.state);
  const stateOf = new Map(steps.map((step) => [step.stepId, step.state]));
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
      {where === undefined ? null : (
        <Text variant="caption" data-testid="orchestrate-run-where">
          {where}
        </Text>
      )}
      {run.state === 'planning' ? <Thinking /> : null}
      {run.state === 'stopped' ? (
        <Text variant="caption" data-testid="orchestrate-stopped-note">
          You stopped this run. Nothing more will be approved or sent. A worker that was in the middle of a turn was asked to stop; its chat is still there.
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
            live={live}
            stopped={run.state === 'stopped'}
            actions={{ busy, onApprove, onSend, onEdit, onSkip, onMove: move }}
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
  actions: StepActions;
}

function StepRow({ wsId, step, stateOf, first, last, live, stopped, actions }: StepRowProps) {
  const { busy, onApprove, onSend, onEdit, onSkip, onMove } = actions;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(step.instruction);
  const waitingOn = step.dependsOn.filter((id) => stateOf.get(id) !== 'done');
  const skippedNeeds = waitingOn.filter((id) => stateOf.get(id) === 'skipped');
  const ready = waitingOn.length === 0;
  const changeable = live && canChange(step.state);
  const stateWords = (stopped && !(step.state === 'failed' && step.sessionState === 'error') ? STOPPED_STEP_WORDS[step.state] : undefined) ?? STEP_STATE_WORDS[step.state];
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
        <Badge variant="outline" data-testid="orchestrate-step-worker">
          {step.workerLabel}
        </Badge>
        <Badge data-testid="orchestrate-step-state">{stateWords}</Badge>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Text variant="caption" data-testid="orchestrate-step-target">
          Goes to {chatWords(step)}
        </Text>
        <Text variant="caption" data-testid="orchestrate-step-mode">
          Mode: Ask
        </Text>
        <Text variant="caption" data-testid="orchestrate-step-needs">
          {step.dependsOn.length === 0 ? 'Needs nothing first' : `Needs ${step.dependsOn.join(', ')} first`}
        </Text>
      </div>
      {editing && changeable ? (
        <div className="flex flex-col gap-2" data-testid="orchestrate-edit-form">
          <Textarea
            aria-label={`Instruction for step ${step.stepId}`}
            data-testid="orchestrate-edit-text"
            value={text}
            maxLength={MANAGER_LIMITS.maxInstructionChars}
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
          {step.instruction}
        </Text>
      )}
      {step.state === 'proposed' && !ready && live ? (
        <Text variant="caption" data-testid="orchestrate-step-waits">
          {skippedNeeds.length === 0
            ? `Waits for ${waitingOn.join(', ')} to finish.`
            : `Waits for ${waitingOn.join(', ')}. ${skippedNeeds.join(', ')} ${skippedNeeds.length === 1 ? 'was' : 'were'} skipped, so this step will not go ahead. Skip it too if you do not want it.`}
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {live && step.state === 'proposed' && ready ? (
          <Button size="sm" data-testid="orchestrate-approve" aria-disabled={busy} onClick={busy ? undefined : () => onApprove(step.stepId)}>
            Approve and send
          </Button>
        ) : null}
        {live && step.state === 'approved' ? (
          <Button size="sm" data-testid="orchestrate-send" aria-disabled={busy} onClick={busy ? undefined : () => onSend(step.stepId)}>
            Send
          </Button>
        ) : null}
        {changeable && !editing ? (
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
