import { GitBranch } from '@phosphor-icons/react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

/** Small count or tag. `signal` is only for "your turn" counts (Needs you). */
export const badgeVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-caption tabular-nums',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        outline: 'border border-border text-muted-foreground',
        signal: 'bg-signal text-signal-foreground font-medium',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * A branch name as a tag (27.3: a worktree chat's `ogden/chat/<ses>` in its
 * header): outlined, mono, the branch glyph, the name truncating. `asChild`
 * puts it on the single child (a link), whose own children are the name.
 */
export function BranchBadge({ className, asChild = false, children, ...props }: ComponentProps<'span'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp data-slot="branch-badge" className={cn(badgeVariants({ variant: 'outline' }), 'max-w-48 min-w-0 shrink justify-start font-mono text-mono-compact', className)} {...props}>
      {asChild ? children : <BranchBadgeName>{children}</BranchBadgeName>}
    </Comp>
  );
}

/** The inside of a {@link BranchBadge} put on a link: the glyph and the truncating name. */
export function BranchBadgeName({ children }: { children: ReactNode }) {
  return (
    <>
      <GitBranch aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
}
