import {
  TRIAL_AGENTS_LABEL,
  TRIAL_AGENTS_MAX,
  TRIAL_AGENTS_MIN,
  TRIAL_DIALOG_TITLE,
  TRIAL_LINE_TEXT,
  TRIAL_PICK_TEXT,
  TRIAL_START_LABEL,
  TRIAL_TASK_EMPTY_TEXT,
  TRIAL_TASK_LABEL,
  TRIAL_TEXT_MAX,
  trialRetentionText,
  WORKTREE_RETENTION_DEFAULT,
  type ChatAgent,
  type Trial,
} from '@ogden-agents/shared';
import { useId, useState } from 'react';
import { agentAvailability } from '@/chat/use-chat-agents';
import { Button } from '@/ui/button';
import { CheckboxOption } from '@/ui/checkbox';
import { Dialog, DialogContent } from '@/ui/dialog';
import { GroupLabel, Label } from '@/ui/label';
import { Text } from '@/ui/typography';
import { useWorktreeRetention } from '@/worktrees/worktree-retention';
import { startTrial } from './trials-api';

/** A framed multi-line field (the composer's own Textarea has no frame). */
const FIELD = 'w-full rounded-md border border-input bg-background p-2 text-body text-foreground focus-visible:outline-2 focus-visible:outline-ring';

export interface TryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  agents: readonly ChatAgent[];
  /** The draft's text when it opened: the task. */
  initialText: string;
  /** The agent the draft has picked: checked to start with when it can start a chat. */
  initialAgentId: string | undefined;
  /** Called with the trial once its chats were made and sent the task. */
  onStarted: (trial: Trial) => void;
}

/**
 * Try with several agents (epic 27, 27.8; EXPERIENCE.md): the task (the
 * new-chat draft's text), the agents as checkboxes with their readiness (2
 * to 4; one that can't start a chat now is disabled with its reason), the
 * line that each works in its own copy, and the retention line. Start
 * makes one worktree chat per agent and opens the Try page; a refusal (an
 * agent that can't start after all) stays in the dialog, nothing made.
 */
export function TryDialog(props: TryDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted only while open: each opening starts from the draft's text again. */}
      {props.open ? <TryDialogBody {...props} /> : null}
    </Dialog>
  );
}

function TryDialogBody({ wsId, agents, initialText, initialAgentId, onStarted }: TryDialogProps) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const ready = (agent: ChatAgent) => agentAvailability(agent).available;
  const [picked, setPicked] = useState<readonly string[]>(() => (agents.some((agent) => agent.agentId === initialAgentId && ready(agent)) ? [initialAgentId!] : []));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const retention = useWorktreeRetention();
  const keep = retention.data?.keep ?? WORKTREE_RETENTION_DEFAULT;
  const count = Math.max(picked.length, TRIAL_AGENTS_MIN);
  const task = text.trim();
  const canStart = !pending && task !== '' && text.length <= TRIAL_TEXT_MAX && picked.length >= TRIAL_AGENTS_MIN && picked.length <= TRIAL_AGENTS_MAX;

  const toggle = (agentId: string, on: boolean) => setPicked((current) => (on ? (current.includes(agentId) ? current : [...current, agentId]) : current.filter((each) => each !== agentId)));

  const onStart = () => {
    if (!canStart) return;
    setPending(true);
    setError(undefined);
    // In the order shown, so the Try page's columns follow the list.
    const agentIds = agents.map((agent) => agent.agentId).filter((agentId) => picked.includes(agentId));
    startTrial(wsId, task, agentIds).then(
      (trial) => {
        setPending(false);
        onStarted(trial);
      },
      (failure: unknown) => {
        setPending(false);
        setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't start the try. Try again.");
      },
    );
  };

  return (
    <DialogContent data-testid="try-dialog" title={TRIAL_DIALOG_TITLE} description={TRIAL_LINE_TEXT}>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-task`}>{TRIAL_TASK_LABEL}</Label>
          <textarea
            id={`${id}-task`}
            data-testid="try-task"
            className={FIELD}
            maxLength={TRIAL_TEXT_MAX}
            value={text}
            placeholder={TRIAL_TASK_EMPTY_TEXT}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div role="group" aria-labelledby={`${id}-agents`} aria-describedby={`${id}-pick`} className="flex flex-col gap-1">
          <GroupLabel id={`${id}-agents`}>{TRIAL_AGENTS_LABEL}</GroupLabel>
          <Text variant="caption" id={`${id}-pick`}>
            {TRIAL_PICK_TEXT}
          </Text>
          {agents.map((agent) => {
            const availability = agentAvailability(agent);
            const checked = picked.includes(agent.agentId);
            // Unready: disabled with its one-sentence reason; past four, the rest wait until one is unchecked.
            const disabled = !availability.available || (!checked && picked.length >= TRIAL_AGENTS_MAX);
            return (
              <CheckboxOption
                key={agent.agentId}
                id={`${id}-agent-${agent.agentId}`}
                data-testid="try-agent"
                data-agent={agent.agentId}
                label={agent.displayName}
                description={availability.description}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) => toggle(agent.agentId, next === true)}
              />
            );
          })}
        </div>
        <Text variant="caption" data-testid="try-retention">
          {trialRetentionText(keep, count)}
        </Text>
        {error === undefined ? null : (
          <p role="alert" className="m-0 text-label text-destructive" data-testid="try-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-testid="try-start" aria-disabled={!canStart || undefined} onClick={onStart}>
          {pending ? 'Starting...' : TRIAL_START_LABEL}
        </Button>
      </div>
    </DialogContent>
  );
}
