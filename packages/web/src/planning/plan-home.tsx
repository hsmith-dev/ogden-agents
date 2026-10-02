import {
  groupCatalogSkills,
  isNewlyInstalled,
  MAX_IDEA_LENGTH,
  PLAN_ACTIONS_LABEL,
  PLAN_EMPTY_TITLE,
  PLAN_IDEA_ACTION,
  PLAN_IDEA_LABEL,
  PLAN_IDEA_PLACEHOLDER,
  PLAN_IDEA_START_LABEL,
  PLAN_IDEA_UNAVAILABLE_TEXT,
  PLAN_LOADING_TEXT,
  PLAN_NEW_TAG,
  PLAN_START_FAILED,
  PLAN_START_LABEL,
  PlanningIdea,
  type CatalogSkill,
  type Session,
} from '@ogden-agents/shared';
import { Play } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Input } from '@/ui/input';
import { EmptyState } from '@/ui/page';
import { Row, RowList } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { startPlanningSession, useCatalog } from './planning-api';

/**
 * The Plan home (story 4.6; EXPERIENCE.md Plan home): "Start from an idea"
 * with a one-line prompt as the one primary action, then the catalog's
 * skills in the UX groups, each with its plain text and one sentence, the
 * skill name in mono only in Developer mode, and a "New" tag on a recently
 * installed module. Every start creates a planning session (story 4.1's
 * request) and hands it to `onStarted`, which opens it; one start at a
 * time, and a failed start says why and frees the buttons.
 *
 * The web names no skill (AD-12): the idea's skill is the catalog's
 * `entryAction`. With none, the idea shows disabled with one sentence
 * (never hidden, AD-14).
 */
export function PlanHome({ wsId, onStarted, now }: { wsId: string; onStarted: (session: Session) => void | Promise<void>; now?: Date }) {
  const catalog = useCatalog(wsId);
  const { appearance } = useAppearance();
  /** What is starting: `idea`, or a skill's name. */
  const [starting, setStarting] = useState<string | undefined>(undefined);
  const [ideaError, setIdeaError] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | undefined>(undefined);

  const start = (what: string, skill: string, idea: string | undefined, fail: (message: string) => void) => {
    if (starting !== undefined) return;
    setStarting(what);
    setIdeaError(undefined);
    setStartError(undefined);
    // A failed start or a failed hand-off (navigation) both say why and free the buttons.
    startPlanningSession(wsId, skill, idea)
      .then((session) => onStarted(session))
      .catch((failure: unknown) => {
        setStarting(undefined);
        fail(failure instanceof Error && failure.message !== '' ? failure.message : `${PLAN_START_FAILED}. Try again.`);
      });
  };

  if (catalog.error !== null) {
    return (
      <Text variant="caption" role="alert" data-testid="plan-error">
        {catalog.error.message}
      </Text>
    );
  }
  if (catalog.data === undefined) {
    return (
      <div className="flex flex-col gap-2" data-testid="plan-loading">
        <Skeleton />
        <Skeleton />
        <span role="status" className="sr-only">
          {PLAN_LOADING_TEXT}
        </span>
      </div>
    );
  }
  if (catalog.data.skills.length === 0) return <EmptyState title={PLAN_EMPTY_TITLE} data-testid="plan-empty" />;

  const entryAction = catalog.data.entryAction;
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-8">
      <PlanIdea
        busy={starting !== undefined}
        unavailable={entryAction === null}
        error={ideaError}
        onInvalid={setIdeaError}
        onSubmit={(idea) => {
          if (entryAction !== null) start('idea', entryAction, idea, setIdeaError);
        }}
      />
      <section aria-label={PLAN_ACTIONS_LABEL} className="flex flex-col gap-6" data-testid="plan-actions">
        {startError === undefined ? null : (
          <Text variant="caption" role="alert" data-testid="plan-start-error">
            {startError}
          </Text>
        )}
        {groupCatalogSkills(catalog.data.skills).map((group) => (
          <section key={group.key} aria-labelledby={`plan-group-${group.key}`} className="flex flex-col gap-2" data-testid="plan-group" data-group={group.key}>
            <h2 id={`plan-group-${group.key}`} className="m-0 text-heading text-foreground">
              {group.label}
            </h2>
            <RowList aria-label={group.label} data-testid="skill-list">
              {group.skills.map((skill) => (
                <SkillRow
                  key={skill.name}
                  skill={skill}
                  developerMode={appearance.developerMode}
                  isNew={isNewlyInstalled(skill.installedAt, now)}
                  busy={starting !== undefined}
                  onStart={() => start(skill.name, skill.name, undefined, setStartError)}
                />
              ))}
            </RowList>
          </section>
        ))}
      </section>
    </div>
  );
}

/**
 * A skill's text and its one sentence (AD-12): its plain label with its
 * description as the sentence; without a label, its description alone (or,
 * with no description either, its name) and no sentence.
 */
export function skillText(skill: Pick<CatalogSkill, 'name' | 'description' | 'label'>): { text: string; sentence: string | undefined } {
  if (skill.label !== null) return { text: skill.label, sentence: skill.description === '' ? undefined : skill.description };
  return { text: skill.description === '' ? skill.name : skill.description, sentence: undefined };
}

function SkillRow({ skill, developerMode, isNew, busy, onStart }: { skill: CatalogSkill; developerMode: boolean; isNew: boolean; busy: boolean; onStart(): void }) {
  const { text, sentence } = skillText(skill);
  return (
    <li>
      {/* The row grows with its text: the label and its sentence wrap, never cut off. */}
      <Row asChild className="h-auto min-h-(--row-height) py-1.5">
        <div data-testid="skill-row" data-skill={skill.name}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="min-w-0 break-words font-medium" data-testid="skill-text">
                {text}
              </span>
              {developerMode ? (
                <Text as="span" variant="mono-compact" className="break-all" data-testid="skill-name">
                  {skill.name}
                </Text>
              ) : null}
              {isNew ? (
                <Badge variant="outline" data-testid="skill-new">
                  {PLAN_NEW_TAG}
                </Badge>
              ) : null}
            </span>
            <span className="min-w-0 break-words text-caption text-muted-foreground" data-testid="skill-sentence">
              {sentence}
            </span>
          </span>
          <Button size="sm" variant="outline" aria-disabled={busy} aria-label={`${PLAN_START_LABEL} ${text}`} onClick={onStart} data-testid="skill-start">
            <Play aria-hidden />
            {PLAN_START_LABEL}
          </Button>
        </div>
      </Row>
    </li>
  );
}

/** "Start from an idea": a heading, the labelled one-line prompt, Start (Enter submits), and its error or why it is off below it. */
function PlanIdea({
  busy,
  unavailable,
  error,
  onInvalid,
  onSubmit,
}: {
  busy: boolean;
  unavailable: boolean;
  error: string | undefined;
  onInvalid(message: string): void;
  onSubmit(idea: string): void;
}) {
  const [idea, setIdea] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || unavailable) return;
    const parsed = PlanningIdea.safeParse(idea);
    if (!parsed.success) {
      onInvalid(parsed.error.issues[0]?.message ?? PLAN_START_FAILED);
      return;
    }
    onSubmit(parsed.data);
  };
  const below = unavailable ? 'plan-idea-unavailable' : error === undefined ? undefined : 'plan-idea-error';
  return (
    <section aria-labelledby="plan-idea-heading" className="flex flex-col gap-3" data-testid="plan-idea">
      <h2 id="plan-idea-heading" className="m-0 text-heading text-foreground">
        {PLAN_IDEA_ACTION}
      </h2>
      <form onSubmit={submit} noValidate>
        <Field id="plan-idea-input" label={PLAN_IDEA_LABEL}>
          <div className="flex items-center gap-2">
            <Input
              id="plan-idea-input"
              value={idea}
              maxLength={MAX_IDEA_LENGTH}
              placeholder={PLAN_IDEA_PLACEHOLDER}
              autoComplete="off"
              disabled={unavailable}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={below}
              onChange={(event) => setIdea(event.target.value)}
              data-testid="plan-idea-input"
            />
            <Button type="submit" aria-disabled={busy || unavailable} aria-describedby={unavailable ? 'plan-idea-unavailable' : undefined} data-testid="plan-idea-start">
              {PLAN_IDEA_START_LABEL}
            </Button>
          </div>
          {unavailable ? (
            <Text variant="caption" id="plan-idea-unavailable" data-testid="plan-idea-unavailable">
              {PLAN_IDEA_UNAVAILABLE_TEXT}
            </Text>
          ) : error === undefined ? null : (
            <Text variant="caption" role="alert" id="plan-idea-error" data-testid="plan-idea-error">
              {error}
            </Text>
          )}
        </Field>
      </form>
    </section>
  );
}
