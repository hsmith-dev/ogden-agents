import { z } from 'zod';
import { AgentId } from './events-common.js';
import { LocalEndpointId } from './ids.js';

/**
 * The team a project can have (epic 14 story 14.3: types only; the roster's
 * screens, the manager and routing between agents are epic 15's). A role is
 * filled by an agent (a coding agent Ogden already has) or by a model on one
 * of the user's endpoints. A roster is per project, with an app-wide default.
 */
export const TEAM_ROLES = ['manager', 'planner', 'worker', 'reviewer'] as const;
export const TeamRole = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof TeamRole>;

/** Who fills a role: one of the agents, or a model on one of the endpoints. */
export const TeamAssignee = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), agentId: AgentId }),
  z.object({ kind: z.literal('model'), endpointId: LocalEndpointId, model: z.string().min(1).max(300) }),
]);
export type TeamAssignee = z.infer<typeof TeamAssignee>;

/** A roster: each role's assignee, or none for a role nobody fills. */
export const TeamRoster = z.object({
  manager: TeamAssignee.nullable().default(null),
  planner: TeamAssignee.nullable().default(null),
  worker: TeamAssignee.nullable().default(null),
  reviewer: TeamAssignee.nullable().default(null),
});
export type TeamRoster = z.infer<typeof TeamRoster>;

/** A roster with nobody in any role. */
export const emptyRoster = (): TeamRoster => TeamRoster.parse({});

/** Each role's plain name. */
export const TEAM_ROLE_LABELS: Readonly<Record<TeamRole, string>> = { manager: 'Manager', planner: 'Planner', worker: 'Worker', reviewer: 'Reviewer' };

/** What each role does, in one plain sentence. */
export const TEAM_ROLE_SENTENCES: Readonly<Record<TeamRole, string>> = {
  manager: 'Reads your goal and writes one instruction at a time. It is a model on one of your servers.',
  planner: 'Breaks a goal into steps. A model or an agent.',
  worker: 'Does the work in its own chat, with its own permission cards. An agent.',
  reviewer: 'Looks over what a worker did. An agent or a model.',
};

/** The words refusing a manager that is an agent (15.4). */
export const ROSTER_MANAGER_IS_A_MODEL = 'The manager must be a model on one of your servers, not an agent.';
/** The words refusing a worker that is a model: only an agent runs commands and edits files. */
export const ROSTER_WORKER_IS_AN_AGENT = 'A worker must be an agent. A model on its own cannot run commands or edit files.';

/**
 * The rule of a role that depends only on who is assigned, never on what is
 * ready now: the manager is a model, a worker is an agent. The plain refusal,
 * or `undefined` when the assignment is allowed. Checked by the server on
 * every save, and again by the roster screen to show why.
 */
export function rosterKindProblem(role: TeamRole, assignee: TeamAssignee | null): string | undefined {
  if (assignee === null) return undefined;
  if (role === 'manager' && assignee.kind === 'agent') return ROSTER_MANAGER_IS_A_MODEL;
  if (role === 'worker' && assignee.kind === 'model') return ROSTER_WORKER_IS_AN_AGENT;
  return undefined;
}

/** Whether two assignees are the same agent or the same model on the same server. */
export function sameAssignee(a: TeamAssignee | null, b: TeamAssignee | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'agent') return b.kind === 'agent' && a.agentId === b.agentId;
  return b.kind === 'model' && a.endpointId === b.endpointId && a.model === b.model;
}
