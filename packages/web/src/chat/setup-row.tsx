import {
  CHAT_ADD_REMOTE_MACHINE_TEXT,
  CHAT_LOCATION_DESCRIPTIONS,
  CHAT_LOCATION_FIXED_TEXT,
  CHAT_LOCATION_LABELS,
  CHAT_LOCATIONS,
  CHAT_MACHINE_STATE_WORDS,
  CHAT_MACHINE_UNREACHABLE_TEXT,
  CHAT_REMOTE_FIXED_TEXT,
  CHAT_REMOTE_MACHINE_WORDS,
  HANDOFF_TO_THIS_FOLDER_DESCRIPTION,
  HANDOFF_TO_THIS_FOLDER_LABEL,
  HANDOFF_TO_WORKTREE_DESCRIPTION,
  HANDOFF_TO_WORKTREE_LABEL,
  type ChatLocation,
  type RemoteMachine,
  type RemoteMachineId,
} from '@ogden-agents/shared';
import { ArrowsLeftRight, CaretDown, Desktop, FolderSimple, GitBranch, Plus, Robot } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { MACHINE_HOST_KEY_CHANGED_REASON, useMachineChecks, type MachineState } from '@/remote-machines/machine-checks';
import { useRemoteMachines } from '@/remote-machines/remote-machines-api';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { cn } from '@/ui/utils';
import { CONTINUE_WITH_ANOTHER_AGENT } from './session-menu';

/**
 * The composer's setup row (epic 27, 27.1; CAP-35; DESIGN.md Composer,
 * `setup-chip`): Agent, Model, Mode and Location chips under the prompt box,
 * in the new-chat draft and in every chat. Each chip is a small menu with
 * the current value checked; a choice that can't be taken is disabled with
 * its one-sentence reason (27.5 adds the remote machines to Location). This file has the Location chip and a started
 * chat's Agent chip; the Model and Mode chips are their pickers'.
 */

/** A setup chip (`--setup-chip-height`), ghost, caption words in the muted foreground, its value truncating before the row wraps. */
export const SETUP_CHIP_CLASS = 'h-(--setup-chip-height) min-w-0 shrink gap-1 px-2 text-caption text-muted-foreground hover:text-foreground';

const LOCATION_GLYPHS = { this_folder: FolderSimple, worktree: GitBranch } as const;

/** Where a chat works (27.5): This folder, Worktree, or a remote machine (then always `this_folder`, its home folder there). */
export interface ChatPlace {
  location: ChatLocation;
  machineId: RemoteMachineId | null;
}

export interface LocationChipProps {
  /** Where the chat works (the draft's choice, or the started chat's place). */
  value: ChatLocation;
  /** The remote machine it runs on (27.5): the draft's pick, or the started chat's; `null`/absent: this computer. */
  machineId?: RemoteMachineId | null | undefined;
  /** The draft's choice; absent for a started chat, whose place is fixed. */
  onChange?: ((place: ChatPlace) => void) | undefined;
  /** The chosen agent's reason it runs only on this computer (`ChatAgent.localOnly`): every machine is disabled with it. */
  localOnlyReason?: string | undefined;
  /** A started worktree chat's branch (27.3), shown beside the word. */
  branch?: string | null | undefined;
  /** A started chat's hand-off to the other place (27.4); absent: the place is fixed (a planning chat). */
  onHandOff?: (() => void) | undefined;
  /** Why the hand-off can't be taken now (the agent works or waits, the terminal drives). */
  handOffReason?: string | undefined;
}

/** A machine's words in the Location menu (27.5): its name with its live state, and the sentence under it. */
function machineWords(machine: RemoteMachine, state: MachineState | undefined, localOnlyReason: string | undefined): { label: string; reason: string | undefined; description: string } {
  const label = state === undefined ? machine.label : `${machine.label}, ${CHAT_MACHINE_STATE_WORDS[state]}`;
  const address = `${machine.username}@${machine.host}`;
  // The agent's refusal comes first: it holds whatever the machine's state.
  if (localOnlyReason !== undefined) return { label, reason: localOnlyReason, description: localOnlyReason };
  if (state === 'unreachable') return { label, reason: CHAT_MACHINE_UNREACHABLE_TEXT, description: CHAT_MACHINE_UNREACHABLE_TEXT };
  if (state === 'host_key_changed') return { label, reason: MACHINE_HOST_KEY_CHANGED_REASON, description: MACHINE_HOST_KEY_CHANGED_REASON };
  return { label, reason: undefined, description: address };
}

/**
 * The Location chip (27.1, 27.5). In the draft it picks where the new chat
 * works: This folder (the default), Worktree, or one of the confirmed remote
 * machines (Settings, Remote machines), each with its live state, probed by
 * the server when the menu opens; then Add a remote machine. A machine the
 * chosen agent can't take, can't be reached, or whose host key changed is
 * disabled but focusable with why. In a started chat it shows the place
 * (a remote chat its machine) and the others are disabled with why; a
 * started local chat that can move (`onHandOff`) lists its own place and
 * one hand-off item instead (27.4: Move to its own worktree, Move to this
 * folder) with its line, or disabled with why. A remote chat never moves.
 */
export function LocationChip({ value, machineId = null, onChange, localOnlyReason, branch, onHandOff, handOffReason }: LocationChipProps) {
  const started = onChange === undefined;
  const [open, setOpen] = useState(false);
  const machines = useRemoteMachines();
  // Never an unconfirmed machine: it can't run anything yet.
  const confirmed = (machines.data ?? []).filter((machine) => machine.hostKeyConfirmed);
  // Probed only for the draft's menu (a started chat's place is fixed), and not for an agent that can't take any machine.
  const checks = useMachineChecks(open, confirmed, !started && localOnlyReason === undefined);
  const remote = machineId !== null;
  const machine = remote ? (machines.data ?? []).find((each) => each.id === machineId) : undefined;
  const Glyph = remote ? Desktop : LOCATION_GLYPHS[value];
  const shownLabel = remote ? (machine?.label ?? CHAT_REMOTE_MACHINE_WORDS) : CHAT_LOCATION_LABELS[value];
  // A started local chat moves between this folder and its own worktree (27.4); a remote one stays on its machine.
  const handOff = started && !remote && onHandOff !== undefined;
  const handOffBlocked = handOffReason !== undefined;
  // A started worktree chat names its branch (27.3).
  const shownBranch = started && !remote && value === 'worktree' && branch !== undefined && branch !== null ? branch : undefined;
  const reasonFor = (each: ChatLocation): string | undefined => {
    if (!remote && each === value) return undefined;
    if (started) return remote ? CHAT_REMOTE_FIXED_TEXT : CHAT_LOCATION_FIXED_TEXT;
    return undefined;
  };
  // The draft lists every confirmed machine; a started remote chat its own (even once removed from Settings).
  const listed: Array<{ id: RemoteMachineId; machine: RemoteMachine | undefined }> = started
    ? remote
      ? [{ id: machineId, machine }]
      : []
    : confirmed.map((each) => ({ id: each.id, machine: each }));
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={SETUP_CHIP_CLASS}
          data-testid="location-chip"
          data-location={value}
          data-machine={machineId ?? undefined}
          aria-label={shownBranch === undefined ? `Location: ${shownLabel}` : `Location: ${shownLabel}, branch ${shownBranch}`}
        >
          <Glyph aria-hidden />
          <span className={shownBranch === undefined ? 'truncate' : 'shrink-0'}>{shownLabel}</span>
          {shownBranch === undefined ? null : (
            <span className="min-w-0 truncate font-mono text-mono-compact" data-testid="location-branch">
              {shownBranch}
            </span>
          )}
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="location-menu">
        <DropdownMenuLabel>{started ? 'Where this chat works' : 'Where the new chat works'}</DropdownMenuLabel>
        {CHAT_LOCATIONS.filter((each) => !handOff || each === value).map((each) => {
          const reason = reasonFor(each);
          return (
            <DropdownMenuChoiceItem
              key={each}
              data-testid={`location-${each}`}
              checked={!remote && each === value}
              // Unavailable but focusable: the keyboard and a screen reader still reach its reason.
              aria-disabled={reason !== undefined || undefined}
              data-disabled={reason !== undefined ? '' : undefined}
              label={CHAT_LOCATION_LABELS[each]}
              description={reason ?? CHAT_LOCATION_DESCRIPTIONS[each]}
              onSelect={(event) => {
                if (reason !== undefined) {
                  event.preventDefault();
                  return;
                }
                if (remote || each !== value) onChange?.({ location: each, machineId: null });
              }}
            />
          );
        })}
        {listed.map(({ id, machine: each }) => {
          const own = id === machineId;
          const words =
            each === undefined
              ? { label: CHAT_REMOTE_MACHINE_WORDS, reason: undefined, description: CHAT_REMOTE_FIXED_TEXT }
              : started
                ? { label: each.label, reason: undefined, description: CHAT_REMOTE_FIXED_TEXT }
                : machineWords(each, checks[id]?.state, localOnlyReason);
          const reason = started ? undefined : words.reason;
          return (
            <DropdownMenuChoiceItem
              key={id}
              data-testid="location-machine"
              data-machine={id}
              checked={own}
              aria-disabled={reason !== undefined || undefined}
              data-disabled={reason !== undefined ? '' : undefined}
              label={words.label}
              description={words.description}
              onSelect={(event) => {
                if (started || reason !== undefined) {
                  event.preventDefault();
                  return;
                }
                if (!own) onChange?.({ location: 'this_folder', machineId: id });
              }}
            />
          );
        })}
        {started ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/remote-machines" data-testid="location-add-machine">
                <Plus aria-hidden />
                {CHAT_ADD_REMOTE_MACHINE_TEXT}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {handOff ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="location-hand-off"
              data-to={value === 'worktree' ? 'this_folder' : 'worktree'}
              // Unavailable but focusable: the keyboard and a screen reader still reach its reason.
              aria-disabled={handOffBlocked || undefined}
              aria-describedby="location-hand-off-line"
              className={cn('flex-col items-start gap-0.5', handOffBlocked && 'opacity-50')}
              onSelect={(event) => {
                if (handOffBlocked) {
                  event.preventDefault();
                  return;
                }
                onHandOff?.();
              }}
            >
              <span className="flex items-center gap-2">
                <ArrowsLeftRight aria-hidden />
                {value === 'worktree' ? HANDOFF_TO_THIS_FOLDER_LABEL : HANDOFF_TO_WORKTREE_LABEL}
              </span>
              <span id="location-hand-off-line" className="max-w-72 text-caption text-muted-foreground" data-testid="location-hand-off-line">
                {handOffReason ?? (value === 'worktree' ? HANDOFF_TO_THIS_FOLDER_DESCRIPTION : HANDOFF_TO_WORKTREE_DESCRIPTION)}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface SessionAgentChipProps {
  agentId: string | undefined;
  agentName: string;
  /** Opens Continue with another agent (the install has several agents); absent: the chip only shows the agent. */
  onContinue?: (() => void) | undefined;
  /** Why the chat can't be handed over now (the agent works or waits, the terminal drives). */
  blockedReason?: string | undefined;
}

/**
 * A started chat's Agent chip (27.1): its agent, checked, fixed for the
 * chat's life (E6-R1), and Continue with another agent... (the handoff).
 */
export function SessionAgentChip({ agentId, agentName, onContinue, blockedReason }: SessionAgentChipProps) {
  const blocked = blockedReason !== undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={SETUP_CHIP_CLASS} data-testid="session-agent-chip" data-agent={agentId ?? ''} aria-label={`Agent: ${agentName}`}>
          <Robot aria-hidden />
          <span className="truncate">{agentName}</span>
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="session-agent-menu">
        <DropdownMenuLabel>Agent for this chat</DropdownMenuLabel>
        <DropdownMenuChoiceItem
          data-testid="session-agent-option"
          checked
          label={agentName}
          description="A chat keeps its agent. Continue with another agent to hand it over."
          onSelect={(event) => event.preventDefault()}
        />
        {onContinue === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="session-agent-continue"
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? 'session-agent-continue-reason' : undefined}
              className={cn(blocked && 'opacity-50')}
              onSelect={(event) => {
                if (blocked) {
                  event.preventDefault();
                  return;
                }
                onContinue();
              }}
            >
              <ArrowsLeftRight aria-hidden />
              {CONTINUE_WITH_ANOTHER_AGENT}…
            </DropdownMenuItem>
            {blocked ? (
              <DropdownMenuLabel id="session-agent-continue-reason" className="max-w-72 text-caption font-normal text-muted-foreground" data-testid="session-agent-continue-reason">
                {blockedReason}
              </DropdownMenuLabel>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
