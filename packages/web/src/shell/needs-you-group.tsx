import { Link } from '@tanstack/react-router';
import { SidebarAttentionButton, SidebarAttentionGroup, SidebarLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/ui/sidebar';
import { StateGlyph } from '@/ui/state-glyph';

/** One thing waiting on the user, in the session it waits in: a permission request, a question, a blocked run, or a run ready for review (its review page). */
export interface NeedsYouItem {
  id: string;
  wsId: string;
  sesId: string;
  workspaceName: string;
  /** The chat it waits in, by its name (backlog story 12). */
  chatName?: string;
  text: string;
  /** A run ready for review opens this ticket's review page, not its session (story 11.4). */
  reviewRef?: string | undefined;
}

const TITLE = 'Needs you';

/** A row's words: the project, the chat, then what is needed. */
function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  return (
    <>
      <StateGlyph state="waiting" labelMode="hidden" />
      <SidebarLabel>
        {item.workspaceName}
        {/* The chat's name is the user's text: isolated, so a right to left name can't reorder the request beside it. */}
        {item.chatName === undefined ? null : (
          <>
            , <bdi>{item.chatName}</bdi>
          </>
        )}
        : {item.text}
      </SidebarLabel>
    </>
  );
}

/**
 * Pinned at the top of the sidebar; hidden entirely when empty, with no
 * "All caught up" filler (DESIGN.md Needs you group). Each row names its
 * workspace and its chat and opens the session it waits in, or for a run
 * ready for review its review page. In the rail it is a counted
 * button that opens the first item.
 */
export function NeedsYouGroup({ items, onOpenFirst }: { items: readonly NeedsYouItem[]; onOpenFirst?: () => void }) {
  if (items.length === 0) return null;
  return (
    <>
      <SidebarAttentionButton data-testid="needs-you-rail" label={TITLE} count={items.length} onClick={onOpenFirst} />
      <SidebarAttentionGroup data-testid="needs-you" title={TITLE} count={items.length}>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton asChild data-testid="needs-you-item">
                {item.reviewRef === undefined ? (
                  <Link to="/w/$wsId/s/$sesId" params={{ wsId: item.wsId, sesId: item.sesId }}>
                    <NeedsYouRow item={item} />
                  </Link>
                ) : (
                  <Link to="/w/$wsId/review/$ref" params={{ wsId: item.wsId, ref: item.reviewRef }}>
                    <NeedsYouRow item={item} />
                  </Link>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarAttentionGroup>
    </>
  );
}
