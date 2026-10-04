import { X } from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

/**
 * A modal dialog for a short task (Add project's folder browser): the same
 * surface as AlertDialog, wider, with a close button. Esc closes it and focus
 * returns to what opened it (EXPERIENCE.md Interaction Primitives).
 */
export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export interface DialogContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  title: ReactNode;
  /** One plain sentence under the title. */
  description?: ReactNode;
}

export function DialogContent({ className, title, description, children, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-foreground/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-(--motion-base)"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-var(--space-8))] w-[calc(100%-var(--space-8))] max-w-(--space-chat-column) -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
          'rounded-lg border border-border bg-background p-(--panel-padding) text-foreground shadow-float',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-(--motion-base) ease-standard',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="m-0 pr-(--control-height) text-heading">{title}</DialogPrimitive.Title>
        {description === undefined ? null : <DialogPrimitive.Description className="m-0 text-body text-muted-foreground">{description}</DialogPrimitive.Description>}
        {children}
        <DialogPrimitive.Close className="absolute top-2 right-2 inline-flex size-(--control-height) items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-(--icon)">
          <X aria-hidden />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}
