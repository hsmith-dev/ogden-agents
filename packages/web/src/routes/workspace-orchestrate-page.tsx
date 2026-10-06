import { ORCHESTRATION_OFF_MESSAGE, PLAN_OPEN_SETTINGS_LABEL, type OrchestrationRunView } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { approveOrchestrationStep, dispatchOrchestrationStep, startOrchestrationRun, useOrchestrationRuns, useOrchestrationSettings } from '@/orchestrate/orchestrate-api';
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
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // The newest run from the list; an answer to a start or step shows at once, before the list catches up.
  const [fresh, setFresh] = useState<OrchestrationRunView | undefined>(undefined);
  const run = runs.data?.[0] ?? fresh;

  const act = (work: () => Promise<OrchestrationRunView>) => {
    setBusy(true);
    setError(undefined);
    work().then(
      async (view) => {
        setFresh(view);
        await queryClient.invalidateQueries({ queryKey: ['orchestration-runs', wsId] });
        setBusy(false);
      },
      async (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
        await queryClient.invalidateQueries({ queryKey: ['orchestration-runs', wsId] });
        setBusy(false);
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
      run={run}
      busy={busy}
      error={error ?? (runs.error instanceof Error ? runs.error.message : undefined)}
      onStart={(goal) => act(() => startOrchestrationRun(wsId, goal))}
      onApprove={(stepId) =>
        run === undefined
          ? undefined
          : act(async () => {
              // Approve and send in one press; a send that fails leaves the step approved, with Send to try again.
              await approveOrchestrationStep(wsId, run.run.id, stepId);
              return dispatchOrchestrationStep(wsId, run.run.id, stepId);
            })
      }
      onSend={(stepId) => (run === undefined ? undefined : act(() => dispatchOrchestrationStep(wsId, run.run.id, stepId)))}
    />
  );
}
