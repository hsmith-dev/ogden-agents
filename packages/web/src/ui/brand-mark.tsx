import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

export interface WordmarkProps extends ComponentProps<'a'> {
  /** Render the child element (a router link) as the wordmark. */
  asChild?: boolean;
}

/**
 * The product mark and name: an ink square with the initial, then the name
 * in label weight. In the sidebar rail only the square shows; the name stays
 * as the accessible name of the link.
 */
export function Wordmark({ asChild = false, className, children, ...props }: WordmarkProps) {
  const Comp = asChild ? Slot.Root : 'a';
  return (
    <Comp
      data-slot="wordmark"
      className={cn('flex min-w-0 items-center gap-2 rounded-md text-label font-semibold text-foreground no-underline', className)}
      {...props}
    >
      <span aria-hidden className="grid size-(--control-height) shrink-0 place-items-center rounded-md bg-primary text-label text-primary-foreground">
        O
      </span>
      <Slot.Slottable>{children}</Slot.Slottable>
      <span aria-hidden className="truncate md:max-lg:sr-only">
        Ogden Agents
      </span>
    </Comp>
  );
}
