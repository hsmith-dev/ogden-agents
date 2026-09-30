import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * A multi-line text field without its own frame, for use inside a framed
 * control such as the composer. It grows with its content (`field-sizing`),
 * from two lines up to twelve (DESIGN.md Composer).
 */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content min-h-[2lh] max-h-[12lh] w-full resize-none bg-transparent text-body text-foreground',
        'rounded-sm placeholder:text-muted-foreground disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
}
