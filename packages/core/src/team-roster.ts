/**
 * The team roster (epic 15, story 15.5): who takes each role of a project's
 * team (manager, planner, worker, reviewer), what applies when nobody was
 * chosen, and whether each agent or model can take a role now, with the reason
 * in plain words when it cannot.
 *
 * - The rules that never change with what is ready live in shared
 *   ({@link rosterKindProblem}: the manager is a model, a worker is an agent).
 *   The rules that depend on what is ready now live here ({@link assess}):
 *   an agent that is not ready, an agent whose vendor allows only a person at
 *   the keyboard, a subscription agent that only takes instructions the user
 *   approves one by one (so it cannot serve a project that dispatches
 *   automatically), a model on a server that is gone or not yet confirmed, a
 *   model that did not pass Test as a manager.
 * - The defaults ({@link effectiveRoster}) apply to a role nobody was chosen
 *   for: the manager and the planner are the first ready model whose Test as a
 *   manager passed (a model nobody tested yet counts as a model of a set up
 *   server, and the screen says it was not tested), the worker is the
 *   project's default agent, the reviewer is a different ready agent from the
 *   worker where one exists.
 * - {@link createTeam} reads all of it and checks every assignment before it
 *   is saved, for a project and for the install-wide default new projects start
 *   with. The manager adapter addresses only the rostered workers
 *   ({@link Team.workers}).
 *
 * Core names no agent and no model product; every rule reads the agent
 * list's own data (its sign in methods, its readiness, its terms sentence).
 */
import {
  DEFAULT_ORCHESTRATION_MODE,
  modelWhere,
  rosterKindProblem,
  SETTINGS_STREAM,
  sameAssignee,
  TEAM_ROLES,
  TEAM_ROLE_LABELS,
  TeamRoster as TeamRosterSchema,
  type AgentId,
  type ChatAgent,
  type LocalEndpointView,
  type OrchestrationMode,
  type RosterOption,
  type RosterRoleView,
  type RosterView,
  type RosterWorker,
  type TeamAssignee,
  type TeamRole,
  type TeamRoster,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { Database } from './db/database.js';
import { ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { Chat } from './chat/types.js';
import type { LocalEndpoints } from './local-endpoints.js';
import type { ManagerTestResult } from './local-models.js';
import type { NewProjectDefaultsStore } from './new-projects.js';
import { readDefaultAgent, readOrchestrationMode, readOrchestrationRoster } from './workspace-settings.js';

/** What the checks read: everything that is ready now, passed in so the rules are plain functions. */
export interface RosterContext {
  agents: readonly ChatAgent[];
  /** The agent new chats of the project use when it names none. */
  projectDefaultAgent: AgentId | undefined;
  endpoints: readonly LocalEndpointView[];
  /** The server new chats use unless told otherwise, tried first for a default model. */
  defaultEndpointId: string | null;
  /** Test as a manager results remembered in this run. */
  tests: { result(endpointId: string, model: string): ManagerTestResult | undefined; all(): readonly ManagerTestResult[] };
  mode: OrchestrationMode;
}

/** Whether an assignee can take a role now, and what to say about it. */
export interface Assessment {
  label: string;
  where?: string | undefined;
  available: boolean;
  reason?: string | undefined;
  note?: string | undefined;
  approveEachOnly?: boolean | undefined;
}

/** The words for an agent that signs in with the user's own account. */
export const approveEachOnlyWords = (name: string): string => `${name} signs in with your account, so for now it only takes instructions you approve one by one.`;
const automaticWords = 'This project dispatches automatically. Switch it to Approve each instruction to use this agent as a worker.';

const isSubscription = (agent: ChatAgent): boolean => agent.signInMethods.some((method) => method.kind === 'subscription');

/** Whether `assignee` can take `role` now. Never throws; a reason is always plain words. */
export function assess(role: TeamRole, assignee: TeamAssignee, ctx: RosterContext): Assessment {
  if (assignee.kind === 'agent') {
    const agent = ctx.agents.find((candidate) => candidate.agentId === assignee.agentId);
    const label = agent?.displayName ?? assignee.agentId;
    if (agent === undefined) return { label, available: false, reason: `${label} is not part of this install.` };
    const kind = rosterKindProblem(role, assignee);
    if (kind !== undefined) return { label, available: false, reason: kind };
    if (agent.unavailable !== undefined) return { label, available: false, reason: `${label} is not ready. ${agent.unavailable.reason}` };
    const driven = role === 'worker' || role === 'reviewer';
    if (driven && agent.interactiveOnly !== undefined) {
      return { label, available: false, reason: `${label} is never given instructions by a manager. ${agent.interactiveOnly}` };
    }
    if (driven && isSubscription(agent)) {
      if (ctx.mode === 'automatic') return { label, available: false, approveEachOnly: true, reason: `${approveEachOnlyWords(label)} ${automaticWords}` };
      return { label, available: true, approveEachOnly: true, note: approveEachOnlyWords(label) };
    }
    return { label, available: true };
  }
  const endpoint = ctx.endpoints.find((candidate) => candidate.id === assignee.endpointId);
  const label = assignee.model;
  if (endpoint === undefined) return { label, available: false, reason: 'That server is not set up any more. Choose a model on one of your servers.' };
  const where = modelWhere(endpoint.loopback, endpoint.label);
  const kind = rosterKindProblem(role, assignee);
  if (kind !== undefined) return { label, where, available: false, reason: kind };
  if (endpoint.needsConfirmation) return { label, where, available: false, reason: `${endpoint.label} is on another computer you have not confirmed. Confirm it in Settings, under Agents, first.` };
  if (role === 'manager' || role === 'planner') {
    const test = ctx.tests.result(endpoint.id, assignee.model);
    if (test !== undefined && !test.pass) return { label, where, available: false, reason: `${assignee.model} did not pass Test as a manager. ${test.message}` };
    if (test === undefined) return { label, where, available: true, note: 'It has not been tested as a manager since Ogden Agents started. You can test it in Settings, under Agents.' };
    return { label, where, available: true, note: 'It passed Test as a manager.' };
  }
  return { label, where, available: true };
}

/** The server order for choosing a default model: the install's default server first, then the rest as listed. */
function endpointsInOrder(ctx: RosterContext): LocalEndpointView[] {
  return [...ctx.endpoints].sort((a, b) => Number(b.id === ctx.defaultEndpointId) - Number(a.id === ctx.defaultEndpointId));
}

/**
 * The model that is the default manager or planner: the first model on a ready server whose Test as a manager
 * passed (when one did), else the model chosen for a server's own chats, never one that failed the test.
 */
export function defaultModel(ctx: RosterContext): TeamAssignee | null {
  const usable = endpointsInOrder(ctx).filter((endpoint) => !endpoint.needsConfirmation);
  for (const endpoint of usable) {
    const passed = ctx.tests.all().find((test) => test.endpointId === endpoint.id && test.pass);
    if (passed !== undefined) return { kind: 'model', endpointId: endpoint.id, model: passed.model };
  }
  for (const endpoint of usable) {
    if (endpoint.model !== null && ctx.tests.result(endpoint.id, endpoint.model)?.pass !== false) return { kind: 'model', endpointId: endpoint.id, model: endpoint.model };
  }
  return null;
}

const agentOf = (agentId: AgentId): TeamAssignee => ({ kind: 'agent', agentId });

/** The first agent that can take `role` now, trying `preferred` first and skipping `except`. */
function firstAgentFor(role: TeamRole, ctx: RosterContext, preferred: readonly (AgentId | undefined)[], except?: AgentId): TeamAssignee | null {
  const order = [...preferred.filter((id): id is AgentId => id !== undefined), ...ctx.agents.map((agent) => agent.agentId)];
  for (const agentId of order) {
    if (agentId === except) continue;
    if (!ctx.agents.some((agent) => agent.agentId === agentId)) continue;
    if (assess(role, agentOf(agentId), ctx).available) return agentOf(agentId);
  }
  return null;
}

/** Who holds each role: the user's choice, else the default, else nobody. The reviewer's default depends on the worker. */
export function effectiveRoster(stored: TeamRoster, ctx: RosterContext): { roster: TeamRoster; chosen: Record<TeamRole, boolean> } {
  const manager = stored.manager ?? defaultModel(ctx);
  const planner = stored.planner ?? defaultModel(ctx);
  const worker = stored.worker ?? firstAgentFor('worker', ctx, [ctx.projectDefaultAgent]);
  const workerAgent = worker?.kind === 'agent' ? worker.agentId : undefined;
  const reviewer = stored.reviewer ?? firstAgentFor('reviewer', ctx, [], workerAgent);
  return {
    roster: { manager, planner, worker, reviewer },
    chosen: { manager: stored.manager !== null, planner: stored.planner !== null, worker: stored.worker !== null, reviewer: stored.reviewer !== null },
  };
}

const EMPTY_WORDS: Record<TeamRole, string> = {
  manager: 'No model is ready to be the manager. Set up a server in Settings, under Agents, then choose a model here.',
  planner: 'No model is ready to be the planner. Set up a server in Settings, under Agents, or choose an agent here.',
  worker: 'No agent is ready to do the work. Sign in to an agent in Settings, under Agents.',
  reviewer: 'There is no second agent ready to review. A reviewer is a different agent from the worker, or a model.',
};

/** The agents and models that could take `role`, each with whether it can now. */
function optionsFor(role: TeamRole, stored: TeamRoster, ctx: RosterContext): RosterOption[] {
  const options: RosterOption[] = [];
  const add = (assignee: TeamAssignee) => {
    if (options.some((option) => sameAssignee(option.assignee, assignee))) return;
    const found = assess(role, assignee, ctx);
    options.push({
      assignee,
      label: found.label,
      ...(found.where === undefined ? {} : { where: found.where }),
      available: found.available,
      ...(found.reason === undefined ? {} : { reason: found.reason }),
      ...(found.note === undefined ? {} : { note: found.note }),
      ...(found.approveEachOnly === true ? { approveEachOnly: true } : {}),
    });
  };
  for (const agent of ctx.agents) add(agentOf(agent.agentId));
  if (role !== 'worker') {
    const held = stored[role];
    for (const endpoint of endpointsInOrder(ctx)) {
      if (endpoint.model !== null) add({ kind: 'model', endpointId: endpoint.id, model: endpoint.model });
      for (const test of ctx.tests.all()) if (test.endpointId === endpoint.id) add({ kind: 'model', endpointId: endpoint.id, model: test.model });
    }
    if (held?.kind === 'model') add(held);
  }
  return options.slice(0, 200);
}

/** The roster as the screen shows it, from what is stored and what is ready. */
export function describeRoster(stored: TeamRoster, ctx: RosterContext): RosterView {
  const { roster, chosen } = effectiveRoster(stored, ctx);
  const roles: RosterRoleView[] = TEAM_ROLES.map((role) => {
    const effective = roster[role];
    const found = effective === null ? undefined : assess(role, effective, ctx);
    return {
      role,
      chosen: stored[role],
      effective,
      source: effective === null ? 'none' : chosen[role] ? 'chosen' : 'default',
      label: found === undefined ? null : found.where === undefined ? found.label : `${found.label} ${found.where}`,
      ...(found !== undefined && !found.available && found.reason !== undefined ? { problem: found.reason } : {}),
      ...(found?.available === true && found.note !== undefined ? { note: found.note } : {}),
      ...(effective === null ? { empty: EMPTY_WORDS[role] } : {}),
      options: optionsFor(role, stored, ctx),
    };
  });
  return { roles, mode: ctx.mode, workers: workersOf(roster, ctx) };
}

/** The agents the manager may address: the worker, and the reviewer when it is an agent, each with whether it can be given an instruction now. */
export function workersOf(roster: TeamRoster, ctx: RosterContext): RosterWorker[] {
  const workers: RosterWorker[] = [];
  for (const role of ['worker', 'reviewer'] as const) {
    const holder = roster[role];
    if (holder?.kind !== 'agent' || workers.some((worker) => worker.agentId === holder.agentId)) continue;
    const found = assess(role, holder, ctx);
    workers.push({ agentId: holder.agentId, label: found.label, ready: found.available, role });
  }
  return workers;
}

/**
 * Refuses the first role of `next` that changed and cannot be taken now, with its reason in plain words
 * ({@link ValidationError}). A role left as it was is never checked, so something that stopped being ready
 * after it was chosen never blocks another change. An agent this install does not have is left to the
 * settings use-case, which names it.
 */
export function checkRoster(current: TeamRoster, next: TeamRoster, ctx: RosterContext): void {
  for (const role of TEAM_ROLES) {
    const assignee = next[role];
    if (assignee === null || sameAssignee(assignee, current[role])) continue;
    if (assignee.kind === 'agent' && !ctx.agents.some((agent) => agent.agentId === assignee.agentId)) continue;
    const found = assess(role, assignee, ctx);
    if (!found.available) throw new ValidationError(found.reason ?? `${found.label} cannot be the ${TEAM_ROLE_LABELS[role].toLowerCase()}.`, [{ path: ['orchestrationRoster', role], message: 'cannot take the role' }]);
  }
}

export interface Team {
  /** The project's roster as the screen shows it. */
  view(workspaceId: WorkspaceId): Promise<{ roster: RosterView; stored: TeamRoster }>;
  /** The roster new projects start with, as the screen shows it. */
  defaultView(): Promise<{ roster: RosterView; stored: TeamRoster }>;
  /** The agents the project's manager may address now. */
  workers(workspaceId: WorkspaceId): Promise<RosterWorker[]>;
  /** Refuses a roster (and mode) the project cannot take, before it is saved. {@link ValidationError}. */
  check(workspaceId: WorkspaceId, roster: TeamRoster, mode?: OrchestrationMode): Promise<void>;
  /**
   * Keeps the roster new projects start with: checked like a project's, saved in the install's preferences, and
   * `settings.team_roster_default_changed` appended when it changed. {@link ValidationError} for a roster that breaks a rule.
   */
  setDefault(roster: unknown): Promise<{ roster: RosterView; stored: TeamRoster }>;
}

export interface TeamOptions {
  db: Pick<Database, 'orm'>;
  events: EventLog;
  chat: Pick<Chat, 'chatAgents'>;
  /** Called when asked, so the endpoints (which need the keychain) are made once the server has it. */
  endpoints: () => LocalEndpoints;
  tests: () => RosterContext['tests'];
  defaults: Pick<NewProjectDefaultsStore, 'get' | 'setRoster'>;
}

export function createTeam({ db, events, chat, endpoints, tests, defaults }: TeamOptions): Team {
  const { orm } = db;
  const context = async (workspaceId: WorkspaceId | undefined, modeOverride?: OrchestrationMode): Promise<RosterContext> => {
    const { agents, defaultAgentId } = await chat.chatAgents(workspaceId);
    const known = endpoints();
    const project = workspaceId === undefined ? undefined : (readDefaultAgent(orm, workspaceId, () => true) ?? undefined);
    return {
      agents,
      projectDefaultAgent: project !== undefined && agents.some((agent) => agent.agentId === project) ? project : defaultAgentId,
      endpoints: known.list(),
      defaultEndpointId: known.defaultEndpointId(),
      tests: tests(),
      mode: modeOverride ?? (workspaceId === undefined ? DEFAULT_ORCHESTRATION_MODE : (readOrchestrationMode(orm, workspaceId) ?? DEFAULT_ORCHESTRATION_MODE)),
    };
  };
  const storedOf = (workspaceId: WorkspaceId): TeamRoster => readOrchestrationRoster(orm, workspaceId) ?? TeamRosterSchema.parse({});
  return {
    async view(workspaceId) {
      const stored = storedOf(workspaceId);
      return { roster: describeRoster(stored, await context(workspaceId)), stored };
    },
    async defaultView() {
      const stored = defaults.get().orchestrationRoster ?? TeamRosterSchema.parse({});
      return { roster: describeRoster(stored, await context(undefined)), stored };
    },
    async workers(workspaceId) {
      const ctx = await context(workspaceId);
      return workersOf(effectiveRoster(storedOf(workspaceId), ctx).roster, ctx);
    },
    async check(workspaceId, roster, mode) {
      checkRoster(storedOf(workspaceId), roster, await context(workspaceId, mode));
    },
    async setDefault(input) {
      const parsed = TeamRosterSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError('Choose who takes each role: an agent, or a model.', [{ path: ['roster'], message: 'not a roster' }]);
      const previous = defaults.get().orchestrationRoster ?? TeamRosterSchema.parse({});
      checkRoster(previous, parsed.data, await context(undefined));
      const next = defaults.setRoster(parsed.data);
      if (!sameRoster(previous, next)) {
        events.append({ type: 'settings.team_roster_default_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { orchestrationRoster: next, previousOrchestrationRoster: previous } });
      }
      return this.defaultView();
    },
  };
}

const sameRoster = (a: TeamRoster, b: TeamRoster): boolean => TEAM_ROLES.every((role) => sameAssignee(a[role], b[role]));
