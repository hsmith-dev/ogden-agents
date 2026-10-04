import type { ComponentProps } from 'react';
import { cn } from './utils';

/** A key in a shortcut hint (DESIGN.md Kbd hint): muted fill, hairline border, sm radius, mono compact. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn('inline-flex items-center rounded-sm border border-border bg-muted px-1 font-mono text-mono-compact text-foreground', className)}
      {...props}
    />
  );
}
