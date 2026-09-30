import { Progress as ProgressPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * A determinate progress bar (a download, say): a thin muted track with an
 * ink fill. With `value` undefined it shows an empty track and reads as
 * indeterminate to screen readers. The fill moves only as progress reports.
 */
export function Progress({ className, value, max = 100, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const ratio = value === null || value === undefined || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full origin-left bg-primary transition-transform duration-(--motion-base) ease-standard"
        style={{ transform: `scaleX(${ratio})` }}
      />
    </ProgressPrimitive.Root>
  );
}
