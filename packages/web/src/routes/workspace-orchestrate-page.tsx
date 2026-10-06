import { ORCHESTRATION_OFF_MESSAGE, PLAN_OPEN_SETTINGS_LABEL, type OrchestrationRunView } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  approveOrchestrationStep,
  dispatchOrchestrationStep,
  editOrchestrationStep,
  reorderOrchestrationSteps,
  skipOrchestrationStep,
  startOrchestrationRun,
  stopOrchestrationRun,
  useOrchestrationRuns,
  useOrchestrationSettings,
} from '@/orchestrate/orchestrate-api';
import { useOrchestrationActivity } from '@/orchestrate/mode-api';
import { OrchestrateView } from '@/orchestrate/orchestrate-view';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageBody } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * `/w/:wsId/orchestrate`: the Orchestrate page (epic 15, 15.3). With the
 * Orchestration piece off in the project, the off notice and a link to its
 * settings and nothing is asked of the server; with it on, the goal box and
 * the latest run. Core's guard is the real check; this only hides what is off.
 */
export function WorkspaceOrchestratePage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  return (
    <>
      <WorkspaceHeader title="Orchestrate" wsId={wsId} tab="orchestrate" />
      <PageBody data-testid="workspace-orchestrate-page">
        <OrchestrateGate wsId={wsId} />
      </PageBody>
    </>
  );
}

function OrchestrateGate({ wsId }: { wsId: string }) {
  const settings = useWorkspaceSettings(wsId);
  if (settings.isError) {
    return (
      <Text variant="caption" role="alert" data-testid="orchestrate-settings-error">
        {settings.error.message}
      </Text>
    );
  }
  if (settings.data === undefined) {
    return (
      <div className="flex flex-col gap-2" data-testid="orchestrate-loading">
        <Skeleton />
        <span role="status" className="sr-only">
          Loading this project
        </span>
      </div>
    );
  }
  if (settings.data.orchestrationEnabled !== true) {
    return (
      <Notice
        className="max-w-(--space-chat-column)"
        data-testid="orchestrate-feature-off"
        action={
          <Button variant="outline" asChild>
            <Link to="/w/$wsId/settings" params={{ wsId }} data-testid="orchestrate-open-settings">
              {PLAN_OPEN_SETTINGS_LABEL}
            </Link>
          </Button>
        }
      >
        {ORCHESTRATION_OFF_MESSAGE}
      </Notice>
    );
  }
  return <OrchestrateOn wsId={wsId} />;
}

/** The page once the piece is on: loads the settings and runs, and starts, approves and sends. */
function OrchestrateOn({ wsId }: { wsId: string }) {
  const settings = useOrchestrationSettings(wsId);
  const runs = useOrchestrationRuns(wsId);
  const activity = useOrchestrationActivity(wsId);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // The newest run from the list; an answer to a start or step shows at once, before the list catches up.
  const [fresh, setFresh] = useState<OrchestrationRunView | undefined>(undefined);
  // The newer of the list's latest run and the answer to the last action, so a start never shows (or stops) the previous run.
  const listed = runs.data?.[0];
  const run = listed === undefined ? fresh : fresh === undefined || fresh.run.id === listed.run.id || fresh.run.createdAt <= listed.run.createdAt ? listed : fresh;

  const [stopping, setStopping] = useState(false);

  /** Runs one request and shows what came back or why it was refused; resolves true when it was kept. */
  const act = (work: () => Promise<OrchestrationRunView>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    return work().then(
      async (view) => {
        setFresh(view);
        await queryClient.invalidateQueries({ queryKey: ['orchestration-runs', wsId] });
        setBusy(false);
        return true;
      },
      async (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
        await queryClient.invalidateQueries({ queryKey: ['orchestration-runs', wsId] });
        setBusy(false);
        return false;
      },
    );
  };
  /** Stop never waits for another request: the manager may still be thinking when the user presses it. */
  const stop = (runId: string) => {
    setStopping(true);
    setError(undefined);
    stopOrchestrationRun(wsId, runId).then(
      async (view) => {
        setFresh(view);
        await queryClient.invalidateQueries({ queryKey: ['orchestration-runs', wsId] });
        setStopping(false);
      },
      async (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
        await queryClient.invalidateQueries({ queryKey: ['orchestration-runs', wsId] });
        setStopping(false);
      },
    );
  };

  if (settings.isError) {
    return (
      <Text variant="caption" role="alert" data-testid="orchestrate-load-error">
        {settings.error.message}
      </Text>
    );
  }
  if (settings.data === undefined) return null;
  return (
    <OrchestrateView
      wsId={wsId}
      managerReady={settings.data.managerReady === true}
      managerMessage={settings.data.manager?.message}
      run={run}
      busy={busy}
      error={error ?? (runs.error instanceof Error ? runs.error.message : undefined)}
      stopping={stopping}
      mode={settings.data.mode}
      activity={activity.data}
      activityError={activity.error instanceof Error ? activity.error.message : undefined}
      onStart={(goal) => void act(() => startOrchestrationRun(wsId, goal))}
      onStop={() => (run === undefined ? undefined : stop(run.run.id))}
      onEdit={(stepId, instruction) => (run === undefined ? Promise.resolve(false) : act(() => editOrchestrationStep(wsId, run.run.id, stepId, instruction)))}
      onSkip={(stepId) => (run === undefined ? undefined : void act(() => skipOrchestrationStep(wsId, run.run.id, stepId)))}
      onReorder={(order) => (run === undefined ? undefined : void act(() => reorderOrchestrationSteps(wsId, run.run.id, order)))}
      onApprove={(stepId) =>
        run === undefined
          ? undefined
          : void act(async () => {
              // Approve and send in one press; a send that fails leaves the step approved, with Send to try again.
              await approveOrchestrationStep(wsId, run.run.id, stepId, run.steps.find((one) => one.stepId === stepId)?.instruction);
              return dispatchOrchestrationStep(wsId, run.run.id, stepId);
            })
      }
      onSend={(stepId) => (run === undefined ? undefined : void act(() => dispatchOrchestrationStep(wsId, run.run.id, stepId)))}
    />
  );
}
