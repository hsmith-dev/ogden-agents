import {
  ArrowDown,
  ArrowUp,
  PaperPlaneRight,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useState } from "react";
import { focusComposer } from "@/terminal/use-session-driver";
import {
  removeQueuedMessage,
  sendQueuedMessageNow,
  updateQueuedMessage,
} from "@/chat/send-mode";
import type { TranscriptMessage } from "@/chat/transcript";
import { Button } from "@/ui/button";
import { UserMessage } from "@/ui/message";
import { Textarea } from "@/ui/textarea";
import { Text } from "@/ui/typography";

export interface QueuedMessagesProps {
  wsId: string;
  sesId: string;
  /** The messages waiting to be sent, in the order they will go. */
  messages: readonly TranscriptMessage[];
  /** Read only (the terminal drives): shown, never changed. */
  readOnly: boolean;
  /** Why a message can't go right away now (a permission card waits), if so. */
  sendNowBlockedReason?: string | undefined;
  /** A change the server refused, in plain words, for the page to show. */
  onError(message: string | undefined): void;
}

/**
 * The messages waiting to be sent (send now or wait): one list, in the order
 * they will go, each with Edit, Move up, Move down, Send now and Remove. Every
 * change goes to the server; the list follows `session.queue_changed`, so
 * every tab shows the same. A message being sent right away says so and
 * can't be changed.
 */
export function QueuedMessages({
  wsId,
  sesId,
  messages,
  readOnly,
  sendNowBlockedReason,
  onError,
}: QueuedMessagesProps) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState({ text: "", n: 0 });

  /** Runs one change; on success says so (screen readers) and puts the cursor back in the composer. */
  const run = (
    action: () => Promise<void>,
    done: string,
    after?: () => void,
  ) => {
    if (busy) return;
    setBusy(true);
    onError(undefined);
    action().then(
      () => {
        setBusy(false);
        after?.();
        setSaid((previous) => ({ text: done, n: previous.n + 1 }));
        focusComposer();
      },
      (failure: unknown) => {
        setBusy(false);
        onError(
          failure instanceof Error
            ? failure.message
            : "That message couldn't be changed. Try again.",
        );
      },
    );
  };

  return (
    <>
      <div
        aria-live="polite"
        aria-atomic
        className="sr-only"
        data-testid="queue-announcement"
      >
        <span key={said.n}>{said.text}</span>
      </div>
      {messages.length === 0 ? null : (
        <ol
          aria-label="Messages waiting to be sent"
          data-testid="queued-messages"
          className="flex flex-col gap-2 self-end"
        >
          {messages.map((message, index) => {
            const sendingNow = message.now === true;
            // A message sent right away can still be edited or removed until it is on its way (the server refuses then).
            const frozen = readOnly || busy;
            const which = `message ${index + 1}`;
            return (
              <li
                key={message.messageId}
                data-testid="message-queued"
                data-status="queued"
                data-now={sendingNow || undefined}
                className="flex max-w-[85%] flex-col items-end gap-1 self-end"
              >
                {editing === message.messageId ? (
                  <form
                    className="flex w-full flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (draft.trim() === "") return;
                      run(
                        () =>
                          updateQueuedMessage(wsId, sesId, message.messageId, {
                            content: draft,
                          }),
                        "Message saved.",
                        () => setEditing(undefined),
                      );
                    }}
                  >
                    <Textarea
                      aria-label="Edit waiting message"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.preventDefault();
                        setEditing(undefined);
                        focusComposer();
                      }}
                      autoFocus
                      data-testid="queued-edit-field"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditing(undefined);
                          focusComposer();
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        aria-disabled={busy || draft.trim() === ""}
                        data-testid="queued-save"
                      >
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <UserMessage className="max-w-full">
                    {message.text}
                  </UserMessage>
                )}
                <div className="flex items-center gap-1">
                  <Text variant="caption" data-testid="message-queue-status">
                    {sendingNow ? "Sending now" : "Queued"}
                  </Text>
                  {messages.length > 1 ? (
                    <span className="sr-only">{`, ${index + 1} of ${messages.length}`}</span>
                  ) : null}
                  {readOnly || editing === message.messageId ? null : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${which}`}
                        aria-disabled={frozen}
                        data-testid="queued-edit"
                        onClick={() => {
                          if (frozen) return;
                          setDraft(message.text);
                          setEditing(message.messageId);
                        }}
                      >
                        <PencilSimple aria-hidden />
                      </Button>
                      {messages.length > 1 ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Move ${which} up`}
                            aria-disabled={frozen || index === 0}
                            data-testid="queued-up"
                            onClick={() =>
                              !frozen &&
                              index > 0 &&
                              run(
                                () =>
                                  updateQueuedMessage(
                                    wsId,
                                    sesId,
                                    message.messageId,
                                    { position: index - 1 },
                                  ),
                                "Message moved up.",
                              )
                            }
                          >
                            <ArrowUp aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Move ${which} down`}
                            aria-disabled={
                              frozen || index === messages.length - 1
                            }
                            data-testid="queued-down"
                            onClick={() =>
                              !frozen &&
                              index < messages.length - 1 &&
                              run(
                                () =>
                                  updateQueuedMessage(
                                    wsId,
                                    sesId,
                                    message.messageId,
                                    { position: index + 1 },
                                  ),
                                "Message moved down.",
                              )
                            }
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                        </>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Send ${which} now`}
                        title={sendNowBlockedReason}
                        aria-disabled={
                          frozen ||
                          sendingNow ||
                          sendNowBlockedReason !== undefined
                        }
                        data-testid="queued-send-now"
                        onClick={() => {
                          if (frozen || sendingNow) return;
                          if (sendNowBlockedReason !== undefined) {
                            onError(sendNowBlockedReason);
                            return;
                          }
                          run(
                            () =>
                              sendQueuedMessageNow(
                                wsId,
                                sesId,
                                message.messageId,
                              ),
                            "Sending the message now.",
                          );
                        }}
                      >
                        <PaperPlaneRight aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${which}`}
                        aria-disabled={frozen}
                        data-testid="queued-remove"
                        onClick={() =>
                          !frozen &&
                          run(
                            () =>
                              removeQueuedMessage(
                                wsId,
                                sesId,
                                message.messageId,
                              ),
                            "Message removed.",
                          )
                        }
                      >
                        <Trash aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
