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
export async function approveOrchestrationStep(wsId: string, runId: string, stepId: string, instruction?: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStepApprove, { wsId, runId, stepId }), instruction === undefined ? { method: 'POST' } : postJson({ instruction }), "The instruction couldn't be approved");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/steps/:stepId/dispatch`: sends an approved instruction into a new worker chat. */
export async function dispatchOrchestrationStep(wsId: string, runId: string, stepId: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId, stepId }), { method: 'POST' }, "The instruction couldn't be sent");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/steps/:stepId/edit`: the user changes an instruction; the step waits for approval again. */
export async function editOrchestrationStep(wsId: string, runId: string, stepId: string, instruction: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStepEdit, { wsId, runId, stepId }), postJson({ instruction }), "The instruction couldn't be changed");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/steps/:stepId/skip`: the user skips a step; it is never sent and the steps that need it wait. */
export async function skipOrchestrationStep(wsId: string, runId: string, stepId: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStepSkip, { wsId, runId, stepId }), { method: 'POST' }, "The step couldn't be skipped");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/reorder`: the whole new order of the steps. The server refuses one that puts a step before its prerequisite. */
export async function reorderOrchestrationSteps(wsId: string, runId: string, order: string[], auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationReorder, { wsId, runId }), postJson({ order }), "The steps couldn't be moved");
  return OrchestrationRunResponse.parse(json).run;
}

/** `POST …/stop`: Stop. The run ends and a worker turn in flight is cancelled. */
export async function stopOrchestrationRun(wsId: string, runId: string, auth: Auth = tabAuth): Promise<OrchestrationRunView> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceOrchestrationStop, { wsId, runId }), { method: 'POST' }, "The run couldn't be stopped");
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
  // The manager's state follows the project's roster and the servers: read again when either changes.
  useEventInvalidation((event) => (event.type === 'workspace.settings_changed' && event.workspaceId === wsId) || event.type === 'settings.local_endpoints_changed' ? [['orchestration-settings', wsId]] : []);
  return useQuery({ queryKey: ['orchestration-settings', wsId], queryFn: () => fetchOrchestrationSettings(wsId), retry: false });
}
