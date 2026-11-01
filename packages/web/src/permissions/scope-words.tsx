import type { AlwaysAllowScope } from '@ogden-agents/shared';
import { Text } from '@/ui/typography';

/*
 * An Always allow scope in words (AD-40; EXPERIENCE.md Permission card and
 * Always allow rules): the exact command, every command starting with a
 * prefix, or a tool. One table for the card, its record line and the rules
 * lists.
 */

/** What a command scope says before its command, capitalised as a label ("Exactly", "Commands starting with"). */
const COMMAND_LEADS = { command_exact: 'Exactly', command_prefix: 'Commands starting with' } as const;

/** A scope as plain text, for an accessible name or a sentence: "Commands starting with npm test", "Editing files". */
export function scopeWords(scope: Pick<AlwaysAllowScope, 'kind' | 'value' | 'label'>): string {
  return scope.kind === 'tool' ? scope.label : `${COMMAND_LEADS[scope.kind]} ${scope.value}`;
}

/** {@link scopeWords} with its first letter lowercased for the middle of a sentence ("commands starting with npm test"); a tool's label stays. */
export function scopeWordsInSentence(scope: Pick<AlwaysAllowScope, 'kind' | 'value' | 'label'>): string {
  const words = scopeWords(scope);
  return scope.kind === 'tool' ? words : words.charAt(0).toLowerCase() + words.slice(1);
}

/** A scope as a label: a command scope's command in mono ("Commands starting with `npm test`"), a tool's label as it is. */
export function ScopeText({ scope }: { scope: Pick<AlwaysAllowScope, 'kind' | 'value' | 'label'> }) {
  if (scope.kind === 'tool') return <>{scope.label}</>;
  return (
    <>
      {COMMAND_LEADS[scope.kind]}{' '}
      <Text as="code" variant="mono" className="break-all">
        {scope.value}
      </Text>
    </>
  );
}
