import type { ComponentProps } from 'react';
import { cn } from './utils';

/** A placeholder shaped like the row it stands in for (EXPERIENCE.md Loading surface). Static: nothing moves. Hidden from screen readers, so pair it with a visually hidden `role="status"` line. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('h-(--row-height) w-full rounded-md bg-muted', className)} {...props} />;
}
