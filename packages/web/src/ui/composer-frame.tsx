import type { ComponentProps } from 'react';
import { cn } from './utils';

/** The composer's frame (DESIGN.md Composer): `{colors.card}` with a hairline `{colors.input}` border and `{rounded.lg}`. */
export function ComposerFrame({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="composer"
      className={cn('flex flex-col gap-2 rounded-lg border border-input bg-card p-3', className)}
      {...props}
    />
  );
}
