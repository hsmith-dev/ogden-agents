import { Link } from '@tanstack/react-router';
import { SidebarAttentionButton, SidebarAttentionGroup, SidebarLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/ui/sidebar';
import { StateGlyph } from '@/ui/state-glyph';

/** One thing waiting on the user, in the session it waits in: a permission request (questions, reviews and blocked runs arrive with epics 4 and 5). */
export interface NeedsYouItem {
  id: string;
  wsId: string;
  sesId: string;
  workspaceName: string;
  /** The chat it waits in, by its name (backlog story 12). */
  chatName?: string;
  text: string;
}

const TITLE = 'Needs you';

/**
 * Pinned at the top of the sidebar; hidden entirely when empty, with no
 * "All caught up" filler (DESIGN.md Needs you group). Each row names its
 * workspace and its chat and opens the session it waits in. In the rail it is a counted
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
                <Link to="/w/$wsId/s/$sesId" params={{ wsId: item.wsId, sesId: item.sesId }}>
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
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarAttentionGroup>
    </>
  );
}
