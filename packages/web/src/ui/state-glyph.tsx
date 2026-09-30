import type { SessionState } from '@ogden-agents/shared';
import type { ComponentProps } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from './utils';

/** The state word shown beside every glyph (AD-4; state is never color-only). */
export const STATE_WORDS: Record<SessionState, string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  idle: 'Idle',
  done: 'Done',
  error: 'Error',
};

const STATE_COLOR: Record<SessionState, string> = {
  working: 'text-state-working',
  waiting: 'text-state-waiting',
  idle: 'text-state-idle',
  done: 'text-state-done',
  error: 'text-state-error',
};

/**
 * One shape per state, so it survives color blindness and grayscale
 * (DESIGN.md Status glyph): working a filled circle that breathes, waiting a
 * filled circle with a signal ring, idle a hollow circle, done a check mark,
 * error a filled diamond. Drawn in a 10-unit box at `--glyph-size`.
 */
function Shape({ state }: { state: SessionState }) {
  switch (state) {
    case 'working':
      return <circle cx="5" cy="5" r="4" fill="currentColor" />;
    case 'waiting':
      return (
        <>
          <circle cx="5" cy="5" r="4" fill="none" stroke="var(--signal)" style={{ strokeWidth: 'var(--glyph-ring)' }} />
          <circle cx="5" cy="5" r="2" fill="currentColor" />
        </>
      );
    case 'idle':
      return <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" />;
    case 'done':
      return <path d="M1.5 5.25 4 7.75 8.75 2.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />;
    case 'error':
      return <path d="M5 0.75 9.25 5 5 9.25 0.75 5Z" fill="currentColor" />;
  }
}

export interface StateGlyphProps extends Omit<ComponentProps<'span'>, 'children'> {
  state: SessionState;
  /** The word shown beside the glyph; defaults to the state word. */
  label?: string;
  /**
   * `visible`: glyph then word. `rail`: the word is visually hidden only in the
   * collapsed rail (md to lg), where it becomes the accessible name and a
   * tooltip. `hidden`: the word is the accessible name only.
   */
  labelMode?: 'visible' | 'rail' | 'hidden';
}

export function StateGlyph({ state, label = STATE_WORDS[state], labelMode = 'visible', className, ...props }: StateGlyphProps) {
  const glyph = (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn('size-(--glyph-size) shrink-0 overflow-visible', STATE_COLOR[state], state === 'working' && 'animate-breathe')}
    >
      <Shape state={state} />
    </svg>
  );
  const word = (
    <span className={cn('truncate', labelMode === 'hidden' && 'sr-only', labelMode === 'rail' && 'md:max-lg:sr-only')}>{label}</span>
  );
  const body = (
    <span
      data-slot="state-glyph"
      data-state={state}
      // In the rail the word is hidden, so the glyph takes keyboard focus and its tooltip shows on focus too.
      tabIndex={labelMode === 'rail' ? 0 : undefined}
      className={cn('inline-flex min-w-0 items-center gap-2 rounded-sm text-label', className)}
      {...props}
    >
      {glyph}
      {word}
    </span>
  );
  if (labelMode === 'visible') return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="right" className={cn(labelMode === 'rail' && 'hidden md:max-lg:block')}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
