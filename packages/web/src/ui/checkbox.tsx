import { Check } from '@phosphor-icons/react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

export interface CheckboxOptionProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'children'> {
  id: string;
  label: string;
  description?: ReactNode;
}

/**
 * One of several independent choices (the BMad Method features of new
 * projects): an ink-bordered box, then its label and caption, laid out like
 * a radio option. The whole row is the hit area, --control-height tall at
 * least (EXPERIENCE.md Accessibility Floor); the box fills with ink when
 * checked.
 */
export function CheckboxOption({ id, label, description, className, ...props }: CheckboxOptionProps) {
  const labelId = `${id}-label`;
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  return (
    <div data-slot="checkbox-option" className={cn('flex min-h-(--control-height) items-start gap-3 rounded-md px-2 py-2 hover:bg-accent', className)}>
      <CheckboxPrimitive.Root
        id={id}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={cn(
          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background',
          'transition-colors duration-(--motion-fast) ease-standard data-[state=checked]:border-primary data-[state=checked]:bg-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex text-primary-foreground">
          <Check aria-hidden weight="bold" className="size-3" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span id={labelId} className="text-label text-foreground">
          {label}
        </span>
        {description === undefined ? null : (
          <span id={descriptionId} className="text-caption text-muted-foreground">
            {description}
          </span>
        )}
      </label>
    </div>
  );
}
