import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

export interface BannerProps extends ComponentProps<'div'> {
  /** A text button or two at the end of the line. */
  action?: ReactNode;
  /**
   * `muted` (default): the quiet notice (DESIGN.md read-only-banner).
   * `destructive`: the red banner of a chat that skips its permission checks
   * (permission modes), in the destructive colour, its action buttons in the
   * banner's own foreground.
   */
  variant?: 'muted' | 'destructive';
}

/**
 * A non-blocking notice at the top of the workspace area (DESIGN.md
 * read-only-banner): label type, one sentence, and an action; muted, or red
 * for a chat in Skip all. A sibling of the page body, so it stays in view at
 * any scroll position.
 */
export function Banner({ className, children, action, variant = 'muted', ...props }: BannerProps) {
  return (
    <div
      data-slot="banner"
      data-variant={variant}
      role="status"
      className={cn(
        'mx-(--panel-padding) mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md px-3 py-1 text-label',
        variant === 'destructive'
          ? 'bg-destructive font-semibold text-destructive-foreground [&_button]:text-destructive-foreground [&_button]:underline'
          : 'bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}
