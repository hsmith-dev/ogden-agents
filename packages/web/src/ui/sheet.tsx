import { X } from '@phosphor-icons/react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './utils';

export function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export interface SheetContentProps extends ComponentProps<typeof SheetPrimitive.Content> {
  side?: 'left' | 'right';
  /** Accessible title; visually hidden when `hideTitle` is set. */
  title: string;
  hideTitle?: boolean;
}

/**
 * Side sheet. The overlay dims with the foreground hue; no blur on content
 * (DESIGN.md Elevation). Esc closes it (EXPERIENCE.md Interaction Primitives).
 */
export function SheetContent({ className, children, side = 'right', title, hideTitle = false, ...props }: SheetContentProps) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-foreground/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-(--motion-base)"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        aria-describedby={undefined}
        className={cn(
          'fixed inset-y-0 z-50 flex h-full w-(--sidebar-width) max-w-[calc(100%-var(--space-12))] flex-col shadow-float',
          'data-[state=open]:animate-in data-[state=closed]:animate-out duration-(--motion-base) ease-standard',
          side === 'left' && 'left-0 border-r border-border data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
          side === 'right' && 'right-0 border-l border-border data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          'bg-background text-foreground',
          className,
        )}
        {...props}
      >
        <SheetPrimitive.Title className={cn('text-heading', hideTitle && 'sr-only')}>{title}</SheetPrimitive.Title>
        {children}
        <SheetPrimitive.Close
          className="absolute top-2 right-2 inline-flex size-(--control-height) items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-(--icon)"
        >
          <X aria-hidden />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
