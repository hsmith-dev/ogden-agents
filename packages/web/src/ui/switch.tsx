import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * On/off switch: ink track when on, input-colored when off. The whole
 * control is the hit area, --control-height square at least, which meets the
 * target floor in both densities (EXPERIENCE.md Accessibility Floor). Track
 * and thumb are sized from the spacing scale (space-6 by space-10, thumb
 * space-4 inset by space-1) with the md and sm radii; full rounding is
 * reserved for glyphs.
 */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group inline-flex h-(--control-height) min-w-(--control-height) shrink-0 items-center justify-center rounded-md',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex h-6 w-10 items-center rounded-md p-1',
          'transition-colors duration-(--motion-fast) ease-standard',
          'bg-input group-data-[state=checked]:bg-primary',
        )}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            'pointer-events-none block size-4 rounded-sm bg-background',
            'transition-transform duration-(--motion-fast) ease-standard',
            'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  );
}
