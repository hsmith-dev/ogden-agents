import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ElementType } from 'react';
import { cn } from './utils';

/** DESIGN.md Typography roles. Feature code sets text through these, never raw sizes. */
export const textVariants = cva('', {
  variants: {
    variant: {
      display: 'text-display text-foreground text-balance',
      title: 'text-title text-foreground',
      heading: 'text-heading text-foreground',
      body: 'text-body text-foreground max-w-(--measure)',
      label: 'text-label text-foreground',
      caption: 'text-caption text-muted-foreground',
      mono: 'font-mono text-mono text-foreground',
      'mono-compact': 'font-mono text-mono-compact text-muted-foreground',
    },
    tone: {
      default: '',
      muted: 'text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'body', tone: 'default' },
});

type TextProps = ComponentProps<'p'> & VariantProps<typeof textVariants> & { as?: ElementType };

export function Text({ as: Comp = 'p', variant, tone, className, ...props }: TextProps) {
  return <Comp data-slot="text" className={cn(textVariants({ variant, tone }), 'm-0', className)} {...props} />;
}
