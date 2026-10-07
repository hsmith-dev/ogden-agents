import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

/** A single choice among a few options, each with a one-line description (the caution level). */
export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('flex flex-col gap-1', className)} {...props} />;
}

export interface RadioGroupOptionProps extends Omit<ComponentProps<typeof RadioGroupPrimitive.Item>, 'children'> {
  label: ReactNode;
  description?: ReactNode;
}

/**
 * One option: an ink-ringed dot, then its label and caption. The whole row
 * is the hit area, --control-height tall at least (EXPERIENCE.md
 * Accessibility Floor); the dot fills with ink when checked.
 */
export function RadioGroupOption({ id, label, description, className, ...props }: RadioGroupOptionProps) {
  const labelId = id === undefined ? undefined : `${id}-label`;
  const descriptionId = id === undefined || description === undefined ? undefined : `${id}-description`;
  return (
    <div data-slot="radio-group-option" className={cn('flex min-h-(--control-height) items-start gap-3 rounded-md px-2 py-2 hover:bg-accent', className)}>
      <RadioGroupPrimitive.Item
        id={id}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        className={cn(
          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background',
          'transition-colors duration-(--motion-fast) ease-standard data-[state=checked]:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-primary" />
      </RadioGroupPrimitive.Item>
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
