import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { buttonVariants } from './button';
import { cn } from './utils';

/**
 * A one-step confirmation (EXPERIENCE.md: destructive actions confirm once,
 * with the consequence in one sentence). Focus starts on Cancel; Esc cancels.
 */
export function AlertDialog(props: ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

export function AlertDialogTrigger(props: ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

export interface AlertDialogContentProps extends Omit<ComponentProps<typeof AlertDialogPrimitive.Content>, 'title'> {
  title: ReactNode;
  /** The consequence, in one sentence. */
  description: ReactNode;
  /** Shown below the description when the action failed. */
  error?: ReactNode;
}

export function AlertDialogContent({ className, title, description, error, children, ...props }: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50 bg-foreground/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-(--motion-base)"
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-var(--space-8))] max-w-(--measure) -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
          'rounded-lg border border-border bg-background p-(--panel-padding) text-foreground shadow-float',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-(--motion-base) ease-standard',
          className,
        )}
        {...props}
      >
        <AlertDialogPrimitive.Title className="m-0 text-heading">{title}</AlertDialogPrimitive.Title>
        <AlertDialogPrimitive.Description className="m-0 text-body text-muted-foreground">{description}</AlertDialogPrimitive.Description>
        {error === undefined || error === null ? null : (
          <p role="alert" className="m-0 text-label text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">{children}</div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogCancel({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />;
}

/**
 * The confirming button. A plain button, not Radix's Action, so the dialog
 * stays open while the action runs and can show its error.
 */
export function AlertDialogConfirm({ className, type, ...props }: ComponentProps<'button'>) {
  return <button type={type ?? 'button'} className={cn(buttonVariants({ variant: 'destructive' }), className)} {...props} />;
}
