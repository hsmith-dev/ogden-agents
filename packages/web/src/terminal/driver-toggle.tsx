import type { SessionDriver } from '@ogden-agents/shared';
import { ChatCircle, TerminalWindow } from '@phosphor-icons/react';
import { useId, type ReactNode } from 'react';
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
  /**
   * Why the Terminal segment can't be used now (not idle, or `terminal.reason`
   * verbatim); `undefined` when it can. `null`: it can't yet, and there is
   * nothing to say (the session is still loading; 3.6 review F5).
   */
  terminalBlockedReason: string | null | undefined;
  onSwitch(next: SessionDriver): void;
  className?: string;
}

/** What a segment's tooltip and description say, if anything. */
interface SegmentHelp {
  /** The words, for the tooltip and (as text) the segment's description. */
  text: string;
  /** Show the shortcut beside the words. */
  shortcut: boolean;
}

/**
 * "Chat | Terminal" in the session header (DESIGN.md Driver toggle; story
 * 3.6), shown only in Developer mode. The segment you would switch to carries
 * the help: its tooltip (on hover or focus) and its accessible description
 * say what it does with the `⌘.` / `Ctrl+.` hint, or why it can't be used.
 * A segment that can't be used is `aria-disabled` (still focusable, so the
 * tooltip opens). Choosing a segment only asks: the toggle shows
 * "Switching..." and the view flips when `session.driver_changed` arrives.
 */
export function DriverToggle({ driver, switching, terminalBlockedReason, onSwitch, className }: DriverToggleProps) {
  const shortcut = driverShortcutLabel();
  const terminalBlocked = driver === 'ui' && terminalBlockedReason !== undefined;
  const busy = switching !== undefined;
  const choose = (value: string) => {
    if (busy || (value !== 'ui' && value !== 'terminal') || value === driver) return;
    if (value === 'terminal' && terminalBlocked) return;
    onSwitch(value);
  };
  const chatHelp: SegmentHelp | undefined = driver === 'terminal' ? { text: 'Back to the chat', shortcut: true } : undefined;
  const terminalHelp: SegmentHelp | undefined =
    driver === 'terminal'
      ? undefined
      : terminalBlocked
        ? terminalBlockedReason === null
          ? undefined
          : { text: terminalBlockedReason ?? '', shortcut: false }
        : { text: `Open this chat in ${AGENT_NAME}'s own terminal`, shortcut: true };
  return (
    <div className={cn('flex items-center gap-2', className)} data-testid="driver-toggle" data-driver={driver}>
      {busy ? (
        <Text as="span" variant="caption" role="status" data-testid="driver-switching">
          {SWITCHING_WORDS}
        </Text>
      ) : null}
      <ToggleGroup type="single" aria-label="Who drives this chat" value={driver} onValueChange={choose} aria-busy={busy}>
        <Segment value="ui" help={chatHelp} shortcut={shortcut} disabled={busy} testId="switch-to-chat">
          <ChatCircle aria-hidden />
          Chat
        </Segment>
        <Segment value="terminal" help={terminalHelp} shortcut={shortcut} disabled={busy || terminalBlocked} testId="switch-to-terminal" blocked={terminalBlocked}>
          <TerminalWindow aria-hidden />
          Terminal
        </Segment>
      </ToggleGroup>
    </div>
  );
}

/**
 * One segment, with its help as a tooltip and as its description. A wrapper
 * is the tooltip's trigger, so the tooltip's `data-state` never replaces the
 * segment's own (on/off); the tree is the same with or without help, so a
 * flip keeps focus where it is.
 */
function Segment({
  value,
  help,
  shortcut,
  disabled,
  blocked = false,
  testId,
  children,
}: {
  value: SessionDriver;
  help: SegmentHelp | undefined;
  shortcut: string;
  disabled: boolean;
  blocked?: boolean;
  testId: string;
  children: ReactNode;
}) {
  const helpId = useId();
  return (
    <Tooltip open={help === undefined ? false : undefined}>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <ToggleGroupItem
            value={value}
            aria-keyshortcuts={help?.shortcut === true && !disabled ? ARIA_SHORTCUTS : undefined}
            aria-disabled={disabled || undefined}
            aria-describedby={help === undefined ? undefined : helpId}
            data-testid={testId}
            data-blocked={blocked || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {children}
          </ToggleGroupItem>
          {help === undefined ? null : (
            <span id={helpId} className="sr-only">
              {help.shortcut ? `${help.text} (${shortcut})` : help.text}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent data-testid="driver-tooltip">
        {help === undefined ? null : help.shortcut ? (
          <span className="inline-flex items-center gap-2">
            {help.text}
            <kbd className="rounded-sm border border-border bg-muted px-1 text-mono-compact text-muted-foreground">{shortcut}</kbd>
          </span>
        ) : (
          help.text
        )}
      </TooltipContent>
    </Tooltip>
  );
}
