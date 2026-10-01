import type { SessionDriver } from '@ogden-agents/shared';
import { ChatCircle, TerminalWindow } from '@phosphor-icons/react';
import { useId } from 'react';
import { AGENT_NAME } from '@/chat/chat-api';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';

/** Why the Terminal segment is disabled while the session is not idle (E3-R5; EXPERIENCE.md). */
export const NOT_IDLE_REASON = `${AGENT_NAME} is busy. Switch when it is idle.`;

/** What the header says between the switch request and `session.driver_changed`. */
export const SWITCHING_WORDS = 'Switching...';

/** The shortcut as this computer writes it: `⌘.` on Apple devices, `Ctrl+.` elsewhere. */
export const driverShortcutLabel = (platform: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string =>
  /Mac|iPhone|iPad/.test(platform) ? '⌘.' : 'Ctrl+.';

/** The shortcut for assistive technology (`aria-keyshortcuts`): both spellings work everywhere. */
const ARIA_SHORTCUTS = 'Meta+. Control+.';

export interface DriverToggleProps {
  /** Who drives the chat now (from `session.driver_changed`, never from the request). */
  driver: SessionDriver;
  /** The driver a switch was asked for, until `session.driver_changed` arrives. */
  switching: SessionDriver | undefined;
  /** Why the Terminal segment can't be used now (not idle, or `terminal.reason` verbatim); `undefined` when it can. */
  terminalBlockedReason: string | undefined;
  onSwitch(next: SessionDriver): void;
  className?: string;
}

/**
 * "Chat | Terminal" in the session header (DESIGN.md Driver toggle; story
 * 3.6), shown only in Developer mode. The Terminal segment carries the
 * terminal glyph; when it can't be used it is `aria-disabled` (still
 * focusable, so its tooltip opens on hover or focus) and the reason is both
 * the tooltip and its description. Choosing a segment only asks: the toggle
 * shows "Switching..." and the view flips when `session.driver_changed`
 * arrives. The tooltip carries the `⌘.` / `Ctrl+.` hint.
 */
export function DriverToggle({ driver, switching, terminalBlockedReason, onSwitch, className }: DriverToggleProps) {
  const reasonId = useId();
  const shortcut = driverShortcutLabel();
  const terminalBlocked = driver === 'ui' && terminalBlockedReason !== undefined;
  const busy = switching !== undefined;
  const choose = (value: string) => {
    if (busy || (value !== 'ui' && value !== 'terminal') || value === driver) return;
    if (value === 'terminal' && terminalBlocked) return;
    onSwitch(value);
  };
  return (
    <div className={cn('flex items-center gap-2', className)} data-testid="driver-toggle" data-driver={driver}>
      {busy ? (
        <Text as="span" variant="caption" role="status" data-testid="driver-switching">
          {SWITCHING_WORDS}
        </Text>
      ) : null}
      <ToggleGroup type="single" aria-label="Who drives this chat" value={driver} onValueChange={choose} aria-busy={busy}>
        <ToggleGroupItem
          value="ui"
          aria-keyshortcuts={driver === 'terminal' ? ARIA_SHORTCUTS : undefined}
          aria-disabled={busy || undefined}
          data-testid="switch-to-chat"
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <ChatCircle aria-hidden />
          Chat
        </ToggleGroupItem>
        <Tooltip>
          {/* A wrapper is the trigger, so the tooltip's `data-state` never replaces the segment's own (on/off). */}
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ToggleGroupItem
                value="terminal"
                aria-keyshortcuts={driver === 'ui' && !terminalBlocked ? ARIA_SHORTCUTS : undefined}
                aria-disabled={busy || terminalBlocked || undefined}
                aria-describedby={terminalBlocked ? reasonId : undefined}
                data-testid="switch-to-terminal"
                data-blocked={terminalBlocked || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                <TerminalWindow aria-hidden />
                Terminal
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent data-testid="driver-tooltip">
            {terminalBlocked ? (
              terminalBlockedReason
            ) : (
              <span className="inline-flex items-center gap-2">
                {driver === 'ui' ? `Open this chat in ${AGENT_NAME}'s own terminal` : 'Back to the chat'}
                <kbd className="rounded-sm border border-border bg-muted px-1 text-mono-compact text-muted-foreground">{shortcut}</kbd>
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      </ToggleGroup>
      {terminalBlocked ? (
        <span id={reasonId} className="sr-only">
          {terminalBlockedReason}
        </span>
      ) : null}
    </div>
  );
}
