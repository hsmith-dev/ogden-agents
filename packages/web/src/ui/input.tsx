import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * A one-line text field (DESIGN.md: a `{rounded.md}` input with a hairline
 * `{colors.input}` border on `{colors.card}`). Pair it with a visible label
 * above it (Accessibility Floor), such as `Field`.
 */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        'h-(--control-height) w-full min-w-0 rounded-md border border-input bg-card px-3 text-body text-foreground',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
