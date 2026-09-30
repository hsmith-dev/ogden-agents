import { Check, ClockCounterClockwise, Prohibit, ShieldCheck } from '@phosphor-icons/react';
import type { CautionLevel, PermissionDecision, ToolKind } from '@ogden-agents/shared';
import { alwaysAllowRefusal, MAX_DENY_REASON_LENGTH } from '@ogden-agents/shared';
import { useId, useState, type KeyboardEvent } from 'react';
import { AGENT_NAME, decidePermission, removePermissionRule } from '@/chat/chat-api';
import type { TranscriptPermission } from '@/chat/transcript';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Text } from '@/ui/typography';

/** What the agent wants to do, by tool kind, for the card's headline. */
const WANTS: Record<ToolKind, string> = {
  execute: 'wants to run a command',
  edit: 'wants to edit a file',
  delete: 'wants to delete a file',
  move: 'wants to move a file',
  read: 'wants to read a file',
  search: 'wants to search files',
  fetch: 'wants to fetch from the web',
  think: 'wants to think it through',
  switch_mode: 'wants to switch modes',
  other: 'wants to use a tool',
};

const CAUTION_WORDS: Record<CautionLevel, string> = {
  ask_every_time: 'Ask every time',
  ask_for_commands: 'Ask for commands',
  ask_risky_only: 'Ask only for risky actions',
};

/** The command it would run, or else the tool call's own title. */
export const permissionTarget = (permission: TranscriptPermission): string => permission.toolCall.command ?? permission.toolCall.title;

/** What the agent is waiting for, in words for a screen reader ("run npm install stripe"). */
export const permissionAnnouncement = (permission: TranscriptPermission): string =>
  permission.toolCall.command === undefined ? `${WANTS[permission.toolCall.kind].replace(/^wants to /, '')}: ${permission.toolCall.title}` : `run ${permission.toolCall.command}`;

export interface PermissionCardProps {
  permission: TranscriptPermission;
  wsId: string;
  sesId: string;
  /** The project's name, for the caption and the Always allow scope. */
  projectName: string;
  /** Called once a decision was accepted, so focus can return to the composer. */
  onDecided?: () => void;
}

/**
 * A permission request in the transcript (DESIGN.md Permission card;
 * EXPERIENCE.md Permission card). While pending: the headline, the exact
 * command in mono, the project and caution level, then Allow once, Always
 * allow (its scope written under it, or why it is not offered) and Deny with
 * an optional reason. No button is focused by default, and `1`, `2`, `3`
 * answer only while focus is inside the card. Once answered (or no longer
 * waited for) it is its one-line record, which opens a popover to undo an
 * Always allow.
 */
export function PermissionCard({ permission, wsId, sesId, projectName, onDecided }: PermissionCardProps) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (permission.status !== 'pending') return <PermissionRecordLine permission={permission} wsId={wsId} projectName={projectName} />;

  const { scope } = permission;
  const target = permissionTarget(permission);
  // An interpreter, a wrapper or a variable assignment: only Allow once and Deny, with the reason.
  const refusal = scope === null && permission.toolCall.command !== undefined ? alwaysAllowRefusal(permission.toolCall.command) : undefined;
  const decide = (decision: PermissionDecision) => {
    if (sending || (decision === 'allow_always' && scope === null)) return;
    setSending(true);
    setError(undefined);
    const trimmed = reason.trim();
    decidePermission(wsId, sesId, permission.requestId, decision === 'deny' && trimmed !== '' ? { decision, reason: trimmed } : { decision }).then(
      () => onDecided?.(),
      (failure: unknown) => {
        setSending(false);
        setError(failure instanceof Error ? failure.message : "Your answer couldn't be sent. Try again.");
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    // Typing a reason never answers the card.
    if (target.closest('input, textarea, [contenteditable="true"]') !== null) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const decision = ({ '1': 'allow_once', '2': 'allow_always', '3': 'deny' } as const)[event.key as '1' | '2' | '3'];
    if (decision === undefined) return;
    event.preventDefault();
    decide(decision);
  };

  return (
    <section
      id={`permission-${permission.requestId}`}
      aria-labelledby={`${id}-headline`}
      tabIndex={-1}
      data-testid="permission-card"
      data-request-id={permission.requestId}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-border border-l-(length:--rail-signal) border-l-signal bg-card p-(--panel-padding) animate-in fade-in-0 slide-in-from-bottom-1 duration-(--motion-base) ease-standard"
    >
      <h2 id={`${id}-headline`} className="m-0 text-heading text-foreground">
        {AGENT_NAME} {WANTS[permission.toolCall.kind]}
      </h2>
      {permission.toolCall.command !== undefined && permission.toolCall.title.trim() !== '' && permission.toolCall.title !== `Run ${permission.toolCall.command}` ? (
        <Text>{permission.toolCall.title}</Text>
      ) : null}
      <pre data-testid="permission-command" className="m-0 whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 font-mono text-mono text-foreground">
        {target}
      </pre>
      <Text variant="caption">
        {projectName} · {CAUTION_WORDS[permission.cautionLevel]}
      </Text>
      <div className="flex flex-wrap items-start gap-2">
        <Button aria-keyshortcuts="1" aria-disabled={sending} onClick={() => decide('allow_once')}>
          Allow once
        </Button>
        {refusal !== undefined ? null : (
          <div className="flex max-w-64 flex-col gap-1">
            <Button
              variant="outline"
              aria-keyshortcuts="2"
              aria-disabled={sending || scope === null}
              aria-describedby={`${id}-scope`}
              onClick={() => decide('allow_always')}
            >
              Always allow
            </Button>
            <Text variant="caption" id={`${id}-scope`} data-testid="permission-scope">
              {scope === null ? 'Not offered for this kind of request' : `${scope.label} in ${projectName}`}
            </Text>
          </div>
        )}
        <Button variant="destructive" aria-keyshortcuts="3" aria-disabled={sending} onClick={() => decide('deny')}>
          Deny
        </Button>
      </div>
      {refusal === undefined ? null : (
        <Text variant="caption" data-testid="permission-scope">
          {refusal}
        </Text>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-reason`}>Reason for Deny (optional)</Label>
        <Input id={`${id}-reason`} value={reason} maxLength={MAX_DENY_REASON_LENGTH} onChange={(event) => setReason(event.target.value)} />
      </div>
      {error === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="permission-error">
          {error}
        </Text>
      )}
    </section>
  );
}

/** The card after its answer: one caption line with a glyph and the time. */
function PermissionRecordLine({ permission, wsId, projectName }: { permission: TranscriptPermission; wsId: string; projectName: string }) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const target = permissionTarget(permission);
  const resolution = permission.resolution;
  const at = resolution?.at ?? permission.requestedAt;
  const ruleId = resolution?.ruleId;
  const undoable = ruleId !== undefined && resolution?.ruleRemoved === false && resolution.decision !== 'deny';

  let Icon = ClockCounterClockwise;
  let text = `Not answered: ${target}`;
  if (resolution !== undefined && resolution.by !== 'cancelled') {
    const allowed = resolution.decision !== 'deny';
    Icon = allowed ? (resolution.by === 'user' && resolution.decision === 'allow_once' ? Check : ShieldCheck) : Prohibit;
    if (resolution.by === 'rule') text = `Allowed by your Always allow rule: ${target}`;
    else if (resolution.by === 'caution') text = `${allowed ? 'Allowed' : 'Denied'} by the caution level: ${target}`;
    else if (resolution.decision === 'allow_once') text = `Allowed once: ${target}`;
    else if (resolution.decision === 'allow_always') text = `Always allowed: ${target}`;
    else text = `Denied: ${target}`;
  }
  const undone = ruleId !== undefined && resolution?.ruleRemoved === true;

  const undo = () => {
    if (ruleId === undefined) return;
    setError(undefined);
    removePermissionRule(wsId, ruleId).then(
      () => setOpen(false),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : "The rule couldn't be undone. Try again."),
    );
  };

  return (
    <div
      data-testid="permission-record"
      data-request-id={permission.requestId}
      data-status={permission.status}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground animate-in fade-in-0 duration-(--motion-base) [&_svg]:size-(--icon) [&_svg]:shrink-0"
    >
      <Icon aria-hidden />
      {undoable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" data-testid="permission-record-text" className="min-w-0 break-all rounded-sm text-left underline-offset-4 hover:underline">
              {text}
            </button>
          </PopoverTrigger>
          <PopoverContent data-testid="permission-undo">
            <Text variant="label">
              {resolution?.by === 'rule'
                ? `This ran without asking because of an Always allow rule in ${projectName}.`
                : `${AGENT_NAME} can do this in ${projectName} without asking: ${permission.scope?.label ?? target}.`}
            </Text>
            <Button variant="outline" onClick={undo}>
              Undo Always allow
            </Button>
            {error === undefined ? null : (
              <Text variant="caption" role="alert">
                {error}
              </Text>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        <span data-testid="permission-record-text" className="min-w-0 break-all">
          {text}
        </span>
      )}
      {undone ? <span data-testid="permission-rule-undone">Always allow undone</span> : null}
      {resolution?.reason === undefined ? null : <span data-testid="permission-reason">Your reason: {resolution.reason}</span>}
      <time dateTime={at}>{new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </div>
  );
}
