/**
 * The manager of a project (epic 15, story 15.4): read from the project's team
 * roster, `manager` role, each time it is asked. The role is filled by a model
 * on one of the user's endpoints and never by an agent; a project with no
 * manager chosen, a chosen endpoint that is gone, or one on another computer
 * that was not confirmed has no usable manager, and says which in plain words
 * ({@link MANAGER_STATE_WORDS}). Whether the model passes "Test as a manager"
 * is checked here only for a result remembered in this run (15.5); a manager is
 * ready when the endpoint is set up, may be called, and did not fail the test.
 *
 * Nothing here calls a model: the manager made is {@link createModelManager},
 * which goes through `LocalEndpoints.target` on every call.
 */
import { MANAGER_STATE_WORDS, type ManagerStatusView, type WorkspaceId } from '@ogden-agents/shared';
import type { Orm } from './db/database.js';
import { NotFoundError } from './errors.js';
import type { LocalEndpoints } from './local-endpoints.js';
import type { LocalModelPort } from './local-model-port.js';
import type { ManagerPort } from './manager-port.js';
import { createContextReader, createModelManager, type ContextReader } from './model-manager.js';
import { defaultModel, type RosterContext } from './team-roster.js';
import { readOrchestrationRoster } from './workspace-settings.js';

export interface ManagerSource {
  /** The project's manager state, in plain words. Never throws for a known project. */
  status(workspaceId: WorkspaceId): ManagerStatusView;
  /** The manager to call for this project, or `undefined` when its state is not `ready`. */
  managerFor(workspaceId: WorkspaceId): ManagerPort | undefined;
}

export interface ManagerSourceOptions {
  db: { orm: Orm };
  /** Called when asked, so the endpoints (which need the keychain) are made once the server has it. */
  endpoints: () => LocalEndpoints;
  port: LocalModelPort;
  /** Default: reads the server's reported context and keeps it for a few minutes. */
  contextOf?: ContextReader | undefined;
  timeoutMs?: number | undefined;
  /**
   * What Test as a manager found for each model in this run (15.5). With it a roster's default manager (the first
   * ready model that passed, else a server's chosen model) applies when none is chosen, and a manager that failed is not used.
   * Without it, only a chosen manager counts and none is checked.
   */
  tests?: (() => RosterContext['tests']) | undefined;
}

export function createManagerSource({ db, endpoints, port, contextOf = createContextReader(port), timeoutMs, tests }: ManagerSourceOptions): ManagerSource {
  const resolve = (workspaceId: WorkspaceId): { status: ManagerStatusView; manager?: ManagerPort } => {
    const known = endpoints();
    // The user's choice, else the roster's default manager (a ready model, one that passed Test as a manager first).
    const assignee =
      readOrchestrationRoster(db.orm, workspaceId)?.manager ??
      (tests === undefined ? null : defaultModel({ agents: [], projectDefaultAgent: undefined, endpoints: known.list(), defaultEndpointId: known.defaultEndpointId(), tests: tests(), mode: 'approve_each' }));
    if (assignee === null || assignee.kind !== 'model') return { status: { state: 'not_chosen', message: MANAGER_STATE_WORDS.not_chosen } };
    let view: ReturnType<LocalEndpoints['get']>;
    try {
      view = known.get(assignee.endpointId);
    } catch (error) {
      if (error instanceof NotFoundError) return { status: { state: 'endpoint_missing', message: MANAGER_STATE_WORDS.endpoint_missing } };
      throw error;
    }
    if (view.needsConfirmation) return { status: { state: 'host_not_confirmed', message: MANAGER_STATE_WORDS.host_not_confirmed } };
    // A model that was tested in this run and did not pass is not used as the manager; one not tested yet is (the roster says so).
    if (tests?.().result(assignee.endpointId, assignee.model)?.pass === false) return { status: { state: 'test_failed', message: MANAGER_STATE_WORDS.test_failed } };
    const where = view.loopback ? 'on this computer' : 'on another computer';
    return {
      status: { state: 'ready', message: `The manager is ${assignee.model} ${where}, on ${view.label}.` },
      manager: createModelManager({ port, endpoints: known, endpointId: assignee.endpointId, model: assignee.model, contextOf, timeoutMs }),
    };
  };
  return {
    status: (workspaceId) => resolve(workspaceId).status,
    managerFor: (workspaceId) => resolve(workspaceId).manager,
  };
}
