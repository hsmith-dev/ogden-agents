import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

/**
 * Workspace-area building blocks (DESIGN.md Layout & Spacing): a header at
 * --header-height holding the surface title, and a body with --panel-padding
 * that holds content up to --content-max.
 */
export function PageHeader({ className, children, ...props }: ComponentProps<'header'>) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border px-(--panel-padding)', className)}
      {...props}
    >
      {children}
    </header>
  );
}

export function PageTitle({ className, ...props }: ComponentProps<'h1'>) {
  return <h1 data-slot="page-title" className={cn('m-0 min-w-0 truncate text-title text-foreground', className)} {...props} />;
}

export function PageBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="page-body" className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
      <div className="mx-auto flex w-full max-w-(--space-content-max) flex-col gap-6 p-(--panel-padding)" {...props} />
    </div>
  );
}

/** A section of a settings-like page: an optional heading, then its fields. */
export function PageSection({ title, className, children, ...props }: ComponentProps<'section'> & { title?: string }) {
  return (
    <section data-slot="page-section" className={cn('flex max-w-(--space-chat-column) flex-col gap-4', className)} {...props}>
      {title === undefined ? null : <h2 className="m-0 text-heading text-foreground">{title}</h2>}
      {children}
    </section>
  );
}

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footnote?: ReactNode;
}

/**
 * An empty surface: display headline, one plain sentence, then its actions.
 * Left-aligned in the workspace area; no illustration, no suggestion chips.
 */
export function EmptyState({ title, description, actions, footnote, className, ...props }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn('flex max-w-(--space-chat-column) flex-col gap-4 pt-(--space-12)', className)} {...props}>
      <h2 className="m-0 text-display text-foreground text-balance">{title}</h2>
      {description === undefined ? null : <p className="m-0 max-w-(--measure) text-body text-muted-foreground">{description}</p>}
      {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {footnote === undefined ? null : <p className="m-0 text-caption text-muted-foreground">{footnote}</p>}
    </div>
  );
}
