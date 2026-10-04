import { PaperPlaneRight } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
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
  /**
   * Text to put back in the field (messages that were not sent; story 2.10),
   * ahead of anything already typed. Applied once per `key`.
   */
  restore?: { key: string; text: string } | undefined;
  /** Sends the text; rejects with a plain message to show if it wasn't sent. */
  onSend(text: string): Promise<void>;
}

/**
 * The session view's composer (EXPERIENCE.md Composer): `Enter` sends,
 * `Shift+Enter` starts a new line. While the agent works, sending queues the
 * message (the page says so in `hint`). `Esc` does nothing here: it never stops the agent.
 */
export function Composer({ label, blockedReason, hint, action, restore, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const restoreKey = restore?.key;
  const restoreText = restore?.text;
  useEffect(() => {
    if (restoreKey === undefined || restoreText === undefined || restoreText === '') return;
    setText((typed) => (typed.trim() === '' ? restoreText : `${restoreText}\n\n${typed}`));
  }, [restoreKey, restoreText]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const blocked = sending || blockedReason !== undefined;

  const submit = () => {
    if (blocked || text.trim() === '') return;
    const sent = text;
    setSending(true);
    setError(undefined);
    onSend(sent).then(
      () => {
        setSending(false);
        // Clear only what was sent: text typed while it was on its way (the
        // agent already showing working, say) is the next message, not this one.
        setText((current) => (current === sent ? '' : current));
      },
      (failure: unknown) => {
        setSending(false);
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
          aria-label={label}
          placeholder="Write a message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          // Opening a chat puts the cursor here (EXPERIENCE.md Empty chats).
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
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
