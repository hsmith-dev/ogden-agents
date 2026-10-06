import {
  API_ROUTES,
  apiPath,
  OrchestrationRunResponse,
  OrchestrationRunsResponse,
  OrchestrationSettingsResponse,
  WorkspaceSettingsResponse,
  type OrchestrationRunView,
  type OrchestrationSettings,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, postJson } from '@/chat/chat-api';
import { useEventInvalidation } from '@/events/use-event-invalidation';

type Auth = Pick<TabAuth, 'fetch'>;

/** `GET …/orchestration`: the mode, limits and whether a manager is set up. Answers 409 `feature_off` while the piece is off. */
export async function fetchOrchestrationSettings(wsId: string, auth: Auth = tabAuth): Promise<OrchestrationSettings> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestration, { wsId }), {}, "Ogden Agents couldn't load Orchestrate");
  return OrchestrationSettingsResponse.parse(json).settings;
}

/** `GET …/orchestration/runs`: the project's runs, newest first. */
export async function fetchOrchestrationRuns(wsId: string, auth: Auth = tabAuth): Promise<OrchestrationRunView[]> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), {}, "Ogden Agents couldn't load the runs");
  return OrchestrationRunsResponse.parse(json).runs;
}

/** `POST …/orchestration/runs`: the goal goes to the manager and its plan comes back. */
export async function startOrchestrationRun(wsId: string, goal: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), postJson({ goal }), "The manager couldn't make a plan");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/steps/:stepId/approve`: the user approves one instruction. */
export async function approveOrchestrationStep(wsId: string, runId: string, stepId: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStepApprove, { wsId, runId, stepId }), { method: 'POST' }, "The instruction couldn't be approved");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/steps/:stepId/dispatch`: sends an approved instruction into a new worker chat. */
export async function dispatchOrchestrationStep(wsId: string, runId: string, stepId: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId, stepId }), { method: 'POST' }, "The instruction couldn't be sent");
  return OrchestrationRunResponse.parse(json).run;
}

/** `PATCH …/settings`: turns the Orchestration piece on or off for the project. */
export async function updateOrchestrationEnabled(wsId: string, orchestrationEnabled: boolean, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.workspaceSettings, { wsId }),
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orchestrationEnabled }) },
    "Orchestration couldn't be changed",
  );
  return WorkspaceSettingsResponse.parse(json).settings;
}

/** The project's runs, kept current from the event stream (and the worker's state while a step runs). */
export function useOrchestrationRuns(wsId: string) {
  useEventInvalidation((event) => {
    if (event.workspaceId !== wsId) return [];
    // A run's own events, and the worker chat's state changes, which the read-back reports.
    if (event.type.startsWith('orchestration.') || event.type === 'session.state_changed') return [['orchestration-runs', wsId]];
    return [];
  });
  return useQuery({ queryKey: ['orchestration-runs', wsId], queryFn: () => fetchOrchestrationRuns(wsId), retry: false });
}

export function useOrchestrationSettings(wsId: string) {
  return useQuery({ queryKey: ['orchestration-settings', wsId], queryFn: () => fetchOrchestrationSettings(wsId), retry: false });
}
