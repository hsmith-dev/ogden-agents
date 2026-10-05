import { Check } from '@phosphor-icons/react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { tokenNumber } from './tokens';
import { cn } from './utils';

export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

/** Floating menu: popover surface, lg radius, the one floating shadow. */
export function DropdownMenuContent({ className, sideOffset, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset ?? tokenNumber('--space-1')}
        className={cn(
          'z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-(--motion-fast)',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuGroup(props: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'relative flex h-(--row-height) cursor-default select-none items-center gap-2 rounded-md px-2 text-label outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** An item that shows whether it is the current choice (a check mark), such as the current workspace. */
export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        'relative flex h-(--row-height) cursor-default select-none items-center gap-2 rounded-md pr-2 pl-8 text-label outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 inline-flex items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

/** Sentence-case group label in label weight, never an uppercase eyebrow. */
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" className={cn('px-2 py-1.5 text-label text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 border-t border-border', className)} {...props} />;
}

/**
 * A choice in a menu with a line of description under its label (such as a
 * chat's permission mode): checked when it is the current one, and when
 * disabled its description says why, in one sentence.
 */
export function DropdownMenuChoiceItem({
  className,
  label,
  description,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>, 'children'> & { label: string; description: string }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-choice-item"
      className={cn(
        'group relative flex min-h-(--row-height) cursor-default select-none flex-col items-start gap-0.5 rounded-md py-1.5 pr-2 pl-8 outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none',
        '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <span className="absolute top-2 left-2 inline-flex items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="text-label group-data-[disabled]:opacity-50">{label}</span>
      <span className="max-w-72 text-caption text-muted-foreground">{description}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}
