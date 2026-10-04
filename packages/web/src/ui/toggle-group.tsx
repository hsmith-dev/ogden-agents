import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * Segmented control (DESIGN.md driver-toggle): muted track, the active
 * segment on card with a hairline border. Used for single-choice settings.
 */
export function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('inline-flex w-fit max-w-full items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-[calc(var(--control-height)-var(--space-1))] min-w-0 items-center justify-center gap-1.5 rounded-sm border border-transparent px-3',
        'text-label text-muted-foreground whitespace-nowrap transition-colors duration-(--motion-fast) ease-standard',
        'hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        'data-[state=on]:border-border data-[state=on]:bg-card data-[state=on]:text-foreground',
        '[&_svg]:size-(--icon) [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}
