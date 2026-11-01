import { CHAT_LOCATION_DESCRIPTIONS, CHAT_LOCATION_FIXED_TEXT, CHAT_LOCATION_LABELS, CHAT_LOCATIONS, type ChatLocation } from '@ogden-agents/shared';
import { ArrowsLeftRight, CaretDown, FolderSimple, GitBranch, Robot } from '@phosphor-icons/react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { cn } from '@/ui/utils';
import { CONTINUE_WITH_ANOTHER_AGENT } from './session-menu';

/**
 * The composer's setup row (epic 27, 27.1; CAP-35; DESIGN.md Composer,
 * `setup-chip`): Agent, Model, Mode and Location chips under the prompt box,
 * in the new-chat draft and in every chat. Each chip is a small menu with
 * the current value checked; a choice that can't be taken is disabled with
 * its one-sentence reason. This file has the Location chip and a started
 * chat's Agent chip; the Model and Mode chips are their pickers'.
 */

/** A setup chip (`--setup-chip-height`), ghost, caption words in the muted foreground, its value truncating before the row wraps. */
export const SETUP_CHIP_CLASS = 'h-(--setup-chip-height) min-w-0 shrink gap-1 px-2 text-caption text-muted-foreground hover:text-foreground';

const LOCATION_GLYPHS = { this_folder: FolderSimple, worktree: GitBranch } as const;

export interface LocationChipProps {
  /** Where the chat works (the draft's choice, or the started chat's place). */
  value: ChatLocation;
  /** The draft's choice; absent for a started chat, whose place is fixed. */
  onChange?: ((location: ChatLocation) => void) | undefined;
  /** Why Worktree can't be chosen now (a remote machine is picked, until 27.5). */
  worktreeReason?: string | undefined;
}

/**
 * The Location chip (27.1): This folder (the default) or Worktree. In the
 * draft it picks where the new chat works; in a started chat it shows the
 * place and the other item is disabled with why (moving a chat is 27.4).
 */
export function LocationChip({ value, onChange, worktreeReason }: LocationChipProps) {
  const started = onChange === undefined;
  const Glyph = LOCATION_GLYPHS[value];
  const reasonFor = (each: ChatLocation): string | undefined => {
    if (each === value) return undefined;
    if (started) return CHAT_LOCATION_FIXED_TEXT;
    return each === 'worktree' ? worktreeReason : undefined;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={SETUP_CHIP_CLASS} data-testid="location-chip" data-location={value} aria-label={`Location: ${CHAT_LOCATION_LABELS[value]}`}>
          <Glyph aria-hidden />
          <span className="truncate">{CHAT_LOCATION_LABELS[value]}</span>
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="location-menu">
        <DropdownMenuLabel>{started ? 'Where this chat works' : 'Where the new chat works'}</DropdownMenuLabel>
        {CHAT_LOCATIONS.map((each) => {
          const reason = reasonFor(each);
          return (
            <DropdownMenuChoiceItem
              key={each}
              data-testid={`location-${each}`}
              checked={each === value}
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
                if (each !== value) onChange?.(each);
              }}
            />
          );
        })}
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
