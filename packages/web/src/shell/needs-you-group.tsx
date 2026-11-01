import { CheckSquare, ChatCircleDots, Shield, WarningDiamond, type Icon } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { SidebarAttentionButton, SidebarAttentionGroup, SidebarMenu, SidebarMenuItem, SidebarMoreButton } from '@/ui/sidebar';
import { SidebarNeedsRow } from '@/ui/sidebar-rows';
import type { NeedKind } from './sidebar-model';
import { lastNeedsYouOpened, markNeedsYouOpened, needsYouTarget, subscribeNeedsYouOpened } from './needs-you-target';

/** One thing waiting on the user, in the session it waits in: a permission request, a question, a blocked run, or a run ready for review (its review page). */
export interface NeedsYouItem {
  id: string;
  /** What kind of need it is, for its glyph and target (a permission opens its card); entries from sidebar-model.ts carry it. */
  kind?: NeedKind | undefined;
  wsId: string;
  sesId: string;
  /** Set for a terminal pane that seems to be waiting (epic 16): its row opens the project's Terminals, not a chat. */
  paneId?: string | undefined;
  workspaceName: string;
  /** The chat it waits in, by its name (backlog story 12). */
  chatName?: string;
  text: string;
  /** A run ready for review opens this ticket's review page, not its session (story 11.4). */
  reviewRef?: string | undefined;
}

const TITLE = 'Needs you';

/** Rows shown before "Show N more" (EXPERIENCE.md Needs you group). */
export const NEEDS_YOU_VISIBLE = 5;

/** The four glyphs (DESIGN.md Needs you row): permission, question, review, blocked run. */
export type NeedsYouGlyph = 'permission' | 'question' | 'review' | 'blocked';

const GLYPHS: Record<NeedsYouGlyph, Icon> = { permission: Shield, question: ChatCircleDots, review: CheckSquare, blocked: WarningDiamond };

/** A row's glyph: by its kind (a pane's screen prompt is a question), else a review by its target, else a question. */
export function needsYouGlyph(item: Pick<NeedsYouItem, 'kind' | 'reviewRef'>): NeedsYouGlyph {
  const kind = item.kind ?? (item.reviewRef !== undefined ? 'run_review' : 'waiting');
  if (kind === 'permission') return 'permission';
  if (kind === 'run_review') return 'review';
  if (kind === 'run_blocked') return 'blocked';
  return 'question';
}

/** A row's accessible name: both lines, "<what>, in <project>, <chat>". */
export function needsYouLabel(item: Pick<NeedsYouItem, 'text' | 'workspaceName' | 'chatName'>): string {
  return item.chatName === undefined ? `${item.text}, in ${item.workspaceName}` : `${item.text}, in ${item.workspaceName}, ${item.chatName}`;
}

/** A row's where: the project, then the chat. The names are the user's text: isolated, so a right to left name can't reorder the words beside it. */
function Where({ item }: { item: NeedsYouItem }) {
  return (
    <>
      <bdi>{item.workspaceName}</bdi>
      {item.chatName === undefined ? null : (
        <>
          , <bdi>{item.chatName}</bdi>
        </>
      )}
    </>
  );
}

/** One row: its glyph, what, then where, as a link to its target; a click marks it last opened. */
function NeedsYouRow({ item, lastOpened }: { item: NeedsYouItem; lastOpened: boolean }) {
  const glyph = needsYouGlyph(item);
  const Glyph = GLYPHS[glyph];
  return (
    <SidebarNeedsRow
      data-testid="needs-you-item"
      data-kind={item.kind}
      aria-label={needsYouLabel(item)}
      icon={<Glyph />}
      glyph={glyph}
      what={item.text}
      where={<Where item={item} />}
      lastOpened={lastOpened}
      onClick={() => markNeedsYouOpened(item.id)}
    >
      <Link {...needsYouTarget(item)} />
    </SidebarNeedsRow>
  );
}

/** `]` and `[` with focus on a row: the next and previous visible row; nothing moves at the ends. */
function moveBetweenRows(event: KeyboardEvent<HTMLUListElement>) {
  // Not `isShortcutKey`: some layouts type brackets with AltGr or Shift, and the phone drawer is a dialog.
  // Focus must be on a row link, so nothing is being typed.
  if (event.key !== ']' && event.key !== '[') return;
  if (event.defaultPrevented || event.metaKey) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-testid="needs-you-item"]')];
  const index = rows.findIndex((row) => row === document.activeElement);
  if (index === -1) return;
  event.preventDefault();
  rows[event.key === ']' ? index + 1 : index - 1]?.focus();
}

/**
 * Pinned at the top of the sidebar; hidden entirely when empty, with no
 * "All caught up" filler (DESIGN.md Needs you group). Each row says what is
 * needed, then the project and chat, and opens its target: the permission
 * card, the chat, the review page or the project's Terminals. Five rows show,
 * then "Show N more". In the rail it is a counted button that opens the first item.
 */
export function NeedsYouGroup({ items, onOpenFirst }: { items: readonly NeedsYouItem[]; onOpenFirst?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lastOpened = useSyncExternalStore(subscribeNeedsYouOpened, lastNeedsYouOpened, lastNeedsYouOpened);
  if (items.length === 0) return null;
  const hidden = items.length - NEEDS_YOU_VISIBLE;
  const shown = expanded || hidden <= 0 ? items : items.slice(0, NEEDS_YOU_VISIBLE);
  return (
    <>
      <SidebarAttentionButton data-testid="needs-you-rail" label={TITLE} count={items.length} onClick={onOpenFirst} />
      <SidebarAttentionGroup data-testid="needs-you" title={TITLE} count={items.length}>
        <SidebarMenu onKeyDown={moveBetweenRows}>
          {shown.map((item) => (
            <SidebarMenuItem key={item.id}>
              <NeedsYouRow item={item} lastOpened={item.id === lastOpened} />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {hidden > 0 ? (
          <SidebarMoreButton data-testid="needs-you-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show fewer' : `Show ${hidden} more`}
          </SidebarMoreButton>
        ) : null}
      </SidebarAttentionGroup>
    </>
  );
}
