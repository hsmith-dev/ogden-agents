import { z } from 'zod';
import { AgentId } from './events-common.js';
import { OrchestrationMode } from './orchestration-run.js';
import { TEAM_ROLES, TeamAssignee, TeamRole, TeamRoster } from './team.js';

/**
 * The team roster as the screen shows it (epic 15, story 15.5): for each role
 * who holds it, where that came from (the user's choice or a default), and
 * every agent or model that could take it with, for the ones that cannot, the
 * reason in plain words. Built by core from what is ready now; never a key,
 * an address or a path.
 */

/** One agent or model that could take a role, and whether it can now. */
export const RosterOption = z.object({
  assignee: TeamAssignee,
  /** Its name: the agent's product name, or the model's id. */
  label: z.string().min(1).max(400),
  /** For a model, where its server runs ("on this computer", "on another computer") with the server's name. */
  where: z.string().min(1).max(400).optional(),
  available: z.boolean(),
  /** Why it cannot take the role now, in plain words. Only when not available. */
  reason: z.string().min(1).max(600).optional(),
  /** Something to know while it can (it only takes instructions you approve, or it was not tested yet). */
  note: z.string().min(1).max(600).optional(),
  /** A subscription agent: for now it only takes instructions the user approves one by one. */
  approveEachOnly: z.boolean().optional(),
});
export type RosterOption = z.infer<typeof RosterOption>;

/** Where a role's holder comes from. */
export const ROSTER_SOURCES = ['chosen', 'default', 'none'] as const;
export const RosterSource = z.enum(ROSTER_SOURCES);
export type RosterSource = z.infer<typeof RosterSource>;

/** One role of the roster. */
export const RosterRoleView = z.object({
  role: TeamRole,
  /** What the user chose, or none (the default applies). */
  chosen: TeamAssignee.nullable(),
  /** Who holds the role now: the choice, else the default, else nobody. */
  effective: TeamAssignee.nullable(),
  source: RosterSource,
  /** The holder's name, when there is one. */
  label: z.string().min(1).max(400).nullable(),
  /** Why the holder cannot do the role right now, when it cannot. */
  problem: z.string().min(1).max(600).optional(),
  /** Something to know about the holder while it can. */
  note: z.string().min(1).max(600).optional(),
  /** Why nobody holds the role, when nobody does. */
  empty: z.string().min(1).max(600).optional(),
  options: z.array(RosterOption).max(200),
});
export type RosterRoleView = z.infer<typeof RosterRoleView>;

/** A worker the manager may address: the agent, its name, and whether it is ready to be given an instruction. */
export const RosterWorker = z.object({ agentId: AgentId, label: z.string().min(1).max(400), ready: z.boolean(), role: TeamRole });
export type RosterWorker = z.infer<typeof RosterWorker>;

export const RosterView = z.object({
  /** The four roles, in order. */
  roles: z.array(RosterRoleView).length(TEAM_ROLES.length),
  /** The mode the checks used: the project's, or Approve each instruction for the app-wide default. */
  mode: OrchestrationMode,
  /** The agents the manager may address: the worker, and the reviewer when it is an agent. */
  workers: z.array(RosterWorker).max(10),
});
export type RosterView = z.infer<typeof RosterView>;

/** `GET /api/v1/workspaces/:wsId/orchestration/roster` and `GET` or `PUT /api/v1/settings/team-roster`. */
export const TeamRosterViewResponse = z.object({ roster: RosterView, stored: TeamRoster });
export type TeamRosterViewResponse = z.infer<typeof TeamRosterViewResponse>;

/** `PUT /api/v1/settings/team-roster`: the roster new projects start with. A role left null uses the defaults. */
export const UpdateTeamRosterDefaultRequest = z.object({ roster: TeamRoster }).strict();
export type UpdateTeamRosterDefaultRequest = z.infer<typeof UpdateTeamRosterDefaultRequest>;

/** The words for where a model's server runs. */
export const modelWhere = (loopback: boolean, serverLabel: string): string => `${loopback ? 'on this computer' : 'on another computer'}, on ${serverLabel}`;
