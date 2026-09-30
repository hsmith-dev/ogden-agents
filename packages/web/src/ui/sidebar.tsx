import { Bell, List } from '@phosphor-icons/react';
import { Slot } from 'radix-ui';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Badge } from './badge';
import { Button } from './button';
import { ScrollArea } from './scroll-area';
import { Sheet, SheetContent } from './sheet';
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

  useEffect(() => {
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

  const value = useMemo(() => ({ sheetOpen, setSheetOpen, columnRef }), [sheetOpen]);
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
  const { sheetOpen, setSheetOpen, columnRef } = useSidebar();
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
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <nav
            aria-label={label}
            className="flex h-full min-h-0 flex-col"
            // Following any link from the sheet closes it, even to the page already shown.
            onClickCapture={(event) => {
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

/** Opens the sidebar sheet; shown only below md, in the workspace header. */
export function SidebarTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  const { sheetOpen, setSheetOpen } = useSidebar();
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-label="Open sidebar"
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

/** The workspace area beside the sidebar. */
export function SidebarInset({ className, ...props }: ComponentProps<'main'>) {
  return <main data-slot="sidebar-inset" className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', className)} {...props} />;
}
