import { Fragment, type ComponentProps } from 'react';
import { Kbd } from './kbd';
import { cn } from './utils';

export interface ShortcutTableRow {
  /** Presses in turn (outer), keys held together in each (inner). */
  keys: readonly (readonly string[])[];
  action: string;
  where?: string | undefined;
}

export interface ShortcutTableGroup {
  label: string;
  shortcuts: readonly ShortcutTableRow[];
}

/** One shortcut's keys as Kbd hints: "g then c", "Ctrl+." (DESIGN.md Kbd hint). */
export function ShortcutKeys({ keys, className, ...props }: ComponentProps<'span'> & { keys: ShortcutTableRow['keys'] }) {
  return (
    <span data-slot="shortcut-keys" className={cn('inline-flex flex-wrap items-center gap-1 text-caption text-muted-foreground', className)} {...props}>
      {keys.map((press, index) => (
        <Fragment key={index}>
          {index === 0 ? null : <span>then</span>}
          {press.map((key, k) => (
            <Fragment key={key}>
              {k === 0 ? null : <span aria-hidden>+</span>}
              <Kbd>{key}</Kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The keyboard shortcuts as a table per group (Help's Keyboard shortcuts):
 * the keys, what they do, and where they work, in label and caption type.
 */
export function ShortcutTable({ groups, className, ...props }: ComponentProps<'div'> & { groups: readonly ShortcutTableGroup[] }) {
  return (
    <div data-slot="shortcut-table" className={cn('flex min-h-0 flex-col gap-4 overflow-y-auto', className)} {...props}>
      {groups.map((group) => (
        <table key={group.label} className="w-full border-collapse text-left">
          <caption className="pb-1 text-left text-label text-muted-foreground">{group.label}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Keys</th>
              <th scope="col">Does</th>
            </tr>
          </thead>
          <tbody>
            {group.shortcuts.map((shortcut) => (
              <tr key={shortcut.action} className="border-t border-border">
                <td className="w-2/5 py-1.5 pr-2 align-top">
                  <ShortcutKeys keys={shortcut.keys} />
                </td>
                <td className="py-1.5 align-top">
                  <span className="block text-label text-foreground">{shortcut.action}</span>
                  {shortcut.where === undefined ? null : <span className="block text-caption text-muted-foreground">{shortcut.where}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
