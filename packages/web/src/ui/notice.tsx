import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { StateGlyph } from './state-glyph';
import { cn } from './utils';

/**
 * An inline notice in the surface where something needs the user
 * (DESIGN.md Blocked notice and Reduced-mode notice): one plain sentence and
 * an action. `blocked` sits on the error-subtle panel with the error glyph
 * (red on the glyph only); `info` is the quiet muted panel. Never a toast.
 */
export const noticeVariants = cva('flex flex-wrap items-center justify-between gap-3 rounded-lg p-(--panel-padding) text-label text-foreground', {
  variants: {
    variant: {
      blocked: 'bg-state-error-subtle',
      info: 'border border-border bg-muted',
    },
  },
  defaultVariants: { variant: 'info' },
});

export interface NoticeProps extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof noticeVariants> {
  /** A button or two at the end. */
  action?: ReactNode;
  /** The accessible word for the blocked glyph. Default "Error". */
  glyphLabel?: string;
}

export function Notice({ className, variant, action, glyphLabel = 'Error', children, ...props }: NoticeProps) {
  return (
    <div data-slot="notice" data-variant={variant ?? 'info'} className={cn(noticeVariants({ variant }), className)} {...props}>
      <span className="flex min-w-0 items-center gap-2">
        {variant === 'blocked' ? <StateGlyph state="error" label={glyphLabel} labelMode="hidden" /> : null}
        <span className="min-w-0">{children}</span>
      </span>
      {action}
    </div>
  );
}
