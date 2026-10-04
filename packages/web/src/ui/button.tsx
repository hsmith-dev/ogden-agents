import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

/**
 * Button (DESIGN.md button-primary, -secondary, -outline, -destructive).
 * Primary is ink, never colored; one to three words, never wraps.
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-label',
    'transition-[background-color,color,transform] duration-(--motion-fast) ease-standard',
    'active:scale-98 disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:active:scale-100',
    '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground not-aria-disabled:hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground not-aria-disabled:hover:bg-accent',
        outline: 'border border-border bg-transparent text-foreground not-aria-disabled:hover:bg-accent',
        destructive: 'border border-border bg-transparent text-destructive not-aria-disabled:hover:bg-accent',
        ghost: 'bg-transparent text-foreground not-aria-disabled:hover:bg-accent',
        link: 'bg-transparent text-foreground underline-offset-4 not-aria-disabled:hover:underline',
      },
      size: {
        default: 'h-(--control-height) px-3',
        sm: 'h-(--control-height) px-2',
        icon: 'size-(--control-height)',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (a link, say) with the button's styling. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}
