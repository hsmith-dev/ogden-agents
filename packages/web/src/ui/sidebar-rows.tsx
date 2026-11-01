import type { SessionState } from '@ogden-agents/shared';
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { SidebarMenuButton, type SidebarMenuButtonProps } from './sidebar';
import { STATE_WORDS, StateGlyph } from './state-glyph';
import { cn } from './utils';

/*
 * The sidebar's content rows (DESIGN.md Status row and needs-you-row): a
 * chat's one-line status row with its agent's mark, and a Needs you row.
 * Built on the sidebar frame's SidebarMenuButton.
 */

export interface SidebarStatusRowProps extends Omit<SidebarMenuButtonProps, 'asChild' | 'tooltip' | 'tooltipAlways' | 'title' | 'children'> {
  state: SessionState;
  title: string;
  /** The agent's plain name: its mark ends the row, the name is in the tooltip. */
  agent: string;
  /** The last activity in words ("5 min ago"), for the tooltip and accessible name only. */
  activity: string;
  /** In place of the agent's name in the tooltip: the agent and its model ("<agent> on <model>", story 11). */
  detail?: string | undefined;
  /** The link the row is (a router Link with no children); the row fills it. */
  children: ReactElement<{ children?: ReactNode }>;
}

/**
 * An agent's two-letter mark from its plain name (DESIGN.md forbids vendor
 * logos), so any agent, a custom one too, has one with no descriptor field:
 * the initials of its first two words ("Code helper" CH), else its first
 * letter upper and its second lower ("Helper" He); empty for no name.
 */
export function agentMark(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  const [first, second] = words.map((word) => [...word]);
  if (first === undefined) return '';
  if (second !== undefined) return `${first[0]}${second[0]}`.toLocaleUpperCase();
  return `${first[0]!.toLocaleUpperCase()}${(first[1] ?? '').toLocaleLowerCase()}`;
}

/**
 * An agent's monochrome mark (DESIGN.md Status row): {@link agentMark}'s two
 * letters in caption medium, centred in a box of the compact icon's height
 * (and at least its width) with a hairline border, in muted-foreground. Decorative: the name is said elsewhere. The
 * letter is generated content, not text, so the row's visible text stays
 * the start of its accessible name (WCAG 2.5.3, Label in Name).
 */
export function AgentMark({ agent, className, ...props }: ComponentProps<'span'> & { agent: string }) {
  return (
    <span
      data-slot="agent-mark"
      data-letter={agentMark(agent)}
      aria-hidden
      className={cn(
        'inline-flex h-(--icon-size-compact) min-w-(--icon-size-compact) shrink-0 items-center px-0.5 justify-center rounded-sm border border-current text-caption leading-none font-medium text-muted-foreground',
        'before:content-[attr(data-letter)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A session row (DESIGN.md Status row, one line from epic 26): glyph, the
 * chat name truncated at one line, and the agent's mark at the end. The
 * state word, agent and last activity are the accessible name and the
 * tooltip ("Chat, Working, <agent>, 5 min ago"). `waiting` adds the
 * signal rail on the left. In the rail only the glyph shows.
 */
export function SidebarStatusRow({ state, title, agent, activity, detail, className, children, ...props }: SidebarStatusRowProps) {
  const name = `${title}, ${STATE_WORDS[state]}, ${detail ?? agent}, ${activity}`;
  return (
    <SidebarMenuButton
      asChild
      tooltip={name}
      tooltipAlways
      // Not `data-state`: the tooltip trigger sets that one.
      data-session-state={state}
      aria-label={name}
      className={cn(state === 'waiting' && 'border-l-(length:--rail-row) border-l-signal', className)}
      {...props}
    >
      {cloneElement(
        children,
        undefined,
        <>
          <StateGlyph state={state} labelMode="none" />
          <span className="min-w-0 flex-1 truncate text-left md:max-lg:sr-only">
            <bdi>{title}</bdi>
          </span>
          <AgentMark agent={agent} className="md:max-lg:hidden" />
        </>,
      )}
    </SidebarMenuButton>
  );
}

export interface SidebarNeedsRowProps extends Omit<SidebarMenuButtonProps, 'asChild' | 'tooltip' | 'tooltipAlways' | 'title' | 'children'> {
  /** The kind glyph (a Phosphor icon), drawn at the compact icon size in foreground. */
  icon: ReactElement;
  /** Its name, for tests and styling (`permission`, `question`, `review`, `blocked`). */
  glyph: string;
  /** Line one: what is needed, clamped to two visual lines and cut only at its end. */
  what: ReactNode;
  /** Line two: where (the project and chat), one truncated caption line. */
  where: ReactNode;
  /** The row last opened: it keeps the signal rail. */
  lastOpened?: boolean;
  /** The link the row is (a router Link with no children); the row fills it. */
  children: ReactElement<{ children?: ReactNode }>;
}

/**
 * A Needs you row (DESIGN.md needs-you-row, epic 26): the kind glyph, then
 * the what in label foreground and the where in caption muted-foreground,
 * two spacing units of vertical padding; the row last opened keeps the signal rail.
 */
export function SidebarNeedsRow({ icon, glyph, what, where, lastOpened = false, className, children, ...props }: SidebarNeedsRowProps) {
  return (
    <SidebarMenuButton
      asChild
      data-last-opened={lastOpened || undefined}
      className={cn('h-auto min-h-(--row-height) items-start border-l-(length:--rail-row) py-2', lastOpened ? 'border-l-signal' : 'border-l-transparent', className)}
      {...props}
    >
      {cloneElement(
        children,
        undefined,
        <>
          <span data-slot="needs-you-glyph" data-glyph={glyph} aria-hidden className="mt-0.5 flex shrink-0 self-start text-foreground [&>svg]:size-(--icon-size-compact)">
            {icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span data-testid="needs-you-what" className="line-clamp-2 break-words text-label text-foreground">
              {what}
            </span>
            <span data-testid="needs-you-where" className="truncate text-caption text-muted-foreground">
              {where}
            </span>
          </span>
        </>,
      )}
    </SidebarMenuButton>
  );
}
