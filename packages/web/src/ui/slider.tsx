import { Slider as SliderPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * A single-value slider (the notification volume): a thin muted track with an
 * ink fill, like Progress, and a square thumb sized like the switch's. The
 * root is --control-height tall, so the hit area meets the target floor
 * (EXPERIENCE.md Accessibility Floor); arrow keys, Page Up/Down, Home and End
 * move it (Radix); focus shows the global ring on the thumb.
 */
export function Slider({ className, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex h-(--control-height) w-full touch-none select-none items-center', 'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="block size-4 rounded-sm border border-primary bg-background transition-colors duration-(--motion-fast) ease-standard"
      />
    </SliderPrimitive.Root>
  );
}
