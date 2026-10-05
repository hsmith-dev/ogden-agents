import type { SessionState } from '@ogden-agents/shared';
import { Bell, CaretRight, FolderSimple, GearSix, List } from '@phosphor-icons/react';
import { Slot } from 'radix-ui';
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { ScrollArea } from './scroll-area';
import { Sheet, SheetContent } from './sheet';
import { STATE_WORDS, StateGlyph } from './state-glyph';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from './utils';

/*
 * The status sidebar frame (EXPERIENCE.md Responsive & Platform), in three
 * forms chosen by CSS alone, so there is no layout flash:
 *   lg and up    full sidebar at --sidebar-width
 *   md to lg     a rail at --sidebar-rail: labels become accessible names and tooltips
 *   below md     hidden; the header's SidebarTrigger opens the same content in a sheet
 * Everything that differs between full and rail uses the `md:max-lg:` variant.
 */

interface SidebarContextValue {
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  /** The sidebar column; while it is displayed (md and up) the sheet has no place. */
  columnRef: RefObject<HTMLElement | null>;
  /** The header's menu button that opens the sheet: focus goes back to it when the sheet is dismissed. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Set when the sheet closes because the user went somewhere: the new page decides focus then. */
  navigatingRef: RefObject<boolean>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (context === null) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return context;
}

export interface SidebarProviderProps extends ComponentProps<'div'> {
  /** The sheet closes whenever this value changes, such as the current path on navigation. */
  closeSheetOn?: unknown;
}

/** Holds the sheet state and lays the sidebar and the workspace area side by side. */
export function SidebarProvider({ closeSheetOn, className, children, ...props }: SidebarProviderProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const columnRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const navigatingRef = useRef(false);

  useEffect(() => {
    navigatingRef.current = true;
    setSheetOpen(false);
  }, [closeSheetOn]);

  // The sheet exists only below md: close it once the window is wide enough
  // for the column to show. The column's own CSS decides, so no breakpoint is repeated here.
  useEffect(() => {
    const onResize = () => {
      if ((columnRef.current?.getClientRects().length ?? 0) > 0) setSheetOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const value = useMemo(() => ({ sheetOpen, setSheetOpen, columnRef, triggerRef, navigatingRef }), [sheetOpen]);
  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        className={cn('flex h-dvh w-full overflow-hidden bg-background text-foreground', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export interface SidebarProps extends ComponentProps<'aside'> {
  /** Accessible name of the sidebar landmark and of its sheet. */
  label: string;
}

/** The sidebar column (md and up) plus its sheet form (below md), with the same content. */
export function Sidebar({ label, className, children, ...props }: SidebarProps) {
  const { sheetOpen, setSheetOpen, columnRef, triggerRef, navigatingRef } = useSidebar();
  return (
    <>
      <aside
        ref={columnRef}
        data-slot="sidebar"
        aria-label={label}
        className={cn(
          'hidden h-full shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex',
          'md:w-(--sidebar-rail) lg:w-(--sidebar-width)',
          className,
        )}
        {...props}
      >
        {children}
      </aside>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="left"
          title={label}
          hideTitle
          data-slot="sidebar-sheet"
          className="bg-sidebar text-sidebar-foreground md:hidden"
          // Focus the sheet itself, so opening it doesn't pop a row's tooltip
          // and the first Esc closes it.
          onOpenAutoFocus={(event) => {
            navigatingRef.current = false;
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          // Esc in a filter with text clears the text (SidebarFilter) and leaves the drawer open.
          onEscapeKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement && target.value !== '' && target.closest('[data-slot="sidebar-filter"]') !== null) event.preventDefault();
          }}
          // The menu button is not the dialog's own trigger, so give focus back to it by hand when
          // the sheet is dismissed (Esc, the close button, the overlay). After a link, the new page decides.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!navigatingRef.current) triggerRef.current?.focus();
            navigatingRef.current = false;
          }}
        >
          <nav
            aria-label={label}
            className="flex h-full min-h-0 flex-col"
            // Following any link from the sheet closes it, even to the page already shown. Only a link
            // that changes this tab's page hands focus to the new page; one to the page already shown,
            // or opened elsewhere (a modifier key), gives it back to the menu button. Decided in the
            // capture phase, before the router moves the location.
            onClickCapture={(event) => {
              const link = (event.target as Element).closest('a[href]');
              if (link === null) return;
              const elsewhere = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
              navigatingRef.current = !elsewhere && (link as HTMLAnchorElement).href !== window.location.href;
            }}
            // Closed in the bubble phase, after the link's own handler: closing in the capture phase
            // unmounts the sheet before the router's Link sees the click, and the browser then loads
            // the whole page again.
            onClick={(event) => {
              if ((event.target as Element).closest('a[href]') !== null) setSheetOpen(false);
            }}
          >
            {children}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Opens the sidebar as a drawer (a sheet); shown only below md, in every page header. */
export function SidebarTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  const { sheetOpen, setSheetOpen, triggerRef } = useSidebar();
  return (
    <Button
      ref={triggerRef}
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-label="Open projects and sessions"
      aria-haspopup="dialog"
      aria-expanded={sheetOpen}
      className={cn('md:hidden', className)}
      onClick={() => setSheetOpen(!sheetOpen)}
      {...props}
    >
      <List aria-hidden />
    </Button>
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn('flex h-(--header-height) shrink-0 items-center gap-2 px-3 md:max-lg:justify-center md:max-lg:px-2', className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, children, ...props }: ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea data-slot="sidebar-content" className={cn('flex-1', className)} {...props}>
      <div className="flex flex-col gap-4 px-2 py-2">{children}</div>
    </ScrollArea>
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('flex shrink-0 flex-col gap-1 border-t border-border p-2', className)} {...props} />;
}

export function SidebarGroup({ className, ...props }: ComponentProps<'section'>) {
  return <section data-slot="sidebar-group" className={cn('flex min-w-0 flex-col gap-1', className)} {...props} />;
}

/** Sentence case in label weight and muted-foreground; visually hidden in the rail. */
export function SidebarGroupLabel({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      data-slot="sidebar-group-label"
      className={cn('m-0 flex items-center gap-2 px-2 py-1 text-label text-muted-foreground md:max-lg:sr-only', className)}
      {...props}
    />
  );
}

/** A line of text that belongs to the full sidebar only (hidden in the rail). */
export function SidebarText({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="sidebar-text" className={cn('m-0 px-2 py-1 text-caption text-muted-foreground md:max-lg:hidden', className)} {...props} />;
}

export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('m-0 flex list-none flex-col gap-0.5 p-0', className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative min-w-0', className)} {...props} />;
}

/** The text of a menu button: truncates at one line, becomes an accessible name in the rail. */
export function SidebarLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="sidebar-label" className={cn('min-w-0 flex-1 truncate text-left md:max-lg:sr-only', className)} {...props} />;
}

export interface SidebarMenuButtonProps extends ComponentProps<'button'> {
  asChild?: boolean;
  /** Selected row: card fill with a hairline border (DESIGN.md Status row). */
  isActive?: boolean;
  /** A tooltip; shown only in the rail unless `tooltipAlways`. */
  tooltip?: ReactNode;
  tooltipAlways?: boolean;
}

/**
 * A sidebar row (DESIGN.md Status row): --row-height, md radius, label type,
 * accent on hover. Closes the sheet when used inside it.
 */
export function SidebarMenuButton({
  asChild = false,
  isActive = false,
  tooltip,
  tooltipAlways = false,
  className,
  onClick,
  ...props
}: SidebarMenuButtonProps) {
  const { setSheetOpen } = useSidebar();
  const Comp = asChild ? Slot.Root : 'button';
  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive || undefined}
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(
        'flex h-(--row-height) w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 text-label text-sidebar-foreground',
        'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        'data-[active=true]:border-border data-[active=true]:bg-card',
        'md:max-lg:justify-center md:max-lg:px-0',
        '[&>svg]:size-(--icon) [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
        className,
      )}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) setSheetOpen(false);
      }}
      {...props}
    />
  );
  if (tooltip === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" className={cn(!tooltipAlways && 'hidden md:max-lg:block')}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The "Needs you" panel (DESIGN.md needs-you-group): signal-subtle fill, lg
 * radius, heading with its count in signal. Shown in the full sidebar and the
 * sheet; in the rail, SidebarAttentionButton takes its place.
 */
export function SidebarAttentionGroup({ title, count, className, children, ...props }: ComponentProps<'section'> & { title: string; count: number }) {
  return (
    <section data-slot="sidebar-attention-group" className={cn('flex min-w-0 flex-col gap-1 rounded-lg bg-signal-subtle p-1 md:max-lg:hidden', className)} {...props}>
      <h2 className="m-0 flex items-center gap-2 px-2 py-1 text-label text-foreground">
        {title}
        <Badge variant="signal">{count}</Badge>
      </h2>
      {children}
    </section>
  );
}

/**
 * The rail form of "Needs you" (EXPERIENCE.md Responsive & Platform, md to
 * lg): a counted button at the top of the rail. Hidden outside the rail.
 */
export function SidebarAttentionButton({ label, count, className, ...props }: ComponentProps<'button'> & { label: string; count: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="sidebar-attention-button"
          aria-label={`${label}, ${count}`}
          className={cn(
            'hidden min-h-(--row-height) w-full flex-col items-center justify-center gap-0.5 rounded-lg py-1 bg-signal-subtle text-foreground md:max-lg:flex',
            'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent',
            '[&>svg]:size-(--icon) [&>svg]:text-signal',
            className,
          )}
          {...props}
        >
          <Bell aria-hidden />
          <Badge variant="signal">{count}</Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="hidden md:max-lg:block">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** The disclosure row of a workspace group or of "Earlier": a chevron that turns, then the label. */
function DisclosureButton({ expanded, className, children, ...props }: ComponentProps<'button'> & { expanded: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className={cn(
        'flex h-(--row-height) w-full min-w-0 items-center gap-2 rounded-md px-2 text-label text-sidebar-foreground',
        'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent',
        className,
      )}
      {...props}
    >
      <CaretRight
        aria-hidden
        className={cn('size-(--icon) shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-(--motion-fast)', expanded && 'rotate-90')}
      />
      {children}
    </button>
  );
}

/** One glyph and count per non-zero state, for a collapsed workspace group (DESIGN.md Workspace group). */
export function SidebarStateSummary({ summary, className, ...props }: ComponentProps<'span'> & { summary: readonly { state: SessionState; count: number }[] }) {
  return (
    <span data-slot="sidebar-state-summary" className={cn('flex shrink-0 items-center gap-2 text-caption text-muted-foreground', className)} {...props}>
      {summary.map(({ state, count }) => (
        <span key={state} data-state={state} className="inline-flex items-center">
          <span className="sr-only">{STATE_WORDS[state]} </span>
          <StateGlyph state={state} label={String(count)} className="text-caption tabular-nums" />
        </span>
      ))}
    </span>
  );
}

export interface SidebarWorkspaceGroupProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The workspace's name: the group's accessible name and the text of its link. */
  name: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Shown beside the name while collapsed. */
  summary: readonly { state: SessionState; count: number }[];
  /** The link that opens the workspace (a router Link with no children); the name fills it. */
  link: ReactElement<{ children?: ReactNode }>;
  /** The link to the workspace's settings (a router Link with no children), shown as a gear after the name. */
  settingsLink?: ReactElement<{ children?: ReactNode }> | undefined;
  /** The user is inside this workspace: its name is marked current. */
  current?: boolean;
  /** A sidebar filter left it out: hidden in the full form and the drawer, still shown in the rail (which has no filter). */
  filteredOut?: boolean;
}

/**
 * A workspace in the sidebar (DESIGN.md Workspace group): a chevron that
 * collapses its chats, its name in label 600 as the link that opens it
 * (marked when current), a gear to its settings, then its session rows.
 * Collapsed, it shows one glyph and count per non-zero state. The rail has
 * no room for the name, so there the link is a folder icon with the name as
 * tooltip, and every group shows its rows' glyphs, collapsed or not.
 */
export function SidebarWorkspaceGroup({ name, collapsed, onCollapsedChange, summary, link, settingsLink, current = false, filteredOut = false, className, children, ...props }: SidebarWorkspaceGroupProps) {
  const listId = useId();
  return (
    <div
      role="group"
      aria-label={name}
      data-slot="sidebar-workspace-group"
      data-collapsed={collapsed || undefined}
      data-current={current || undefined}
      data-filtered-out={filteredOut || undefined}
      className={cn('flex min-w-0 flex-col gap-0.5 md:max-lg:border-t md:max-lg:border-border md:max-lg:pt-1', filteredOut && 'hidden md:max-lg:flex', className)}
      {...props}
    >
      <div data-slot="sidebar-workspace-heading" className="flex min-w-0 items-center gap-0.5">
        <DisclosureButton
          expanded={!collapsed}
          aria-controls={listId}
          aria-label={`Chats in ${name}`}
          data-slot="sidebar-workspace-toggle"
          className="w-(--control-height) shrink-0 justify-center px-0 md:max-lg:hidden"
          onClick={() => onCollapsedChange(!collapsed)}
        />
        <SidebarMenuButton
          asChild
          isActive={current}
          tooltip={name}
          // Inside the project, on any of its pages: `true` (it marks where the user is, not the exact page).
          aria-current={current ? 'true' : undefined}
          data-slot="sidebar-workspace-link"
          className="flex-1 font-semibold"
        >
          {cloneElement(
            link,
            undefined,
            <>
              <FolderSimple aria-hidden className="hidden md:max-lg:block" />
              <SidebarLabel>{name}</SidebarLabel>
            </>,
          )}
        </SidebarMenuButton>
        {collapsed && summary.length > 0 ? <SidebarStateSummary summary={summary} className="md:max-lg:hidden" /> : null}
        {settingsLink === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              {cloneElement(
                settingsLink,
                {
                  'aria-label': `${name} settings`,
                  'data-slot': 'sidebar-workspace-settings',
                  className: cn(
                    'inline-flex size-(--control-height) shrink-0 items-center justify-center rounded-md text-muted-foreground md:max-lg:hidden',
                    'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent hover:text-foreground [&>svg]:size-(--icon)',
                  ),
                } as Partial<{ children?: ReactNode }>,
                <GearSix aria-hidden />,
              )}
            </TooltipTrigger>
            <TooltipContent side="right">{`${name} settings`}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div id={listId} className={cn('flex min-w-0 flex-col gap-0.5', collapsed && 'hidden md:max-lg:flex')}>
        {children}
      </div>
    </div>
  );
}

export interface SidebarFilterProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  /** The field's id (the label's `for`); from useId, since the sidebar can be mounted twice. */
  id: string;
  /** The visible label above the field (Accessibility Floor). */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** What the filter leaves, for screen readers ("2 of 9 projects"); empty while nothing is typed. */
  status?: string;
}

/**
 * A filter field for a sidebar list, with its visible label above it; any
 * children (a "nothing matches" line) go under it. The first Esc clears a
 * non-empty field; with it empty, Esc goes on to close the drawer. The rail
 * has no room for it.
 */
export function SidebarFilter({ id, label, value, onValueChange, status = '', className, children, ...props }: SidebarFilterProps) {
  return (
    <div data-slot="sidebar-filter" className={cn('flex min-w-0 flex-col gap-1 px-2 pb-1 md:max-lg:hidden', className)} {...props}>
      <Label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="search"
        autoComplete="off"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            event.stopPropagation();
            onValueChange('');
          }
        }}
      />
      <span role="status" className="sr-only">
        {status}
      </span>
      {children}
    </div>
  );
}

/** "Earlier": done sessions older than a day, collapsed until opened. Only in the full sidebar and the sheet. */
export function SidebarEarlier({ count, className, children, ...props }: ComponentProps<'div'> & { count: number }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (count === 0) return null;
  return (
    <div data-slot="sidebar-earlier" className={cn('flex min-w-0 flex-col gap-0.5 md:max-lg:hidden', className)} {...props}>
      <DisclosureButton expanded={open} aria-controls={listId} className="text-muted-foreground" onClick={() => setOpen(!open)}>
        <span className="min-w-0 flex-1 truncate text-left">Earlier</span>
        <Badge>{count}</Badge>
      </DisclosureButton>
      <div id={listId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export interface SidebarStatusRowProps extends Omit<SidebarMenuButtonProps, 'asChild' | 'tooltip' | 'tooltipAlways' | 'title' | 'children'> {
  state: SessionState;
  title: string;
  /** Under the title: the agent and the state word ("Claude Code, working"). */
  caption: string;
  /** More for the tooltip only, after the state word (the chat's model, story 11). */
  detail?: string | undefined;
  /** The relative time shown right-aligned ("5m"), and the moment it stands for. */
  time?: { label: string; dateTime: string } | undefined;
  /** The link the row is (a router Link with no children); the row fills it. */
  children: ReactElement<{ children?: ReactNode }>;
}

/**
 * A session row (DESIGN.md Status row): glyph, one-line title, caption in
 * muted-foreground, relative time in tabular caption. `waiting` adds the
 * signal rail on the left. In the rail only the glyph shows; the title and
 * state word are the accessible name and the tooltip.
 */
export function SidebarStatusRow({ state, title, caption, detail, time, className, children, ...props }: SidebarStatusRowProps) {
  const word = STATE_WORDS[state];
  return (
    <SidebarMenuButton
      asChild
      tooltip={detail === undefined ? `${title}: ${word}` : `${title}: ${word}, ${detail}`}
      // Not `data-state`: the tooltip trigger sets that one.
      data-session-state={state}
      aria-label={detail === undefined ? `${title}, ${caption}` : `${title}, ${caption}, ${detail}`}
      className={cn(
        'h-auto min-h-(--row-height) py-1',
        state === 'waiting' && 'border-l-(length:--rail-row) border-l-signal',
        className,
      )}
      {...props}
    >
      {cloneElement(
        children,
        undefined,
        <>
          <StateGlyph state={state} labelMode="none" />
          <span className="flex min-w-0 flex-1 flex-col md:max-lg:sr-only">
            <bdi className="truncate">{title}</bdi>
            <span className="truncate text-caption text-muted-foreground">{caption}</span>
          </span>
          {time === undefined ? null : (
            <time dateTime={time.dateTime} className="shrink-0 self-start text-caption tabular-nums text-muted-foreground md:max-lg:hidden">
              {time.label}
            </time>
          )}
        </>,
      )}
    </SidebarMenuButton>
  );
}

/** The workspace area beside the sidebar. */
export function SidebarInset({ className, ...props }: ComponentProps<'main'>) {
  return <main data-slot="sidebar-inset" className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', className)} {...props} />;
}
