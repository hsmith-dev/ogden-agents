import { PaperPlaneRight } from '@phosphor-icons/react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/ui/button';
import { ComposerFrame } from '@/ui/composer-frame';
import { Textarea } from '@/ui/textarea';
import { Text } from '@/ui/typography';

export interface ComposerProps {
  /** The accessible name of the text field, e.g. "Message Claude Code". */
  label: string;
  /** Why sending is not possible right now (the agent is still answering), shown under the field. */
  blockedReason?: string | undefined;
  /** Sends the text; rejects with a plain message to show if it wasn't sent. */
  onSend(text: string): Promise<void>;
}

/**
 * The session view's composer (EXPERIENCE.md Composer): `Enter` sends,
 * `Shift+Enter` starts a new line. Queueing a message while the agent works
 * comes with the full session view; until then sending waits for it.
 */
export function Composer({ label, blockedReason, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const blocked = sending || blockedReason !== undefined;

  const submit = () => {
    if (blocked || text.trim() === '') return;
    setSending(true);
    setError(undefined);
    onSend(text).then(
      () => {
        setSending(false);
        setText('');
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
      ) : null}
    </form>
  );
}
