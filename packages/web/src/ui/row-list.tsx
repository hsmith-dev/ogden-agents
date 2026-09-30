import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * A plain list of rows in the workspace area (the Chats list, the folder
 * browser): each row at --row-height with md radius and label type, accent on
 * hover, like a sidebar status row (DESIGN.md Status row).
 */
export function RowList({ className, ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="row-list" className={cn('m-0 flex list-none flex-col gap-0.5 p-0', className)} {...props} />;
}

/** A bordered, scrolling box around a RowList (the folder browser's folders). */
export function RowListFrame({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="row-list-frame" className={cn('max-h-72 min-h-32 overflow-y-auto rounded-md border border-border bg-card p-1', className)} {...props} />;
}

export interface RowProps extends ComponentProps<'button'> {
  /** Render the child element (a link, say) with the row's styling. */
  asChild?: boolean;
}

/** One row: a button, or with `asChild` a link. Its icon is muted; its text truncates. */
export function Row({ asChild = false, className, ...props }: RowProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="row"
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(
        'flex h-(--row-height) w-full min-w-0 items-center gap-3 rounded-md px-2 text-left text-label text-foreground',
        'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent',
        '[&>svg]:size-(--icon) [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** Secondary text at a row's end, such as when a chat started. */
export function RowMeta({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="row-meta" className={cn('shrink-0 text-caption text-muted-foreground', className)} {...props} />;
}
