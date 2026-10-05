import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * A row of section tabs, such as a project's Chats, Plan, Board and Runs in
 * the workspace header (story 10.6): links at control height with md radius
 * and label type, muted until hovered, the current one on a secondary fill.
 * `label` names the navigation landmark.
 */
export function TabNav({ label, className, children, ...props }: ComponentProps<'nav'> & { label: string }) {
  return (
    <nav aria-label={label} data-slot="tab-nav" className={cn('shrink-0', className)} {...props}>
      <ul className="m-0 flex list-none items-center gap-1 p-0">{children}</ul>
    </nav>
  );
}

export interface TabNavItemProps extends ComponentProps<'a'> {
  /** Whether this tab is the page shown: marked `aria-current="page"`. */
  current: boolean;
  /** Render the child element (a router link) with the tab's styling. */
  asChild?: boolean;
}

/** One tab, in its own list item. */
export function TabNavItem({ current, asChild = false, className, ...props }: TabNavItemProps) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <li>
      <Comp
        data-slot="tab-nav-item"
        aria-current={current ? 'page' : undefined}
        className={cn(
          'inline-flex h-(--control-height) items-center whitespace-nowrap rounded-md px-2 text-label no-underline',
          'transition-colors duration-(--motion-fast) ease-standard',
          current ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          className,
        )}
        {...props}
      />
    </li>
  );
}
