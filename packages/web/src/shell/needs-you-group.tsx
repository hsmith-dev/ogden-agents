import { SidebarAttentionButton, SidebarAttentionGroup, SidebarLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/ui/sidebar';
import { StateGlyph } from '@/ui/state-glyph';

/** One thing waiting on the user: a permission request, a question, a review, a blocked run. */
export interface NeedsYouItem {
  id: string;
  workspaceName: string;
  text: string;
}

const TITLE = 'Needs you';

/**
 * Pinned at the top of the sidebar; hidden entirely when empty, with no
 * "All caught up" filler (DESIGN.md Needs you group). In the rail it is a
 * counted button. Items arrive with epics 3 to 5; until then the list is empty.
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
              <SidebarMenuButton>
                <StateGlyph state="waiting" labelMode="hidden" />
                <SidebarLabel>
                  {item.workspaceName}: {item.text}
                </SidebarLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarAttentionGroup>
    </>
  );
}
