import {
  BOARD_BLOCKED_CANCEL_LABEL,
  BOARD_BLOCKED_REASON_LABEL,
  BOARD_BLOCKED_REASON_REQUIRED,
  BOARD_BLOCKED_SAVE_LABEL,
  BOARD_CHANGE_STATUS_LABEL,
  BOARD_REOPEN_CANCEL_LABEL,
  BOARD_REOPEN_CONFIRM_LABEL,
  BOARD_REOPEN_DIALOG_TITLE,
  boardReopenDescription,
  boardBlockedDialogTitle,
  boardChangeStatusLabel,
  boardColumnOf,
  boardStatusActionText,
  MARKABLE_TICKET_STATUSES,
  MAX_BLOCKED_REASON_LENGTH,
  TicketStatus,
  type MarkTicketRequest,
  type TicketRow,
} from '@ogden-agents/shared';
import { DotsThree } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';

/** A status change the menu asks for: the ticket, and the request to send for it. */
export interface TicketStatusChoice {
  ref: string;
  request: MarkTicketRequest;
}

/**
 * The status the board showed, as `expectedStatus` takes it: the plan's
 * status, `''` for a ticket with no plan status, and nothing for a status
 * the board doesn't know (the mark then runs on whatever the plan has).
 */
export function expectedStatusOf(row: Pick<TicketRow, 'status'>): TicketStatus | '' | undefined {
  const status = row.status ?? '';
  if (status === '') return '';
  const known = TicketStatus.safeParse(status);
  return known.success ? known.data : undefined;
}

type ColumnRow = Pick<TicketRow, 'status' | 'state'> & Partial<Pick<TicketRow, 'blocked_at'>>;

/**
 * Every status the board may offer for `row`: all but `done`, its current
 * status, and any whose column is the one the ticket already shows (a
 * planned ticket in Draft gets no "Move to Draft").
 */
export function statusChoicesFor(row: ColumnRow): TicketStatus[] {
  const shown = boardColumnOf(row);
  return MARKABLE_TICKET_STATUSES.filter((status) => status !== (row.status ?? '') && (shown === null || boardColumnOf({ status, state: '' }) !== shown));
}

export interface TicketStatusMenuProps {
  row: Pick<TicketRow, 'ref' | 'title'> & ColumnRow;
  /** Asked once per choice (Blocked: once its reason is given). */
  onChoose: (choice: TicketStatusChoice) => void;
  /** While a status change is saved: the trigger does nothing. */
  busy?: boolean;
  /**
   * `card`: an icon button at the card's corner, the reason in a dialog;
   * `sheet`: a button with its words, the reason in a form right under it
   * (the sheet is a modal already: never a second one on top).
   */
  variant?: 'card' | 'sheet';
  className?: string;
}

/**
 * A ticket's status menu (story 4.10, E4-R9): a real button, named "Change
 * status of 1.2 <title>", outside any link, that opens a Radix menu (Enter,
 * Space, arrows, Esc) listing every status a person may set but Done and the
 * ticket's current one or column ("Move to Ready", "Drop this ticket").
 * Blocked first asks for a reason with a labelled field that won't submit
 * empty. Focus goes back to the button when the reason is cancelled or
 * saved. Nothing moves here: the caller sends the change and the board shows
 * what the files then say.
 *
 * A Done ticket (user decision 2026-10-02) may move out of Done, but only
 * after "Reopen this ticket?" is confirmed: an alert dialog on a card, an
 * inline confirmation in the sheet (never a second modal on it). Cancel
 * (or Esc) sends nothing and gives focus back to the button; Reopen sends
 * the change with `reopen: true` (Blocked asks for its reason first).
 */
export function TicketStatusMenu({ row, onChoose, busy = false, variant = 'card', className }: TicketStatusMenuProps) {
  const [blocking, setBlocking] = useState(false);
  /** The status chosen for a Done ticket, waiting for the reopen confirmation. */
  const [reopening, setReopening] = useState<TicketStatus | null>(null);
  /** The user confirmed reopening this Done ticket (kept while Blocked asks for its reason). */
  const reopenConfirmed = useRef(false);
  /** Set when the reopen was confirmed for Blocked, so the closing confirmation leaves focus to the reason form. */
  const toBlocked = useRef(false);
  /** The inline reopen confirmation's Cancel, focused once the menu has closed. */
  const reopenCancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Set when Blocked was chosen, so the closing menu leaves focus to the reason form. */
  const opening = useRef(false);
  const expectedStatus = expectedStatusOf(row);
  const isDone = expectedStatus === 'done';
  const choose = (status: TicketStatus, blockedReason?: string) => {
    const request: MarkTicketRequest = { status };
    if (blockedReason !== undefined) request.blockedReason = blockedReason;
    if (expectedStatus !== undefined) request.expectedStatus = expectedStatus;
    if (isDone && reopenConfirmed.current) request.reopen = true;
    reopenConfirmed.current = false;
    onChoose({ ref: row.ref, request });
  };
  /** A status picked from the menu (or confirmed as a reopen): Blocked asks for a reason, the rest are sent. */
  const pick = (status: TicketStatus) => {
    if (status === 'blocked') {
      opening.current = true;
      setBlocking(true);
    } else choose(status);
  };
  const confirmReopen = (confirmed: boolean) => {
    const status = reopening;
    setReopening(null);
    reopenConfirmed.current = confirmed && status !== null;
    toBlocked.current = reopenConfirmed.current && status === 'blocked';
    if (!reopenConfirmed.current || status === null) {
      if (variant === 'sheet') triggerRef.current?.focus();
      return;
    }
    if (status === 'blocked') setBlocking(true);
    else choose(status);
    // Inline, the reopen confirmation goes at once: focus back to the button (the reason form takes it itself).
    if (variant === 'sheet' && status !== 'blocked') triggerRef.current?.focus();
  };
  const close = (reason?: string) => {
    setBlocking(false);
    if (reason === undefined) reopenConfirmed.current = false;
    // The inline form goes at once; the dialog gives focus back once it has closed (`onCloseAutoFocus`).
    if (variant === 'sheet') triggerRef.current?.focus();
    if (reason !== undefined) choose('blocked', reason);
  };
  const form = <BlockedReasonForm ticketRef={row.ref} inline={variant === 'sheet'} onSave={(reason) => close(reason)} onCancel={() => close()} />;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant={variant === 'card' ? 'ghost' : 'outline'}
            size={variant === 'card' ? 'icon' : 'sm'}
            aria-label={boardChangeStatusLabel(row.ref, row.title)}
            aria-disabled={busy || undefined}
            onPointerDown={busy ? (event) => event.preventDefault() : undefined}
            onKeyDown={busy ? (event) => (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' ? event.preventDefault() : undefined) : undefined}
            data-testid="ticket-status-trigger"
            data-ref={row.ref}
            className={cn(variant === 'card' && 'size-8 text-muted-foreground', variant === 'sheet' && 'self-start', className)}
          >
            <DotsThree aria-hidden weight="bold" />
            {variant === 'sheet' ? <span>{BOARD_CHANGE_STATUS_LABEL}</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-testid="ticket-status-menu"
          onCloseAutoFocus={(event) => {
            // Blocked was chosen: the reason form takes focus, not the button.
            if (opening.current) {
              opening.current = false;
              event.preventDefault();
              // Inline in the sheet, the reopen confirmation starts on Cancel (on a card, the alert dialog does it).
              reopenCancelRef.current?.focus();
            }
          }}
        >
          {statusChoicesFor(row).map((status) => (
            <DropdownMenuItem
              key={status}
              data-testid="ticket-status-item"
              data-status={status}
              onSelect={() => {
                if (isDone) {
                  // Out of Done only once the reopen is confirmed: the confirmation takes focus, not the button.
                  opening.current = true;
                  setReopening(status);
                } else pick(status);
              }}
            >
              {boardStatusActionText(status)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {variant === 'sheet' ? (
        reopening === null ? null : (
          <ReopenConfirmation cancelRef={reopenCancelRef} ticketRef={row.ref} status={reopening} onConfirm={() => confirmReopen(true)} onCancel={() => confirmReopen(false)} />
        )
      ) : (
        <AlertDialog open={reopening !== null} onOpenChange={(open) => (open ? undefined : confirmReopen(false))}>
          {reopening === null ? null : (
            <AlertDialogContent
              title={BOARD_REOPEN_DIALOG_TITLE}
              description={boardReopenDescription(row.ref, reopening)}
              data-testid="ticket-reopen-dialog"
              // No trigger of its own: focus goes back to the status button, or on to the reason dialog.
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (toBlocked.current) toBlocked.current = false;
                else triggerRef.current?.focus();
              }}
            >
              <AlertDialogCancel data-testid="ticket-reopen-cancel">{BOARD_REOPEN_CANCEL_LABEL}</AlertDialogCancel>
              <Button onClick={() => confirmReopen(true)} data-testid="ticket-reopen-confirm">
                {BOARD_REOPEN_CONFIRM_LABEL}
              </Button>
            </AlertDialogContent>
          )}
        </AlertDialog>
      )}
      {variant === 'sheet' ? (
        blocking ? (
          form
        ) : null
      ) : (
        <Dialog open={blocking} onOpenChange={(open) => (open ? undefined : close())}>
          <DialogContent
            title={boardBlockedDialogTitle(row.ref)}
            data-testid="ticket-blocked-dialog"
            // The dialog has no trigger of its own: focus goes back to the status button.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            {form}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * The sheet's "Reopen this ticket?" (user decision 2026-10-02): inline, as
 * the sheet is a modal already. An alert dialog by role, named by its title
 * and described by its one sentence; focus starts on Cancel, Esc cancels it
 * (not the sheet).
 */
function ReopenConfirmation({
  cancelRef,
  ticketRef,
  status,
  onConfirm,
  onCancel,
}: {
  cancelRef: RefObject<HTMLButtonElement | null>;
  ticketRef: string;
  status: TicketStatus;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    cancelRef.current?.focus();
  }, [cancelRef]);
  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        // Esc closes the confirmation, not the sheet under it.
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      data-testid="ticket-reopen-dialog"
    >
      <Text as="h4" variant="label" id={titleId}>
        {BOARD_REOPEN_DIALOG_TITLE}
      </Text>
      <p id={descriptionId} className="m-0 text-body text-muted-foreground">
        {boardReopenDescription(ticketRef, status)}
      </p>
      <div className="flex justify-end gap-2">
        <Button ref={cancelRef} variant="outline" onClick={onCancel} data-testid="ticket-reopen-cancel">
          {BOARD_REOPEN_CANCEL_LABEL}
        </Button>
        <Button onClick={onConfirm} data-testid="ticket-reopen-confirm">
          {BOARD_REOPEN_CONFIRM_LABEL}
        </Button>
      </div>
    </div>
  );
}

/**
 * The blocked reason: a labelled field, Save and Cancel. An empty reason
 * doesn't submit: the error is announced and focus goes to the field. Inline
 * (in the sheet), its title is shown above it and it takes focus when shown;
 * Esc cancels it.
 */
function BlockedReasonForm({ ticketRef, inline, onSave, onCancel }: { ticketRef: string; inline: boolean; onSave: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const errorId = useId();
  const titleId = useId();
  useEffect(() => {
    if (inline) fieldRef.current?.focus();
  }, [inline]);
  const empty = reason.trim() === '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (empty) {
      setTried(true);
      fieldRef.current?.focus();
      return;
    }
    onSave(reason.trim());
  };
  return (
    <form
      onSubmit={submit}
      onKeyDown={
        inline
          ? (event) => {
              // Esc closes the form, not the sheet under it.
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          : undefined
      }
      className={cn('flex flex-col gap-4', inline && 'gap-3 rounded-lg border border-border p-3')}
      aria-labelledby={inline ? titleId : undefined}
      noValidate
      data-testid="ticket-blocked-form"
    >
      {inline ? (
        <Text as="h4" variant="label" id={titleId}>
          {boardBlockedDialogTitle(ticketRef)}
        </Text>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>{BOARD_BLOCKED_REASON_LABEL}</Label>
        <Textarea
          ref={fieldRef}
          id={fieldId}
          value={reason}
          required
          maxLength={MAX_BLOCKED_REASON_LENGTH}
          aria-invalid={tried && empty ? true : undefined}
          aria-describedby={tried && empty ? errorId : undefined}
          onChange={(event) => setReason(event.target.value)}
          data-testid="ticket-blocked-reason"
          className="rounded-md border border-border px-2 py-1.5"
        />
        {tried && empty ? (
          <p id={errorId} role="alert" className="m-0 text-caption text-state-error" data-testid="ticket-blocked-reason-error">
            {BOARD_BLOCKED_REASON_REQUIRED}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} data-testid="ticket-blocked-cancel">
          {BOARD_BLOCKED_CANCEL_LABEL}
        </Button>
        <Button type="submit" data-testid="ticket-blocked-save">
          {BOARD_BLOCKED_SAVE_LABEL}
        </Button>
      </div>
    </form>
  );
}
