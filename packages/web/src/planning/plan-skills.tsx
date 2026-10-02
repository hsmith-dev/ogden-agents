import { PLAN_EMPTY_TITLE, PLAN_LOADING_TEXT, PLAN_SKILLS_LABEL, PLAN_START_FAILED, PLAN_START_LABEL, type Session } from '@ogden-agents/shared';
import { Play } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/page';
import { Row, RowList } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { startPlanningSession, useCatalog } from './planning-api';

/**
 * The Plan page's body (story 4.1, bare): the project's installed skills,
 * each with Start, which creates a planning session and hands it to
 * `onStarted` (the page opens it). Loading, error and empty states; the
 * catalog's text is the skills' own, never a name this app knows (AD-12).
 */
export function PlanSkills({ wsId, onStarted }: { wsId: string; onStarted: (session: Session) => void | Promise<void> }) {
  const catalog = useCatalog(wsId);
  const [starting, setStarting] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | undefined>(undefined);

  const start = (skill: string) => {
    if (starting !== undefined) return;
    setStarting(skill);
    setStartError(undefined);
    // A failed start or a failed hand-off (navigation) both say why and free the buttons.
    startPlanningSession(wsId, skill)
      .then((session) => onStarted(session))
      .catch((failure: unknown) => {
        setStarting(undefined);
        setStartError(failure instanceof Error ? failure.message : `${PLAN_START_FAILED}. Try again.`);
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
  if (catalog.data.length === 0) return <EmptyState title={PLAN_EMPTY_TITLE} data-testid="plan-empty" />;
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-2">
      {startError === undefined ? null : (
        <Text variant="caption" role="alert" data-testid="plan-start-error">
          {startError}
        </Text>
      )}
      <RowList aria-label={PLAN_SKILLS_LABEL} data-testid="skill-list">
        {catalog.data.map((skill) => (
          <li key={skill.name}>
            <Row asChild>
              <div data-testid="skill-row" data-skill={skill.name}>
                <span className="shrink-0 font-medium">{skill.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={skill.description}>
                  {skill.description}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-disabled={starting !== undefined}
                  aria-label={`${PLAN_START_LABEL} ${skill.name}`}
                  onClick={() => start(skill.name)}
                  data-testid="skill-start"
                >
                  <Play aria-hidden />
                  {PLAN_START_LABEL}
                </Button>
              </div>
            </Row>
          </li>
        ))}
      </RowList>
    </div>
  );
}
