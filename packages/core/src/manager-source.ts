/**
 * The manager of a project (epic 15, story 15.4): read from the project's team
 * roster, `manager` role, each time it is asked. The role is filled by a model
 * on one of the user's endpoints and never by an agent; a project with no
 * manager chosen, a chosen endpoint that is gone, or one on another computer
 * that was not confirmed has no usable manager, and says which in plain words
 * ({@link MANAGER_STATE_WORDS}). Whether the model passes "Test as a manager"
 * is the roster story's (15.5); here the manager is ready when the endpoint is
 * set up and may be called.
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
}

export function createManagerSource({ db, endpoints, port, contextOf = createContextReader(port), timeoutMs }: ManagerSourceOptions): ManagerSource {
  const resolve = (workspaceId: WorkspaceId): { status: ManagerStatusView; manager?: ManagerPort } => {
    const assignee = readOrchestrationRoster(db.orm, workspaceId)?.manager ?? null;
    if (assignee === null || assignee.kind !== 'model') return { status: { state: 'not_chosen', message: MANAGER_STATE_WORDS.not_chosen } };
    const known = endpoints();
    let view: ReturnType<LocalEndpoints['get']>;
    try {
      view = known.get(assignee.endpointId);
    } catch (error) {
      if (error instanceof NotFoundError) return { status: { state: 'endpoint_missing', message: MANAGER_STATE_WORDS.endpoint_missing } };
      throw error;
    }
    if (view.needsConfirmation) return { status: { state: 'host_not_confirmed', message: MANAGER_STATE_WORDS.host_not_confirmed } };
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
