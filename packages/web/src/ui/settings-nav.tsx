import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

/*
 * The settings nav (DESIGN.md settings-nav, EXPERIENCE.md Navigation rules):
 * a column of --settings-nav-width on the background left of every settings
 * page, group rows like status rows (label type, an --icon glyph, selected
 * card fill with a hairline border), the current group's other pages as indented sub-links.
 * Below md the column is gone and a select at the top of the page stands in.
 */

/** Lays the nav and the page side by side at md and up; below md only the page column shows. */
export function SettingsFrame({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-frame" className={cn('flex min-h-0 min-w-0 flex-1', className)} {...props} />;
}

/** The nav column: a header-height row reading its title, then the group list. Hidden below md. */
export function SettingsNavColumn({ label, title, className, children, ...props }: ComponentProps<'nav'> & { label: string; title: ReactNode }) {
  return (
    <nav
      aria-label={label}
      data-slot="settings-nav"
      className={cn('hidden w-(--settings-nav-width) shrink-0 flex-col border-r border-border bg-background md:flex', className)}
      {...props}
    >
      <div className="flex h-(--header-height) shrink-0 items-center border-b border-border px-(--panel-padding) text-heading text-foreground">{title}</div>
      <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1 overflow-y-auto p-2">{children}</ul>
    </nav>
  );
}

/** One group: its row, then (when it is current and has more pages) its sub-links. */
export function SettingsNavGroup({ subItems, className, children, ...props }: ComponentProps<'li'> & { subItems?: ReactNode }) {
  return (
    <li data-slot="settings-nav-group" className={cn('flex min-w-0 flex-col gap-1', className)} {...props}>
      {children}
      {subItems === undefined ? null : <ul className="m-0 flex list-none flex-col gap-1 p-0">{subItems}</ul>}
    </li>
  );
}

export interface SettingsNavItemProps extends ComponentProps<'a'> {
  /** The page shown: marked `aria-current="page"` and filled. */
  current: boolean;
  /** Only the group's style: shown as selected without being the page (a sub-page is open). */
  selected?: boolean;
  /** Render the child (a router link) with the row's styling. */
  asChild?: boolean;
}

const ROW = cn(
  'flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 text-label no-underline',
  'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent',
  '[&>svg]:size-(--icon) [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
);

/** A group row at row height: glyph and label, selected on the card fill. */
export function SettingsNavItem({ current, selected = current, asChild = false, className, ...props }: SettingsNavItemProps) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <Comp
      data-slot="settings-nav-item"
      data-selected={selected || undefined}
      aria-current={current ? 'page' : undefined}
      className={cn(ROW, 'h-(--row-height) text-foreground', selected && 'border-border bg-card', className)}
      {...props}
    />
  );
}

/** A page of the current group, indented under its row at control height. */
export function SettingsNavSubItem({ current, asChild = false, className, ...props }: Omit<SettingsNavItemProps, 'selected'>) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <li>
      <Comp
        data-slot="settings-nav-sub-item"
        aria-current={current ? 'page' : undefined}
        className={cn(ROW, 'h-(--control-height) ps-8', current ? 'border-border bg-card text-foreground' : 'text-muted-foreground hover:text-foreground', className)}
        {...props}
      />
    </li>
  );
}

/** The page column right of the nav: the page's header first, then whatever comes before the page (the phone select), then its body. */
export function SettingsContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-content" className={cn('flex min-h-0 min-w-0 flex-1 flex-col *:data-[slot=page-header]:order-first', className)} {...props} />;
}

/** The phone form of the nav (below md): a labelled native select under the page header. */
export function SettingsSelectRow({ id, label, className, children, ...props }: ComponentProps<'select'> & { id: string; label: string }) {
  return (
    <div data-slot="settings-select-row" className="flex shrink-0 flex-col gap-1 border-b border-border px-(--panel-padding) py-2 md:hidden">
      <label htmlFor={id} className="text-label text-foreground">
        {label}
      </label>
      <select
        id={id}
        className={cn('h-(--control-height) w-full min-w-0 rounded-md border border-input bg-card px-2 text-body text-foreground', className)}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
