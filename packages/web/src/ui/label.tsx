import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

const LABEL = 'text-label text-foreground select-none peer-disabled:opacity-50';

/** A visible form label, above its field (Accessibility Floor). */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(LABEL, className)}
      {...props}
    />
  );
}

/**
 * The visible name of a group control (a toggle group, say), which a
 * `<label for>` can't name: the control points at it with aria-labelledby.
 */
export function GroupLabel({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="group-label" className={cn(LABEL, className)} {...props} />;
}
