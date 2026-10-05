import { PaperPlaneRight } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { clearDraftIfUnchanged, readDraft, writeDraft } from '@/chat/drafts';
import { Button } from '@/ui/button';
import { ComposerFrame } from '@/ui/composer-frame';
import { Textarea } from '@/ui/textarea';
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
  /** Sends the text; rejects with a plain message to show if it wasn't sent. */
  onSend(text: string): Promise<void>;
}

/**
 * The session view's composer (EXPERIENCE.md Composer): `Enter` sends,
 * `Shift+Enter` starts a new line. While the agent works, sending queues the
 * message (the page says so in `hint`). `Esc` does nothing here: it never stops the agent.
 */
export function Composer({ label, blockedReason, hint, action, footer, describedBy, restore, draftKey, onSend }: ComposerProps) {
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

  const submit = () => {
    if (blocked || text.trim() === '') return;
    const sent = text;
    const sentKey = draftKey;
    setSending(true);
    setError(undefined);
    onSend(sent).then(
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
      submit();
    }
  };

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
          <Button type="submit" size="icon" aria-label="Send" aria-disabled={blocked || text.trim() === ''}>
            <PaperPlaneRight aria-hidden />
          </Button>
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
