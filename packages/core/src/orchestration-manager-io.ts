/**
 * What the manager is given and what comes back (epic 15, story 15.13): the project's manager and its state, the workers it may address,
 * the plan as it stands, a decision as it is recorded, and the log of what a manager call left. Core builds all of it from its own data and
 * masks every manager string before it is stored, evented or shown (AD-16). The manager is a port; this file names no model product.
 */
import {
  type DecisionOutcome,
  MANAGER_LIMITS,
  MANAGER_PLAN_VERSION,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  isManagerBuildStep,
  redactSecrets,
  type ManagerAnyStep,
  type ManagerDecision,
  type ManagerPlan,
  type ManagerStatusView,
  type OrchestrationRun,
  type OrchestrationStepState,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { orchestrationSteps } from './db/schema.js';
import { type ManagerContext, type ManagerPort, type ManagerRecord } from './manager-port.js';
import type { Base, RunRow, StepRow } from './orchestration-kernel.js';
import { readRoutingRules } from './orchestration-routing.js';
import { stepOf } from './orchestration-rows.js';

/** The words when the project's team has no worker that can be given an instruction now. */
export const NO_READY_WORKER = 'No worker on this project\'s team is ready. Choose a worker, or sign in to one, in the project settings under Orchestration.';

/** How many of a worker's own idle chats the manager is told about. */
const CHATS_OFFERED = 5;

const NO_MANAGER: ManagerStatusView = { state: 'not_chosen', message: ORCHESTRATION_NO_MANAGER_MESSAGE };

export function createManagerIo({ orm, events, chat, team, buildable, builder, fixedManager, managers }: Base) {
  const statusOf = (workspaceId: WorkspaceId): ManagerStatusView => (fixedManager !== undefined ? { state: 'ready', message: 'The manager is ready.' } : (managers?.status(workspaceId) ?? NO_MANAGER));

  /** The manager of this project now, or `undefined` when none is ready (a test's fixed manager wins). */
  const managerOf = (workspaceId: WorkspaceId): ManagerPort | undefined => fixedManager ?? (statusOf(workspaceId).state === 'ready' ? managers?.managerFor(workspaceId) : undefined);

  const labels = async (workspaceId: WorkspaceId): Promise<Map<string, string>> => {
    try {
      const { agents } = await chat.chatAgents(workspaceId);
      return new Map(agents.map((agent) => [agent.agentId, agent.displayName]));
    } catch {
      return new Map();
    }
  };

  /** Appends what a manager call left for the log (its masked answer and how it went), when it left anything. */
  const noteReply = (workspaceId: WorkspaceId, runId: OrchestrationRun['id'], record: ManagerRecord | undefined): void => {
    if (record === undefined) return;
    const output = record.output === undefined ? undefined : redactSecrets(record.output).slice(0, MANAGER_LIMITS.maxRecordChars);
    events.append({
      type: 'orchestration.manager_replied',
      workspaceId,
      streamId: workspaceId,
      payload: {
        runId,
        call: record.call,
        outcome: record.outcome,
        asked: record.asked,
        repaired: record.repaired,
        ...(record.failure === undefined ? {} : { failure: record.failure }),
        ...(record.code === undefined ? {} : { code: record.code }),
        ...(output === undefined ? {} : { output }),
      },
    });
  };

  /** The plan with every manager string masked (AD-16), for the store and the event. */
  const masked = (plan: ManagerPlan): ManagerPlan => ({ ...plan, goal: redactSecrets(plan.goal), steps: plan.steps.map((step): ManagerAnyStep => (isManagerBuildStep(step) ? { ...step, reason: redactSecrets(step.reason) } : { ...step, instruction: redactSecrets(step.instruction) })) });

  /** The worker's own chats the manager may continue: plain chats the terminal does not drive that are idle, newest first, a few. */
  const ownChats = (workspaceId: WorkspaceId, agentId: string) => {
    // A chat made for a step whose send failed is left empty and is never offered back.
    const unsent = new Set(orm.select({ sessionId: orchestrationSteps.sessionId }).from(orchestrationSteps).where(eq(orchestrationSteps.state, 'failed')).all().map((row) => row.sessionId));
    return chat
      .listSessions(workspaceId)
      .filter((session) => !unsent.has(session.id) && session.kind === 'chat' && session.agentId === agentId && session.driver === 'ui' && session.state === 'idle')
      .reverse()
      .slice(0, CHATS_OFFERED)
      .map((session) => ({ sessionId: session.id, state: session.state }));
  };

  /** What the manager is given each turn about the workers: who is ready, their modes and their own idle chats (the same as at the start of a run). */
  const workerContext = async (workspaceId: WorkspaceId, goal: string, withBuildable = false): Promise<ManagerContext> => {
    const { agents } = await chat.chatAgents(workspaceId);
    // Only the rostered workers (15.5): the project's worker and its reviewer when that is an agent. Without a roster, every agent.
    const rostered = team === undefined ? undefined : await team.workers(workspaceId);
    const addressable = rostered === undefined ? agents : rostered.flatMap((worker) => agents.filter((agent) => agent.agentId === worker.agentId));
    // 15.10: the roster's reviewer, when it is an agent that is ready now: the only one a review step may go to.
    const reviewer = team === undefined ? undefined : await team.reviewer(workspaceId);
    const reviewerId = reviewer?.ready === true && addressable.some((agent) => agent.agentId === reviewer.agentId) ? reviewer.agentId : undefined;
    // 15.11: the tickets a build may be proposed for, asked only when a plan is being made (a decision cannot add steps).
    const tickets = withBuildable && buildable !== undefined ? await buildable(workspaceId) : [];
    // 15.12: the person's routing rules, read now, only when a plan is being made. A rule deleted a moment ago is not here.
    const rules = withBuildable ? (readRoutingRules(orm, workspaceId) ?? []) : [];
    return {
      goal,
      ...(rules.length === 0 ? {} : { rules }),
      ...(reviewerId === undefined ? {} : { reviewer: reviewerId }),
      ...(tickets.length === 0 ? {} : { buildable: tickets.map((ticket) => ({ ref: ticket.ref, title: ticket.title })) }),
      ...(builder === undefined ? {} : { builder }),
      projectSummary: 'A software project in the folder the user opened.',
      workers: addressable.map((agent) => ({
        agentId: agent.agentId,
        label: agent.displayName,
        ready: rostered === undefined ? agent.unavailable === undefined : (rostered.find((worker) => worker.agentId === agent.agentId)?.ready ?? false),
        modes: agent.permissionModes,
        chats: ownChats(workspaceId, agent.agentId),
      })),
    };
  };

  /** The plan as it stands (the stored steps, their text masked when they were kept), for the manager to decide on. */
  const planOfRows = (run: RunRow, rows: readonly StepRow[]): ManagerPlan => ({
    version: MANAGER_PLAN_VERSION,
    goal: run.goal,
    steps: rows.map((row) => {
      const step = stepOf(row);
      if (step.build !== null) return { id: step.stepId, build: { ticket: step.build.ticketRef }, reason: step.instruction, depends_on: step.dependsOn };
      return { id: step.stepId, worker: step.worker, chat: step.chat, instruction: step.instruction, mode: 'ask' as const, depends_on: step.dependsOn, ...(step.reviewOf === null ? {} : { review_of: step.reviewOf }) };
    }),
  });
  const statesOf = (rows: readonly StepRow[]): Record<string, OrchestrationStepState> => Object.fromEntries(rows.map((row) => [row.stepId, row.state as OrchestrationStepState]));

  /** A decision (or the words of why there was none) as it is recorded: masked and capped. */
  const decisionRecord = (decision: ManagerDecision | undefined, words: string): { action: DecisionOutcome; reason: string; stepId?: string; question?: string } => {
    if (decision === undefined) return { action: 'unavailable', reason: redactSecrets(words).slice(0, 400) };
    return {
      action: decision.action,
      reason: redactSecrets(decision.reason).slice(0, MANAGER_LIMITS.maxReasonChars),
      ...(decision.step_id === undefined ? {} : { stepId: decision.step_id }),
      ...(decision.question === undefined ? {} : { question: redactSecrets(decision.question).slice(0, MANAGER_LIMITS.maxQuestionChars) }),
    };
  };

  return { statusOf, managerOf, labels, noteReply, masked, workerContext, planOfRows, statesOf, decisionRecord };
}

export type ManagerIoApi = ReturnType<typeof createManagerIo>;
