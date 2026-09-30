import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

export interface BannerProps extends ComponentProps<'div'> {
  /** A text button or two at the end of the line. */
  action?: ReactNode;
}

/**
 * A quiet, non-blocking notice at the top of the workspace area (DESIGN.md
 * read-only-banner): muted surface, label type, one sentence, and an action.
 */
export function Banner({ className, children, action, ...props }: BannerProps) {
  return (
    <div
      data-slot="banner"
      role="status"
      className={cn(
        'mx-(--panel-padding) mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-1 text-label text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}
