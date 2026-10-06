/**
 * Parts of the session page's transcript (moved out of
 * `routes/session-page.tsx` by story 6.9 to keep it under 600 lines): Show
 * earlier, the resumed marker, the handoff divider, and one message.
 */
import { ORCHESTRATION_MANAGER_AUTO_MARK, ORCHESTRATION_MANAGER_MARK } from '@ogden-agents/shared';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { TranscriptMessage } from '@/chat/transcript';
import { Button } from '@/ui/button';
import { Markdown } from '@/ui/markdown';
import { AgentMessage, UserMessage } from '@/ui/message';
import { Separator } from '@/ui/separator';
import { Text } from '@/ui/typography';

/** The marker at the break where a reopened chat continues (EXPERIENCE.md). */
const RESUMED_FROM_HISTORY = 'Resumed from history';

/**
 * "Show earlier" at the top of the transcript (EXPERIENCE.md: no infinite
 * scroll): one page per press, in place, with no reload. A page that fails or
 * times out says so inline, with Try again.
 */
export function EarlierHistory({ loading, error, onShow }: { loading: boolean; error: string | undefined; onShow: () => void }) {
  if (error !== undefined && !loading) {
    return (
      <div data-testid="earlier-history-error" className="flex items-center justify-center gap-2" title={error}>
        <Text as="span" variant="caption" role="alert">
          Couldn't load.
        </Text>
        <Button variant="outline" onClick={onShow} data-testid="earlier-history-retry">
          <ArrowClockwise aria-hidden />
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <Button variant="ghost" onClick={onShow} aria-disabled={loading} aria-busy={loading} data-testid="show-earlier">
        {loading ? 'Loading earlier messages' : 'Show earlier'}
      </Button>
    </div>
  );
}

/**
 * Where a chat was reopened after its agent's process was gone (story 2.7):
 * the same words for every way it came back (EXPERIENCE.md, session `idle`).
 */
export function ResumedMarker() {
  return (
    <div role="separator" aria-label={RESUMED_FROM_HISTORY} data-testid="resumed-marker" className="flex items-center gap-3">
      <Separator className="flex-1" />
      <Text as="span" variant="caption" className="shrink-0">
        {RESUMED_FROM_HISTORY}
      </Text>
      <Separator className="flex-1" />
    </div>
  );
}

/**
 * Where the user continued the chat with another agent (handoff): the history
 * above stays, and from here the chat is with `agentName`.
 */
export function AgentChangedMarker({ agentName }: { agentName: string }) {
  const words = `Continued with ${agentName}`;
  return (
    <div role="separator" aria-label={words} data-testid="agent-changed-marker" className="flex items-center gap-3">
      <Separator className="flex-1" />
      <Text as="span" variant="caption" className="shrink-0">
        {words}
      </Text>
      <Separator className="flex-1" />
    </div>
  );
}

/** What a message sent while the agent worked says under it (EXPERIENCE.md Composer). */
const QUEUE_WORDS = { queued: 'Queued', not_sent: 'Not sent' } as const;

/**
 * One message: the user's in a muted block on the right, as typed; the
 * agent's as Markdown under its name (DESIGN.md Message), the same for a
 * reply brought back from the terminal. A queued or unsent one says so under it.
 */
export function Message({ message, agentName }: { message: TranscriptMessage; agentName: string }) {
  if (message.role === 'user' && message.status !== undefined) {
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="message-queued" data-status={message.status}>
        <UserMessage className="max-w-full">{message.text}</UserMessage>
        <Text variant="caption" data-testid="message-queue-status">
          {message.status === 'queued' && message.now === true ? 'Sending now' : QUEUE_WORDS[message.status]}
        </Text>
      </div>
    );
  }
  if (message.role === 'user' && message.origin === 'terminal') {
    // Typed in the agent's own terminal and brought back on switching (story 3.6; DESIGN.md Caption).
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="message-from-terminal">
        <UserMessage className="max-w-full" data-testid="message-user">
          {message.text}
        </UserMessage>
        <Text variant="caption" data-testid="message-origin">
          from terminal
        </Text>
      </div>
    );
  }
  if (message.role === 'user' && (message.origin === 'manager' || message.origin === 'manager_auto')) {
    // An instruction the orchestration manager wrote and the user approved (epic 15, 15.3), or one it sent on its own under Dispatch automatically (15.8).
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="message-from-manager">
        <UserMessage className="max-w-full" data-testid="message-user">
          {message.text}
        </UserMessage>
        <Text variant="caption" data-testid="message-origin">
          {message.origin === 'manager_auto' ? ORCHESTRATION_MANAGER_AUTO_MARK : ORCHESTRATION_MANAGER_MARK}
        </Text>
      </div>
    );
  }
  if (message.role === 'user' && message.delivery === 'injected') {
    // Sent right away into the running turn (send now or wait).
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="message-sent-now">
        <UserMessage className="max-w-full" data-testid="message-user">
          {message.text}
        </UserMessage>
        <Text variant="caption" data-testid="message-delivery">
          Sent while the agent was working
        </Text>
      </div>
    );
  }
  if (message.role === 'user') return <UserMessage data-testid="message-user">{message.text}</UserMessage>;
  return (
    <AgentMessage name={agentName} data-testid="message-agent" data-streaming={message.streaming} aria-busy={message.streaming}>
      <Markdown source={message.text} variant="chat" streaming={message.streaming} />
    </AgentMessage>
  );
}

/** Where the agent's step was stopped so a message sent right away went at once (send now or wait). */
export function InterruptedNote({ cancelledRequest = false }: { cancelledRequest?: boolean | undefined }) {
  return (
    <div className="flex items-center gap-3" data-testid="turn-interrupted" role="note">
      <Separator className="flex-1" />
      <Text variant="caption">
        Stopped the current step to send your message.
        {cancelledRequest ? ' A pending approval request was cancelled; the agent can ask again.' : ''}
      </Text>
      <Separator className="flex-1" />
    </div>
  );
}
