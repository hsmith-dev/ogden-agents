import type { ReactNode } from 'react';
import { GroupLabel, Label } from './label';
import { cn } from './utils';

export interface FieldProps {
  /**
   * For `control="input"`, the control's id (the label's `for`). For
   * `control="group"`, a prefix: the label is `<id>-label` and the
   * description `<id>-description`, for the control's aria-labelledby and
   * aria-describedby.
   */
  id: string;
  /** `input`: a labelable element such as a switch. `group`: a toggle or radio group. */
  control?: 'input' | 'group';
  label: string;
  description?: ReactNode;
  /** `stacked`: label above the control. `inline`: label left, control right (switches). */
  layout?: 'stacked' | 'inline';
  className?: string;
  children: ReactNode;
}

/** A form field with a visible label above it and helper text in caption (Accessibility Floor). */
export function Field({ id, control = 'input', label, description, layout = 'stacked', className, children }: FieldProps) {
  const descriptionId = `${id}-description`;
  const text = (
    <div className="flex min-w-0 flex-col gap-1">
      {control === 'input' ? (
        <Label htmlFor={id} id={`${id}-label`}>
          {label}
        </Label>
      ) : (
        <GroupLabel id={`${id}-label`}>{label}</GroupLabel>
      )}
      {description === undefined ? null : (
        <p id={descriptionId} className="m-0 text-caption text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
  return (
    <div
      data-slot="field"
      className={cn(
        'flex gap-2 rounded-lg border border-border bg-card p-(--panel-padding)',
        layout === 'stacked' ? 'flex-col' : 'flex-row items-center justify-between gap-4',
        className,
      )}
    >
      {text}
      {children}
    </div>
  );
}
