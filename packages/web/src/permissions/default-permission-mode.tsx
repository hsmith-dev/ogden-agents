import { DEFAULT_MODE_NOTICE_TEXT, PERMISSION_MODE_LABELS, PERMISSION_MODES, type CoreEvent, type DefaultModeNotice, type PermissionMode } from '@ogden-agents/shared';
import { Info } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent } from '@/ui/alert-dialog';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';

/**
 * Default permission mode in the UI (EXPERIENCE.md Default permission mode):
 * the "New chats start in" choice of Workspace settings and of Settings →
 * New projects, Skip all's red confirmation (once per project), the notices
 * when a default went back to Ask, and the note a new chat shows about the
 * mode it started in. The server decides every change and every chat's
 * starting mode; this only asks.
 */

/** What each mode does as a default, agent-neutral (each chat names its own agent). */
export const DEFAULT_MODE_DESCRIPTIONS: Readonly<Record<PermissionMode, string>> = {
  ask: "Every request shows a card, under this project's caution level and Always-allow rules.",
  auto: "The agent's own auto mode approves what it judges safe and asks you about the rest. An agent without Auto starts in Ask.",
  skip_all: 'The agent runs everything without asking. Each such chat shows a red banner. Only in Developer mode.',
};

/** Skip all's red warning as the default for new projects: each still waits for its own confirmation. */
export const SKIP_ALL_NEW_PROJECTS_WARNING =
  'Projects you add from now on will offer to start their new chats in Skip all, where the agent runs commands, edits and deletes files, and uses the network without asking you. Each new project still asks you to confirm it once, and starts its chats in Ask until you do.';

/** Skip all's red warning as a default: what it does, in plain words. */
export const SKIP_ALL_DEFAULT_WARNING =
  'Every new chat here will run commands, edit and delete files, and use the network without asking you, anywhere it can reach on this computer. Only the agent’s own safety checks still ask. Each such chat shows a red banner, and you can switch it back to Ask.';

export interface DefaultPermissionModeViewProps {
  /** The saved (or just chosen) default; `undefined` while loading. */
  value: PermissionMode | undefined;
  notice?: DefaultModeNotice | undefined;
  /** Skip all is listed only in Developer mode (or while it is the default). */
  developerMode: boolean;
  /** Asks the server for `mode`; for Skip all only after the user confirmed its warning. */
  onChange(mode: PermissionMode, confirmed: boolean): void;
  saving: boolean;
  status: { kind: 'saved' | 'error'; text: string } | undefined;
  /** Test ids and element ids start with this. */
  testId: string;
  title: string;
  description: string;
  /** The warning's question, naming what it applies to. */
  confirmTitle: string;
  /** The warning's words; default {@link SKIP_ALL_DEFAULT_WARNING} (a project's new chats). */
  confirmWarning?: string | undefined;
}

/** Ask, Auto and (in Developer mode) Skip all as radios, Skip all behind its red warning, and the notice when there is one. */
export function DefaultPermissionModeView({
  value,
  notice,
  developerMode,
  onChange,
  saving,
  status,
  testId,
  title,
  description,
  confirmTitle,
  confirmWarning = SKIP_ALL_DEFAULT_WARNING,
}: DefaultPermissionModeViewProps) {
  const [confirming, setConfirming] = useState(false);
  const listed = PERMISSION_MODES.filter((mode) => mode !== 'skip_all' || developerMode || value === 'skip_all');
  const choose = (mode: PermissionMode) => {
    // The same mode again only when it clears a notice (the server clears it on the user's choice).
    if (saving || (mode === value && notice === undefined)) return;
    if (mode === 'skip_all') setConfirming(true);
    else onChange(mode, false);
  };
  return (
    <PageSection title={title} data-testid={`${testId}-section`}>
      <Text id={`${testId}-description`}>{description}</Text>
      {notice === undefined ? null : (
        <Notice
          variant="info"
          infoGlyph
          role="status"
          data-testid={`${testId}-notice`}
          action={
            <span className="flex flex-wrap gap-2">
              {notice === 'skip_all_unconfirmed' && developerMode ? (
                <Button variant="outline" size="sm" data-testid={`${testId}-confirm-skip-all`} aria-disabled={saving || undefined} onClick={() => !saving && setConfirming(true)}>
                  Confirm Skip all
                </Button>
              ) : null}
              <Button variant="outline" size="sm" data-testid={`${testId}-keep-ask`} aria-disabled={saving || undefined} onClick={() => !saving && choose('ask')}>
                {notice === 'skip_all_unconfirmed' ? 'Keep Ask' : 'Dismiss'}
              </Button>
            </span>
          }
        >
          {DEFAULT_MODE_NOTICE_TEXT[notice]}
          {notice === 'skip_all_unconfirmed' && !developerMode ? ' Turn on Developer mode in Settings → Appearance to confirm it.' : ''}
        </Notice>
      )}
      {value === undefined ? null : (
        <RadioGroup
          aria-label={title}
          aria-describedby={`${testId}-description`}
          data-testid={testId}
          value={value}
          disabled={saving}
          onValueChange={(next) => {
            if ((PERMISSION_MODES as readonly string[]).includes(next)) choose(next as PermissionMode);
          }}
        >
          {listed.map((mode) => (
            <RadioGroupOption key={mode} id={`${testId}-${mode}`} value={mode} data-testid={`${testId}-${mode}`} label={PERMISSION_MODE_LABELS[mode]} description={DEFAULT_MODE_DESCRIPTIONS[mode]} />
          ))}
        </RadioGroup>
      )}
      <Text variant="caption" role="status" data-testid={`${testId}-status`}>
        {status?.kind === 'saved' ? status.text : ''}
      </Text>
      {status?.kind === 'error' ? (
        <Notice variant="blocked" role="alert" data-testid={`${testId}-error`}>
          {status.text}
        </Notice>
      ) : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          data-testid={`${testId}-skip-all-confirm`}
          title={confirmTitle}
          description={confirmWarning}
          // Opened from a radio or a notice button, not a trigger: focus goes back to the chosen option, never to the page.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById(`${testId}-${value ?? 'ask'}`)?.focus();
          }}
        >
          <AlertDialogCancel data-testid={`${testId}-skip-all-cancel`}>Cancel</AlertDialogCancel>
          <AlertDialogConfirm
            data-testid={`${testId}-skip-all-confirm-button`}
            onClick={() => {
              setConfirming(false);
              onChange('skip_all', true);
            }}
          >
            Start new chats in Skip all
          </AlertDialogConfirm>
        </AlertDialogContent>
      </AlertDialog>
    </PageSection>
  );
}

/** The note on `session.created` about the mode the chat started in, if any, until the chat's mode changes. */
export function useStartModeNote(events: readonly CoreEvent[]): string | undefined {
  return useMemo(() => {
    // Once the mode changed, the note about how it started is out of date.
    if (events.some((event) => event.type === 'session.permission_mode_changed')) return undefined;
    const created = events.find((event) => event.type === 'session.created');
    return created?.type === 'session.created' ? created.payload.permissionModeNote : undefined;
  }, [events]);
}

/**
 * The note above a new chat about the mode it started in (its project's
 * default, or Ask because its agent doesn't offer that default), until the
 * user dismisses it. The Skip-all banner is separate and always shown.
 */
export function StartModeNote({ note }: { note: string | undefined }) {
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  if (note === undefined || dismissed === note) return null;
  return (
    <Banner
      data-testid="start-mode-note"
      action={
        <Button variant="link" size="sm" data-testid="start-mode-note-dismiss" onClick={() => setDismissed(note)}>
          Dismiss
        </Button>
      }
    >
      <span className="inline-flex items-center gap-1">
        <Info aria-hidden />
        {note}
      </span>
    </Banner>
  );
}
