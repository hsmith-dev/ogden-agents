import { ORCHESTRATION_ROUTING_WORDS, ROUTING_LIMITS, type RoutingRule } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { saveRoutingRules, useRoutingRules } from './routing-api';

/**
 * The routing rules in the project's Orchestration settings (epic 15, 15.12): the person's own plain sentences about which kind of work
 * should go to which worker. The manager reads them as wishes and may follow them, and a step that followed one says so on the plan. They
 * are suggestions only: the team, the vendors' terms and the mode are checked by the server whatever a rule says. Nothing is learned.
 */

/** One row of the draft: an existing rule keeps its id; a new one has none. */
export interface RoutingDraftRow {
  id?: string;
  text: string;
  /** A key that stays with the row while it moves, so the field keeps its text and focus. */
  key: string;
}

let keyCounter = 0;
const nextKey = (): string => `row-${(keyCounter += 1)}`;

/** The draft for rules as saved. */
export const draftOf = (rules: readonly RoutingRule[]): RoutingDraftRow[] => rules.map((rule) => ({ id: rule.id, text: rule.text, key: nextKey() }));

/** Whether the draft says something other than the saved rules. */
export const draftChanged = (draft: readonly RoutingDraftRow[], saved: readonly RoutingRule[]): boolean => draft.length !== saved.length || draft.some((row, index) => row.id !== saved[index]?.id || row.text !== saved[index]?.text);

export interface RoutingEditorViewProps {
  rows: readonly RoutingDraftRow[];
  saved: readonly RoutingRule[];
  maxRules: number;
  maxRuleChars: number;
  saving: boolean;
  error: string | undefined;
  /** Shown once after a save. */
  justSaved: boolean;
  onChange: (rows: RoutingDraftRow[]) => void;
  onSave: () => void;
}

/** The editor: a field per rule, add, delete and move, and one Save. Pure; the container holds the state. */
export function RoutingEditorView({ rows, saved, maxRules, maxRuleChars, saving, error, justSaved, onChange, onSave }: RoutingEditorViewProps) {
  const changed = draftChanged(rows, saved);
  const empty = rows.some((row) => row.text.trim() === '');
  const set = (index: number, text: string) => onChange(rows.map((row, at) => (at === index ? { ...row, text } : row)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    onChange(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!saving && changed && !empty) onSave();
  };
  return (
    <Field id="routing-rules" control="group" label="Routing rules" description={ORCHESTRATION_ROUTING_WORDS.intro}>
      <form className="flex flex-col gap-2" onSubmit={submit} data-testid="routing-editor" aria-labelledby="routing-rules-label" aria-describedby="routing-rules-description">
        {rows.length === 0 ? (
          <Text variant="caption" data-testid="routing-none">
            {ORCHESTRATION_ROUTING_WORDS.none}
          </Text>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0" data-testid="routing-rules-list">
            {rows.map((row, index) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2" data-testid="routing-rule" data-rule-id={row.id}>
                <Input
                  className="min-w-48 flex-1"
                  aria-label={`Rule ${index + 1}`}
                  data-testid="routing-rule-text"
                  value={row.text}
                  maxLength={maxRuleChars}
                  placeholder="For example: tests go to the first agent"
                  disabled={saving}
                  onChange={(event) => set(index, event.target.value)}
                />
                <Button variant="outline" size="sm" aria-label={`Move rule ${index + 1} up`} data-testid="routing-rule-up" disabled={saving || index === 0} onClick={() => move(index, -1)}>
                  Up
                </Button>
                <Button variant="outline" size="sm" aria-label={`Move rule ${index + 1} down`} data-testid="routing-rule-down" disabled={saving || index === rows.length - 1} onClick={() => move(index, 1)}>
                  Down
                </Button>
                <Button variant="destructive" size="sm" aria-label={`Delete rule ${index + 1}`} data-testid="routing-rule-delete" disabled={saving} onClick={() => onChange(rows.filter((_, at) => at !== index))}>
                  Delete
                </Button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" data-testid="routing-add" disabled={saving || rows.length >= maxRules} onClick={() => onChange([...rows, { text: '', key: nextKey() }])}>
            Add a rule
          </Button>
          <Button type="submit" data-testid="routing-save" disabled={saving || !changed || empty}>
            Save rules
          </Button>
          <Text variant="caption" data-testid="routing-count">
            {rows.length} of {maxRules} rules, up to {maxRuleChars} characters each
          </Text>
          {justSaved && !changed ? (
            <Text variant="caption" role="status" data-testid="routing-saved">
              Saved
            </Text>
          ) : null}
        </div>
        {empty ? (
          <Text variant="caption" data-testid="routing-empty-note">
            Fill in or delete the empty rule to save.
          </Text>
        ) : null}
        {error === undefined ? null : (
          <Notice variant="blocked" role="alert" data-testid="routing-error">
            {error}
          </Notice>
        )}
      </form>
    </Field>
  );
}

/** The project's rules under Orchestration in its settings. Nothing is saved until the person presses Save rules. */
export function ProjectRoutingRules({ wsId }: { wsId: string }) {
  const query = useRoutingRules(wsId);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RoutingDraftRow[] | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);
  const saved = query.data?.rules;
  // Fill the draft from what is saved, once it loads, and again when the rules change elsewhere while nothing here was edited.
  useEffect(() => {
    if (saved === undefined) return;
    setRows((current) => (current === undefined || !draftChanged(current, saved) ? draftOf(saved) : current));
  }, [saved]);
  if (query.data === undefined || rows === undefined || saved === undefined) {
    return query.error instanceof Error ? (
      <Notice variant="blocked" role="alert" data-testid="routing-load-error">
        {query.error.message}
      </Notice>
    ) : null;
  }
  const onSave = () => {
    setSaving(true);
    setError(undefined);
    saveRoutingRules(
      wsId,
      rows.map((row) => ({ ...(row.id === undefined ? {} : { id: row.id }), text: row.text })),
    ).then(
      async (answer) => {
        queryClient.setQueryData(['routing-rules', wsId], answer);
        setRows(draftOf(answer.rules));
        setSaving(false);
        setJustSaved(true);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(failure instanceof Error ? failure.message : "The routing rules couldn't be saved. Try again.");
      },
    );
  };
  return (
    <RoutingEditorView
      rows={rows}
      saved={saved}
      maxRules={query.data.maxRules ?? ROUTING_LIMITS.maxRules}
      maxRuleChars={query.data.maxRuleChars ?? ROUTING_LIMITS.maxRuleChars}
      saving={saving}
      error={error}
      justSaved={justSaved}
      onChange={(next) => {
        setJustSaved(false);
        setError(undefined);
        setRows(next);
      }}
      onSave={onSave}
    />
  );
}
