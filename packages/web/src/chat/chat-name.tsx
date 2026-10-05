import { PencilSimple } from '@phosphor-icons/react';
import { API_ROUTES, apiPath, CHAT_NAME_MAX, chatName, normalizeChatName, SessionResponse, type CoreEvent, type Session } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { call } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { cn } from '@/ui/utils';

/**
 * Chat names (backlog story 2): every chat shows its name (the user's, else
 * the automatic one, else "New chat"), and the user renames it inline from
 * the chat's header, the sidebar and the chat list. Enter or leaving the
 * field saves, Esc cancels; a blank name puts the automatic one back. The
 * server normalizes and caps every name; the UI only ever renders it as
 * text. Views follow `session.renamed`, so every tab shows a rename live.
 */

/** The Rename action's words, in the header button and the row menus. */
export const RENAME_LABEL = 'Rename';

/** `PUT /api/v1/workspaces/:wsId/sessions/:sesId/title`: the user's name for the chat; `null` clears it. */
export async function renameChat(wsId: string, sesId: string, title: string | null, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<Session> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.sessionTitle, { wsId, sesId }),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) },
    "Ogden Agents couldn't rename this chat",
  );
  return SessionResponse.parse(json).session;
}

/** `sessions` with each one's latest `session.renamed` in `events` laid over it (events in log order). */
export function withNames<T extends Pick<Session, 'id' | 'title' | 'autoTitle'>>(sessions: readonly T[], events: readonly CoreEvent[]): T[] {
  const names = new Map<string, { title: string | null; autoTitle: string | null }>();
  for (const event of events) if (event.type === 'session.renamed') names.set(event.payload.sessionId, { title: event.payload.title, autoTitle: event.payload.autoTitle });
  if (names.size === 0) return [...sessions];
  return sessions.map((session) => {
    const named = names.get(session.id);
    return named === undefined ? session : { ...session, title: named.title, autoTitle: named.autoTitle };
  });
}

/** One chat's shown name: its stream's latest `session.renamed`, else the session as read. */
export function useChatName(events: readonly CoreEvent[], session: Pick<Session, 'title' | 'autoTitle'> | undefined): { name: string; title: string | null } {
  const latest = useMemo(() => events.findLast((event) => event.type === 'session.renamed'), [events]);
  const names = latest?.type === 'session.renamed' ? latest.payload : session;
  return { name: names === undefined ? '' : chatName(names), title: names?.title ?? null };
}

/** What a screen reader hears once a rename is saved. */
export const renamedAnnouncement = (title: string | null, shown: string): string => (title === null ? `Chat name cleared. It is called ${shown}` : `Chat renamed to ${title}`);

export interface ChatRename {
  editing: boolean;
  /** Opens the name field; when it closes, focus goes to what `target` returns then (the row or the Rename button). */
  start(target?: () => HTMLElement | null | undefined): void;
  /** The name field while editing, else `null`. */
  field: ReactNode;
  /** The always-mounted live region that announces a rename, and says why one failed. */
  status: ReactNode;
}

/**
 * Inline rename for one chat. `name` is what it shows now, `title` the
 * user's own name (`null` when it shows the automatic one).
 */
export function useChatRename({ wsId, sesId, name, title, className }: { wsId: string; sesId: string; name: string; title: string | null; className?: string }): ChatRename {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  /** What gets focus back once the field closes: read then, since the row or button it names was remounted. */
  const returnTo = useRef<(() => HTMLElement | null | undefined) | undefined>(undefined);
  const refocus = useRef(false);

  const close = useCallback(() => {
    refocus.current = true;
    setEditing(false);
  }, []);
  // After the field is gone and what opened it is back, focus goes there.
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    returnTo.current?.()?.focus({ preventScroll: true });
  }, [editing]);

  const save = useCallback(
    (value: string) => {
      close();
      const next = normalizeChatName(value);
      // Unchanged, or the automatic name kept as it was: nothing to save.
      if (next === title || (title === null && next === name)) return;
      setError(undefined);
      renameChat(wsId, sesId, next).then(
        (session) => {
          setMessage(renamedAnnouncement(session.title, chatName(session)));
          void queryClient.invalidateQueries({ queryKey: ['session', wsId, sesId] });
          void queryClient.invalidateQueries({ queryKey: ['sessions', wsId] });
        },
        (failure: unknown) => setError(failure instanceof Error ? failure.message : "Ogden Agents couldn't rename this chat. Try again."),
      );
    },
    [close, title, name, wsId, sesId, queryClient],
  );

  const start = useCallback((target?: () => HTMLElement | null | undefined) => {
    returnTo.current = target;
    setError(undefined);
    setEditing(true);
  }, []);

  return {
    editing,
    start,
    field: editing ? <ChatNameField initial={name} onSave={save} onCancel={close} className={className} /> : null,
    status: (
      <>
        <span role="status" className="sr-only" data-testid="chat-rename-status">
          {message}
        </span>
        {error === undefined ? null : (
          <span role="alert" className="text-caption text-destructive" data-testid="chat-rename-error">
            {error}
          </span>
        )}
      </>
    ),
  };
}

/** The inline name field: focused with its text selected; Enter or leaving it saves, Esc cancels. */
function ChatNameField({ initial, onSave, onCancel, className }: { initial: string; onSave(value: string): void; onCancel(): void; className?: string | undefined }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  /** Set once the field has saved or cancelled, so the blur that follows does nothing. */
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onSave(value);
    else onCancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The field's keys are its own: never a row's, a sheet's or a page shortcut.
    event.stopPropagation();
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };
  return (
    <Input
      ref={input}
      value={value}
      maxLength={CHAT_NAME_MAX}
      aria-label="Chat name"
      aria-description="Enter saves, Escape cancels. Leave it empty to use the automatic name."
      data-testid="chat-name-input"
      className={cn('h-8', className)}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      // A click in the field never reaches the row link it sits in.
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}

/**
 * Rename beside the chat's name in its header; while editing, the field in
 * its place (the header's title is then for screen readers only).
 */
export function ChatHeaderRename({ rename, name }: { rename: ChatRename; name: string }) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <span className="flex min-w-0 items-center gap-1">
      {rename.editing ? (
        rename.field
      ) : (
        <Button
          ref={button}
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`${RENAME_LABEL} ${name}`}
          title={RENAME_LABEL}
          data-testid="chat-rename"
          onClick={() => rename.start(() => button.current)}
        >
          <PencilSimple aria-hidden />
        </Button>
      )}
      {rename.status}
    </span>
  );
}
