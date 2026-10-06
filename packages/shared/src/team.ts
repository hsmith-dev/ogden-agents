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
