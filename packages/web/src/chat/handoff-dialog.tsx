import { DEFAULT_HANDOFF_MESSAGE, PERMISSION_MODE_LABELS, type ChatAgent } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/ui/dialog';
import { Label } from '@/ui/label';
import { Notice } from '@/ui/notice';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { fetchHandoffPreview, handOff } from './handoff-api';
import { agentAvailability } from './use-chat-agents';

/** A framed multi-line field for the brief and the message (the composer's own Textarea has no frame). */
const FIELD = 'w-full rounded-md border border-input bg-background p-2 text-body text-foreground focus-visible:outline-2 focus-visible:outline-ring';

export interface HandoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  sesId: string;
  /** The chat's agent now, which is not offered. */
  currentAgentId: string | undefined;
  currentAgentName: string;
  agents: readonly ChatAgent[];
  /** The chat continued: the dialog has closed. */
  onHandedOff?: () => void;
}

/**
 * Continue with another agent (handoff, user decision 2026-10-04): the user
 * picks the agent, sees which provider receives the chat's conversation and
 * the brief Ogden built from it (editable, with its limit), and the first
 * message; nothing is sent until they confirm. The divider and the reply
 * arrive through the event log.
 */
export function HandoffDialog({ open, onOpenChange, wsId, sesId, currentAgentId, currentAgentName, agents, onHandedOff }: HandoffDialogProps) {
  const ids = useId();
  const others = agents.filter((agent) => agent.agentId !== currentAgentId);
  const firstReady = others.find((agent) => agentAvailability(agent).available)?.agentId;
  const [agentId, setAgentId] = useState<string | undefined>(firstReady);
  const [brief, setBrief] = useState('');
  const [message, setMessage] = useState(DEFAULT_HANDOFF_MESSAGE);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  /** Counts openings: each one reads a fresh preview, never an earlier one or its edits. */
  const [opening, setOpening] = useState(0);

  // Each opening starts afresh: the first ready agent, the default message, no error.
  useEffect(() => {
    if (!open) return;
    setAgentId(firstReady);
    setBrief('');
    setOpening((count) => count + 1);
    setMessage(DEFAULT_HANDOFF_MESSAGE);
    setFailure(undefined);
    // Only on opening (`firstReady` left out on purpose): a list refreshed meanwhile keeps the user's choice.
  }, [open]);

  const preview = useQuery({
    queryKey: ['handoff-preview', wsId, sesId, agentId, opening],
    queryFn: () => fetchHandoffPreview(wsId, sesId, agentId!),
    enabled: open && agentId !== undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    // Never replaced under the user's edits while the dialog is open.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // A new preview replaces what was in the field.
  useEffect(() => {
    if (preview.data !== undefined) setBrief(preview.data.brief);
  }, [preview.data]);

  const target = preview.data?.agent;
  const maxChars = preview.data?.maxChars ?? 0;
  const tooLong = brief.length > maxChars;
  const canSend = preview.data !== undefined && !preview.isFetching && !tooLong && message.trim() !== '' && !sending;
  /** Why Continue does nothing now, read with the button. */
  const waitReason =
    agentId === undefined
      ? 'Pick an agent that is ready to continue this chat.'
      : tooLong
        ? 'Shorten the summary to send it.'
        : message.trim() === '' && preview.data !== undefined
          ? 'Write a message for the agent first.'
          : undefined;

  const confirm = () => {
    if (!canSend || agentId === undefined) return;
    setSending(true);
    setFailure(undefined);
    handOff(wsId, sesId, { agentId, brief, message }).then(
      () => {
        setSending(false);
        onOpenChange(false);
        onHandedOff?.();
      },
      (error: unknown) => {
        setSending(false);
        setFailure(error instanceof Error ? error.message : "Ogden Agents couldn't continue this chat with that agent. Try again.");
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (sending ? undefined : onOpenChange(next))}>
      <DialogContent
        data-testid="handoff-dialog"
        title="Continue with another agent"
        description={`The chat stays as it is. ${currentAgentName} stops, and the agent you pick continues from a summary Ogden Agents builds from this chat.`}
        className="overflow-y-auto"
      >
        {others.length === 0 ? (
          <Text variant="caption">There is no other agent on this computer.</Text>
        ) : (
          <RadioGroup aria-label="Agent to continue with" value={agentId ?? ''} onValueChange={setAgentId} data-testid="handoff-agents">
            {others.map((agent) => {
              const availability = agentAvailability(agent);
              return (
                <RadioGroupOption
                  key={agent.agentId}
                  id={`${ids}-agent-${agent.agentId}`}
                  value={agent.agentId}
                  label={agent.displayName}
                  description={availability.available ? agent.provider : availability.description}
                  disabled={!availability.available}
                  data-testid="handoff-agent"
                  data-agent={agent.agentId}
                />
              );
            })}
          </RadioGroup>
        )}
        {agentId === undefined ? null : preview.isPending ? (
          <>
            <Skeleton />
            <span role="status" className="sr-only">
              Preparing the summary
            </span>
          </>
        ) : preview.error !== null ? (
          <Notice variant="blocked" role="alert" data-testid="handoff-preview-error">
            {preview.error instanceof Error ? preview.error.message : "Ogden Agents couldn't prepare the handoff."}
          </Notice>
        ) : target === undefined ? null : (
          <>
            {/* Who receives the conversation, in words, before anything is sent (privacy). */}
            <Notice infoGlyph data-testid="handoff-disclosure">
              This sends this chat's conversation to {target.provider} ({target.displayName}).
              {preview.data?.resumes ? ` ${target.displayName} picks up its own earlier session here and gets what happened since.` : ''}
              {preview.data?.modeNote === undefined
                ? ` This chat stays in ${PERMISSION_MODE_LABELS[preview.data?.permissionMode ?? 'ask']}${preview.data?.permissionMode === 'skip_all' ? `: ${target.displayName} will run without asking permission` : ''}.`
                : ` ${preview.data.modeNote}`}
            </Notice>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-brief`}>Summary for {target.displayName}</Label>
              <textarea
                id={`${ids}-brief`}
                data-testid="handoff-brief"
                className={`${FIELD} min-h-[12lh] font-mono text-caption`}
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                aria-describedby={`${ids}-brief-count`}
                aria-invalid={tooLong || undefined}
              />
              <Text as="span" variant="caption" id={`${ids}-brief-count`} data-testid="handoff-brief-count">
                {tooLong
                  ? `${brief.length.toLocaleString()} of ${maxChars.toLocaleString()} characters: shorten it to send.`
                  : `${brief.length.toLocaleString()} of ${maxChars.toLocaleString()} characters. Edit or trim it freely; secrets are masked again before it's sent.`}
              </Text>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-message`}>Message to {target.displayName}</Label>
              <textarea id={`${ids}-message`} data-testid="handoff-message" className={`${FIELD} min-h-[3lh]`} value={message} onChange={(event) => setMessage(event.target.value)} />
            </div>
          </>
        )}
        {failure === undefined ? null : (
          <Text variant="caption" role="alert" data-testid="handoff-error">
            {failure}
          </Text>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline" aria-disabled={sending || undefined}>
              Cancel
            </Button>
          </DialogClose>
          {/* Announced once when it changes, not on each keystroke. */}
          <Text as="span" variant="caption" id={`${ids}-why`} aria-live="polite" data-testid="handoff-why" className={waitReason === undefined ? 'sr-only' : 'self-center'}>
            {waitReason}
          </Text>
          <Button onClick={confirm} aria-disabled={!canSend || undefined} aria-busy={sending || undefined} aria-describedby={waitReason === undefined ? undefined : `${ids}-why`} data-testid="handoff-confirm">
            {target === undefined ? 'Continue' : `Continue with ${target.displayName}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
