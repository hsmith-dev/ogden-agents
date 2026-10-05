import { DotsThree, PencilSimple } from '@phosphor-icons/react';
import { chatName, type Session } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useRef, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Row } from '@/ui/row-list';
import { StateGlyph } from '@/ui/state-glyph';
import { RENAME_LABEL, useChatRename } from './chat-name';

/**
 * One chat in the project's Chats list (story 2.5): its state, its name and
 * what `meta` adds, opening the chat. Renamed in place (backlog story 2)
 * with Rename in the row's menu or F2 on the row (a click opens the chat, so
 * a double click can't rename here; it does in the sidebar, which stays).
 */
export function ChatListRow({ wsId, session, meta }: { wsId: string; session: Session; meta?: ReactNode }) {
  const name = chatName(session);
  const rename = useChatRename({ wsId, sesId: session.id, name, title: session.title });
  const link = useRef<HTMLAnchorElement>(null);
  /** Set when Rename was chosen in the menu: the field opens as the menu closes. */
  const renaming = useRef(false);
  return (
    <li className="flex min-w-0 items-center gap-1">
      {rename.editing ? (
        <div className="flex h-(--row-height) min-w-0 flex-1 items-center px-1">{rename.field}</div>
      ) : (
        <Row asChild className="flex-1">
          <Link
            ref={link}
            to="/w/$wsId/s/$sesId"
            params={{ wsId, sesId: session.id }}
            data-testid="chat-row"
            aria-keyshortcuts="F2"
            onKeyDown={(event) => {
              if (event.key !== 'F2') return;
              event.preventDefault();
              rename.start(() => link.current);
            }}
          >
            <StateGlyph state={session.state} labelMode="hidden" data-testid="chat-row-state" />
            <bdi className="min-w-0 flex-1 truncate" data-testid="chat-row-name">
              {name}
            </bdi>
            {meta}
          </Link>
        </Row>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`More for ${name}`} data-testid="chat-row-menu">
            <DotsThree aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // The field opens once the menu has closed and let go of focus, so focus stays in it.
          onCloseAutoFocus={(event) => {
            if (!renaming.current) return;
            renaming.current = false;
            event.preventDefault();
            rename.start(() => link.current);
          }}
        >
          <DropdownMenuItem
            data-testid="chat-row-rename"
            onSelect={() => {
              renaming.current = true;
            }}
          >
            <PencilSimple aria-hidden />
            {RENAME_LABEL}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {rename.status}
    </li>
  );
}
