import { MagnifyingGlass } from '@phosphor-icons/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { Kbd } from './kbd';
import { cn } from './utils';

/*
 * The command palette's surface (DESIGN.md command-palette; EXPERIENCE.md
 * Command palette): the standard floating layer, DESIGN.md's width (160
 * spacing steps) and 20% from the top, a 12-step field with a magnifying
 * glass over a grouped listbox of rows at
 * row height, the selected one on the accent fill, matched letters in 600.
 * Presentational only: what it lists and does is `palette/command-palette`'s.
 */

export interface CommandPaletteProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's accessible name. */
  title: string;
}

/** The modal layer: an overlay and the panel, portalled; Esc and a click outside close it. */
export function CommandPalette({ open, onOpenChange, title, className, children, ...props }: CommandPaletteProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-slot="command-palette-overlay" className="fixed inset-0 z-50 bg-foreground/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-(--motion-fast)" />
        <DialogPrimitive.Content
          data-slot="command-palette"
          aria-describedby={undefined}
          className={cn(
            'fixed top-[20%] left-1/2 z-50 flex max-h-[60%] w-[calc(100%-var(--space-8))] max-w-160 -translate-x-1/2 flex-col overflow-hidden',
            'rounded-lg border border-border bg-popover text-popover-foreground shadow-float',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-(--motion-fast) ease-standard',
            className,
          )}
          {...props}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface CommandPaletteFieldProps extends Omit<ComponentProps<'input'>, 'role' | 'prefix'> {
  /** A mode's chip before the field ("New chat in..."). */
  prefix?: ReactNode;
}

/** The one field: a combobox over the listbox (`aria-controls`, `aria-activedescendant` from the caller). */
export function CommandPaletteField({ prefix, className, ...props }: CommandPaletteFieldProps) {
  return (
    <div data-slot="command-palette-field" className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 text-muted-foreground [&>svg]:size-(--icon) [&>svg]:shrink-0">
      <MagnifyingGlass aria-hidden />
      {prefix === undefined || prefix === null ? null : (
        <span data-slot="command-palette-prefix" className="shrink-0 rounded-sm bg-muted px-1.5 text-caption text-foreground">
          {prefix}
        </span>
      )}
      <input
        role="combobox"
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className={cn('h-full min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground', className)}
        {...props}
      />
    </div>
  );
}

/** The results: a listbox with its own scroll. */
export function CommandPaletteList({ className, ...props }: ComponentProps<'div'>) {
  return <div role="listbox" data-slot="command-palette-list" className={cn('min-h-0 flex-1 overflow-y-auto p-2', className)} {...props} />;
}

/** One group of options under its sentence-case caption heading. */
export function CommandPaletteGroup({ heading, headingId, children, className, ...props }: ComponentProps<'div'> & { heading: string; headingId: string }) {
  return (
    <div role="group" aria-labelledby={headingId} data-slot="command-palette-group" className={cn('flex flex-col', className)} {...props}>
      <div role="presentation" id={headingId} className="px-3 pt-2 pb-1 text-caption text-muted-foreground">
        {heading}
      </div>
      {children}
    </div>
  );
}

/** The text with the matched letters in 600 (not coloured). */
export function CommandPaletteMatch({ text, indices }: { text: string; indices: readonly number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  const parts: { text: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const on = marked.has(i);
    const last = parts.at(-1);
    if (last !== undefined && last.on === on) last.text += text[i];
    else parts.push({ text: text[i]!, on });
  }
  return (
    <>
      {parts.map((part, index) =>
        part.on ? (
          <span key={index} data-slot="command-palette-matched" className="font-semibold">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

export interface CommandPaletteOptionProps extends Omit<ComponentProps<'div'>, 'role'> {
  selected: boolean;
  /** The leading glyph (a state glyph, or an icon). */
  glyph: ReactNode;
  /** The name, with its matched letters. */
  label: ReactNode;
  /** Where it is ("Letterpress"), in caption. */
  context?: ReactNode;
  /** The shortcut's keys, shown at the end (Developer mode only). */
  keys?: readonly string[] | undefined;
}

/** One row at row height; it never takes focus (the field keeps it), so a press runs it without moving the cursor. */
export function CommandPaletteOption({ selected, glyph, label, context, keys, className, onMouseDown, ...props }: CommandPaletteOptionProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-slot="command-palette-option"
      data-selected={selected ? '' : undefined}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown?.(event);
      }}
      className={cn(
        'flex h-(--row-height) min-w-0 shrink-0 cursor-default items-center gap-2 rounded-md px-3 text-label text-foreground',
        selected && 'bg-accent text-accent-foreground',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="inline-flex size-(--icon) shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-(--icon)">
        {glyph}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {context === undefined ? null : <span className="min-w-0 shrink truncate text-caption text-muted-foreground">{context}</span>}
      {keys === undefined || keys.length === 0 ? null : (
        <span data-slot="command-palette-keys" aria-hidden className="ml-auto flex shrink-0 items-center gap-1">
          {keys.map((key, index) => (
            <Kbd key={index}>{key}</Kbd>
          ))}
        </span>
      )}
    </div>
  );
}

/** What shows when nothing matches. */
export function CommandPaletteEmpty({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="command-palette-empty" className={cn('m-0 px-3 py-6 text-center text-body text-muted-foreground', className)} {...props} />;
}

/** The result count, announced politely and not shown. */
export function CommandPaletteStatus(props: ComponentProps<'div'>) {
  return <div role="status" aria-live="polite" aria-atomic className="sr-only" {...props} />;
}
