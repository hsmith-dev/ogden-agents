import { PERMISSION_MODE_LABELS, PERMISSION_MODES, type ChatAgent, type CoreEvent, type PermissionMode, type SessionPermissionModeOption } from '@ogden-agents/shared';
import { CaretDown, ShieldCheck, ShieldWarning } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { SETUP_CHIP_CLASS } from '@/chat/setup-row';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { cn } from '@/ui/utils';

/**
 * A chat's permission mode in the UI (permission modes; EXPERIENCE.md
 * Permission mode): the Mode chip in the composer's setup row (moved from
 * the session header, epic 27, 27.1), Skip all's red
 * confirmation, and the red banner while a chat skips its permission checks.
 * The server decides every change; the view follows only
 * `session.permission_mode_changed` (else the session as read).
 */

/** What each mode does, in one sentence naming the chat's agent (epic 6), as the picker says it. */
export const permissionModeDescriptions = (agentName: string): Readonly<Record<PermissionMode, string>> => ({
  ask: "Every request shows a card, under this project's caution level and Always-allow rules.",
  auto: `${agentName}'s auto mode approves what it judges safe and asks you about the rest, and always about editing files that control ${agentName} or git. This project's caution level doesn't apply.`,
  skip_all: `${agentName} skips its permission checks and runs everything without asking.`,
});

/** Why no mode can be chosen while the terminal drives (the server refuses it too). */
export const TERMINAL_MODE_REASON = 'Switch back to the chat to change its permission mode.';

/** Skip all's red warning: what it does, in plain words. */
export const skipAllWarning = (agentName: string) => `${agentName} will run commands, edit and delete files, and use the network in this chat without asking you, anywhere it can reach on this computer. Only its own safety checks still ask. Choose it only for work you can afford to lose.`;

/** The red banner's words while a chat is in Skip all. */
export const skipAllBanner = (agentName: string) => `Skip all is on: ${agentName} runs everything in this chat without asking.`;

/**
 * The chat's mode: the latest `session.permission_mode_changed` of its
 * stream, else the session as read, else the mode it was created in (a chat
 * can start in its project's default, Skip all included: its banner never
 * waits on the REST read), else Ask.
 */
export function usePermissionMode(events: readonly CoreEvent[], read: PermissionMode | undefined): PermissionMode {
  const latest = useMemo(() => events.findLast((event) => event.type === 'session.permission_mode_changed'), [events]);
  const created = useMemo(() => events.find((event) => event.type === 'session.created'), [events]);
  return (
    (latest?.type === 'session.permission_mode_changed' ? latest.payload.mode : undefined) ??
    read ??
    (created?.type === 'session.created' ? created.payload.session.permissionMode : undefined) ??
    'ask'
  );
}

/** Why Skip all can't be picked for a new chat: Developer mode is off. */
const SKIP_ALL_NEEDS_DEVELOPER_MODE = 'Skip all needs Developer mode.';

/**
 * The modes a new chat's draft offers (27.1): every mode the agent declares
 * (Ask always), Skip all only in Developer mode; the rest disabled with why.
 * The server checks the chosen mode again once the chat exists.
 */
export function draftModeOptions(agent: Pick<ChatAgent, 'displayName' | 'permissionModes'> | undefined, developerMode: boolean): SessionPermissionModeOption[] {
  return PERMISSION_MODES.map((mode) => {
    if (mode === 'ask') return { mode, available: true };
    if (agent === undefined || !agent.permissionModes.includes(mode)) {
      return { mode, available: false, reason: `${agent?.displayName ?? 'This agent'} doesn't offer ${PERMISSION_MODE_LABELS[mode]}.` };
    }
    if (mode === 'skip_all' && !developerMode) return { mode, available: false, reason: SKIP_ALL_NEEDS_DEVELOPER_MODE };
    return { mode, available: true };
  });
}

export interface PermissionModePickerProps {
  /** The chat's agent by its product name (epic 6): what the descriptions and reasons name. */
  agentName: string;
  mode: PermissionMode;
  /** Every mode and whether the session's agent offers it (`GET` session); `undefined` while it loads or from an older server. */
  options: readonly SessionPermissionModeOption[] | undefined;
  /** Skip all is listed only in Developer mode. */
  developerMode: boolean;
  /** Whether the terminal drives the chat: nothing can be chosen then. */
  terminalDrives: boolean;
  /** A change is on its way to the server. */
  changing: boolean;
  /** Asks the server for `mode`; for Skip all only after the user confirmed its warning. */
  onChoose(mode: PermissionMode, confirmed: boolean): void;
  /** The menu's heading ("Permission mode"; the draft's "Permission mode for the new chat"). */
  title?: string | undefined;
  /** Skip all's confirmation title (the draft's names the new chat). */
  confirmTitle?: string | undefined;
}

/**
 * The Mode chip in the composer's setup row: the current mode, and a
 * menu of Ask, Auto and (in Developer mode) Skip all, each with what it does;
 * a mode the agent doesn't offer is disabled with its one-sentence reason.
 * Choosing Skip all opens its red warning first; nothing changes unless the
 * user confirms it.
 */
export function PermissionModePicker({ agentName, mode, options, developerMode, terminalDrives, changing, onChoose, title, confirmTitle }: PermissionModePickerProps) {
  const [confirming, setConfirming] = useState(false);
  const descriptions = permissionModeDescriptions(agentName);
  // The agent takes its mode only when a chat starts, and this chat has started (epic 12, 12.3).
  const fixed = options?.some((option) => option.fixed === true) === true;
  const listed = PERMISSION_MODES.filter((each) => each !== 'skip_all' || developerMode || mode === 'skip_all');
  const reasonFor = (each: PermissionMode): string | undefined => {
    if (terminalDrives) return TERMINAL_MODE_REASON;
    const option = options?.find((candidate) => candidate.mode === each);
    return option === undefined || option.available ? undefined : (option.reason ?? `${agentName} doesn't offer ${PERMISSION_MODE_LABELS[each]}.`);
  };
  const choose = (each: PermissionMode) => {
    if (changing || each === mode || reasonFor(each) !== undefined) return;
    if (each === 'skip_all') setConfirming(true);
    else onChoose(each, false);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={SETUP_CHIP_CLASS}
            data-testid="permission-mode-picker"
            data-mode={mode}
            data-fixed={fixed ? 'true' : undefined}
            aria-label={`Permission mode: ${PERMISSION_MODE_LABELS[mode]}${fixed ? ', fixed for this chat' : ''}`}
            aria-busy={changing || undefined}
          >
            {mode === 'skip_all' ? <ShieldWarning aria-hidden /> : <ShieldCheck aria-hidden />}
            {/* Skip all keeps the ghost chip with its word in red; the red banner carries the warning (DESIGN.md Composer). */}
            <span className={cn('truncate', mode === 'skip_all' && 'text-destructive')}>{PERMISSION_MODE_LABELS[mode]}</span>
            <CaretDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="permission-mode-menu">
          <DropdownMenuLabel>{fixed ? 'Permission mode (fixed for this chat)' : (title ?? 'Permission mode')}</DropdownMenuLabel>
          {listed.map((each) => {
            const reason = reasonFor(each);
            return (
              <DropdownMenuChoiceItem
                key={each}
                data-testid={`permission-mode-${each}`}
                checked={each === mode}
                disabled={reason !== undefined && each !== mode}
                label={PERMISSION_MODE_LABELS[each]}
                description={reason !== undefined && each !== mode ? reason : descriptions[each]}
                onSelect={() => choose(each)}
              />
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid="skip-all-confirm" title={confirmTitle ?? 'Skip all permission checks in this chat?'} description={skipAllWarning(agentName)}>
          <AlertDialogCancel data-testid="skip-all-cancel">Cancel</AlertDialogCancel>
          <AlertDialogConfirm
            data-testid="skip-all-confirm-button"
            onClick={() => {
              setConfirming(false);
              onChoose('skip_all', true);
            }}
          >
            Skip all checks
          </AlertDialogConfirm>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export interface SkipAllBannerProps {
  /** The chat's agent by its product name (epic 6). */
  agentName: string;
  /** Back to Ask (from the terminal: back to the chat first). */
  onBackToAsk(): void;
  /** A change is on its way: the button waits. */
  changing: boolean;
}

/**
 * The red banner while a chat is in Skip all (DESIGN.md destructive; driven
 * from the chat or the terminal): a sibling above the page body and the
 * terminal, so it is in view at any scroll position and screen width, with a
 * way back to Ask.
 */
export function SkipAllBanner({ agentName, onBackToAsk, changing }: SkipAllBannerProps) {
  return (
    <Banner
      variant="destructive"
      data-testid="skip-all-banner"
      action={
        <Button
          variant="link"
          size="sm"
          // aria-disabled doesn't block a click: a second one while the first is on its way is ignored here.
          onClick={() => {
            if (!changing) onBackToAsk();
          }}
          aria-disabled={changing || undefined}
          data-testid="skip-all-back-to-ask"
        >
          Back to Ask
        </Button>
      }
    >
      <span className="inline-flex items-center gap-1">
        <ShieldWarning aria-hidden />
        {skipAllBanner(agentName)}
      </span>
    </Banner>
  );
}
