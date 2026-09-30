import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { tokenNumber } from './tokens';
import { cn } from './utils';

export function TooltipProvider({ delayDuration, ...props }: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration ?? tokenNumber('--motion-slow')} {...props} />;
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** A floating label: popover surface, caption type, floating shadow. */
export function TooltipContent({ className, sideOffset, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset ?? tokenNumber('--space-2')}
        className={cn(
          'z-50 max-w-64 rounded-md border border-border bg-popover px-2 py-1 text-caption text-popover-foreground shadow-float',
          'animate-in fade-in-0 duration-(--motion-fast) data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
