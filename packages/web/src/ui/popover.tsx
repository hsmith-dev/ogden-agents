import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { tokenNumber } from './tokens';
import { cn } from './utils';

export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverClose(props: ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

/** A small floating panel: popover surface, lg radius, the one floating shadow (the permission record's undo). */
export function PopoverContent({ className, sideOffset, align, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align ?? 'start'}
        sideOffset={sideOffset ?? tokenNumber('--space-1')}
        className={cn(
          'z-50 flex max-w-80 flex-col gap-3 rounded-lg border border-border bg-popover p-3 text-label text-popover-foreground shadow-float',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-(--motion-fast)',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
