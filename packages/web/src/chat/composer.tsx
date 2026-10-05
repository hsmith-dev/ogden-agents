import { CaretDown, PaperPlaneRight } from '@phosphor-icons/react';
import type { WhileWorking } from '@ogden-agents/shared';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { clearDraftIfUnchanged, readDraft, writeDraft } from '@/chat/drafts';
import { otherWay, otherWayShortcutLabel, SEND_WORDS } from '@/chat/send-mode';
import { Button } from '@/ui/button';
import { ComposerFrame } from '@/ui/composer-frame';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Kbd } from '@/ui/kbd';
import { Textarea } from '@/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { Text } from '@/ui/typography';

export interface ComposerProps {
  /** The accessible name of the text field, e.g. "Message Claude Code". */
  label: string;
  /** Why sending is not possible right now (the agent waits for an answer), shown under the field. */
  blockedReason?: string | undefined;
  /** A note under the field when sending is possible (the message will be queued). */
  hint?: string | undefined;
  /** Beside Send: the Stop button while the agent works (story 2.10). */
  action?: ReactNode;
  /** The id of an element that says more about the field (the chosen agent can't start a chat now). */
  describedBy?: string | undefined;
  /** At the start of the footer row: the agent picker for a new chat (epic 6), or the chat's model picker (story 11; DESIGN.md Composer). */
  footer?: ReactNode;
  /**
   * Text to put back in the field (messages that were not sent; story 2.10),
   * ahead of anything already typed. Applied once per `key`.
   */
  restore?: { key: string; text: string } | undefined;
  /**
   * Where the unsent text is kept for the short term (backlog story 6): this
   * chat's, or a project's new-chat composer's, draft in this browser only.
   * Without it nothing is kept.
   */
  draftKey?: string | undefined;
  /**
   * Send now or wait: while the agent works, what `Enter` and Send do (the
   * project's or app's choice). The other way is in the menu beside Send and
   * on `Cmd/Ctrl+Enter`. Absent: one way only, as before.
   */
  whileWorking?: WhileWorking | undefined;
  /** Whether the agent is working now, so the two ways are offered. */
  working?: boolean | undefined;
  /** Sends the text (`delivery` only when the composer offers two ways); rejects with a plain message to show if it wasn't sent. */
  onSend(text: string, delivery?: WhileWorking): Promise<void>;
}

/**
 * The session view's composer (EXPERIENCE.md Composer): `Enter` sends,
 * `Shift+Enter` starts a new line. While the agent works, sending queues the
 * message (the page says so in `hint`), or sends it right away, by the
 * project's choice; `Cmd/Ctrl+Enter` and the menu beside Send do the other
 * (send now or wait). `Esc` does nothing here: it never stops the agent.
 */
export function Composer({ label, blockedReason, hint, action, footer, describedBy, restore, draftKey, whileWorking, working, onSend }: ComposerProps) {
  const [text, setText] = useState(() => (draftKey === undefined ? '' : readDraft(draftKey)));
  const currentKey = useRef(draftKey);
  const field = useRef<HTMLTextAreaElement>(null);
  // Kept text shown on opening a chat: the cursor goes after it, so typing carries on.
  useLayoutEffect(() => {
    const element = field.current;
    if (element !== null && draftKey !== undefined) element.setSelectionRange(element.value.length, element.value.length);
  }, [draftKey]);
  useEffect(() => {
    currentKey.current = draftKey;
    if (draftKey !== undefined) writeDraft(draftKey, text);
  }, [draftKey, text]);
  const restoreKey = restore?.key;
  const restoreText = restore?.text;
  // A restore already given to an earlier mount is in the draft now: applying it again would double it.
  const appliedRestore = useRef(draftKey === undefined ? undefined : restoreKey);
  useEffect(() => {
    if (restoreKey === undefined || restoreText === undefined || restoreText === '') return;
    if (appliedRestore.current === restoreKey) return;
    appliedRestore.current = restoreKey;
    setText((typed) => (typed.trim() === '' ? restoreText : `${restoreText}\n\n${typed}`));
  }, [restoreKey, restoreText]);
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // The page may stay mounted from one chat to the next: show the new chat's own draft,
  // and not the last chat's send error next to it.
  const [shownKey, setShownKey] = useState(draftKey);
  if (shownKey !== draftKey) {
    setShownKey(draftKey);
    setText(draftKey === undefined ? '' : readDraft(draftKey));
    setError(undefined);
  }
  const blocked = sending || blockedReason !== undefined;

  const twoWays = whileWorking !== undefined;
  const submit = (delivery: WhileWorking | undefined = whileWorking) => {
    if (blocked || text.trim() === '') return;
    const sent = text;
    const sentKey = draftKey;
    setSending(true);
    setError(undefined);
    onSend(sent, twoWays ? delivery : undefined).then(
      () => {
        setSending(false);
        // Clear only what was sent: text typed while it was on its way (the
        // agent already showing working, say) is the next message, not this one.
        // The draft too, even when this composer has gone (a first chat opens its page).
        if (sentKey !== undefined) clearDraftIfUnchanged(sentKey, sent);
        if (currentKey.current === sentKey) setText((current) => (current === sent ? '' : current));
      },
      (failure: unknown) => {
        setSending(false);
        // A refusal for a chat the page has left stays in that chat's draft, not under this one.
        if (currentKey.current !== sentKey) return;
        setError(failure instanceof Error ? failure.message : "Your message couldn't be sent. Try again.");
      },
    );
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      // `Cmd/Ctrl+Enter`: the other way, for this one message.
      submit(twoWays && (event.metaKey || event.ctrlKey) ? otherWay(whileWorking) : whileWorking);
    }
  };
  const emptyOrBlocked = blocked || text.trim() === '';
  const sendButton = (
    <Button type="submit" size="icon" aria-label="Send" aria-disabled={emptyOrBlocked} aria-keyshortcuts={twoWays && working ? 'Enter Meta+Enter Control+Enter' : 'Enter'}>
      <PaperPlaneRight aria-hidden />
    </Button>
  );

  return (
    <form onSubmit={onSubmit} data-testid="composer" className="flex flex-col gap-2">
      <ComposerFrame>
        <Textarea
          ref={field}
          aria-label={label}
          aria-describedby={describedBy}
          placeholder="Write a message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          // Opening a chat puts the cursor here (EXPERIENCE.md Empty chats).
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
          {footer === undefined ? null : <div className="mr-auto flex min-w-0 items-center overflow-hidden">{footer}</div>}
          {action}
          {twoWays && working ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>{sendButton}</TooltipTrigger>
                <TooltipContent data-testid="send-tooltip">
                  {SEND_WORDS[whileWorking]} <Kbd>Enter</Kbd>. {SEND_WORDS[otherWay(whileWorking)]} <Kbd>{otherWayShortcutLabel()}</Kbd>.
                </TooltipContent>
              </Tooltip>
              {/* Opens only with something to send; closing puts the cursor back in the field. */}
              <DropdownMenu open={menuOpen && !emptyOrBlocked} onOpenChange={(open) => setMenuOpen(open && !emptyOrBlocked)}>
                <DropdownMenuTrigger asChild>
                  {/* No "send" in its name: the Send button stays the only one named so. */}
                  <Button type="button" variant="outline" size="icon" aria-label="Choose when it goes" aria-disabled={emptyOrBlocked} data-testid="send-menu">
                    <CaretDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    field.current?.focus();
                  }}
                >
                  {(['now', 'wait'] as const).map((way) => (
                    <DropdownMenuItem key={way} disabled={emptyOrBlocked} data-testid={`send-${way}`} onSelect={() => submit(way)}>
                      {SEND_WORDS[way]}
                      {way === whileWorking ? <span className="ml-auto text-caption text-muted-foreground">Enter</span> : <Kbd className="ml-auto">{otherWayShortcutLabel()}</Kbd>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            sendButton
          )}
        </div>
      </ComposerFrame>
      {error !== undefined ? (
        <Text variant="caption" role="alert" data-testid="composer-error">
          {error}
        </Text>
      ) : blockedReason !== undefined ? (
        <Text variant="caption">{blockedReason}</Text>
      ) : hint !== undefined ? (
        <Text variant="caption" data-testid="composer-hint">
          {hint}
        </Text>
      ) : null}
    </form>
  );
}
