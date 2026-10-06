/**
 * Sending an approved step's instruction to a worker (epic 15, stories 15.3, 15.7 and 15.13). Every refusal is checked before a chat is
 * made, so a refusal leaves every chat as it was; the instruction goes through the chat's own `sendMessage` into a new worker chat (made with
 * the worker's own default mode) or into the worker's own idle chat the step names, marked as sent by the manager. This file never sets a
 * mode, a model or a driver, never hands a chat to another agent, never decides what a manager says and names none of the user's own actions.
 */
import {
  type DispatchRefusalReason,
  OrchestrationRun,
  dispatchRefusalWords,
  isRunOver,
  type OrchestrationRunState,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import {
  AgentNotReadyError,
  DispatchRefusedError,
  DriverIsTerminalError,
  NotFoundError,
  QueueFullError,
  SessionBusyError,
  SessionNotIdleError,
  StepNotApprovedError,
  UnknownAgentError,
} from './errors.js';
import { isSubscription } from './team-roster.js';
import type { Base, Late, OrchestrationChat, RunRow, StepRow } from './orchestration-kernel.js';
import type { ManagerIoApi } from './orchestration-manager-io.js';
import type { ReviewApi } from './orchestration-review.js';
import { isOpen, stepOf, type RowsApi } from './orchestration-rows.js';
import type { ReadBackApi } from './orchestration-readback.js';

/** The refusal for an agent the install says cannot start a chat now. */
export const reasonOf = (code: string): DispatchRefusalReason => (code === 'agent_signed_out' ? 'worker_signed_out' : code === 'project_not_trusted' ? 'trust_not_given' : 'worker_not_ready');

/** A refusal in plain words for `label`. */
const refusal = (reason: DispatchRefusalReason, label: string): DispatchRefusedError => new DispatchRefusedError(reason, dispatchRefusalWords(reason, label));

export function createDispatch(k: Base & Late & RowsApi & ManagerIoApi & ReviewApi & ReadBackApi) {
  const { events, feature, chat, team, sending, requireRun, requireStep, stepsOf, updateStep, moveRun, findRun, syncMode, reviewMessageFor, readBack } = k;

  /**
   * Whether `row`'s worker can be given an instruction now, checked before any chat is made. Plain refusals ({@link DispatchRefusedError}):
   * not on the team any more, its vendor allows only a person, it signs in with the user's account and the instruction was not
   * approved by the user one by one, not signed in, project not trusted, or not ready. The worker's own readiness is read again here: the
   * plan was checked when it was proposed, and the roster, the sign in or the mode may have changed since.
   */
  const requireWorkerReady = async (workspaceId: WorkspaceId, row: StepRow): Promise<string> => {
    const { agents } = await chat.chatAgents(workspaceId);
    const agent = agents.find((candidate) => candidate.agentId === row.worker);
    const label = agent?.displayName ?? row.worker;
    const refuse = (reason: DispatchRefusalReason): never => {
      throw refusal(reason, label);
    };
    if (agent === undefined) return refuse('worker_not_on_team');
    const rostered = team === undefined ? undefined : (await team.workers(workspaceId)).find((worker) => worker.agentId === row.worker);
    if (team !== undefined && rostered === undefined) return refuse('worker_not_on_team');
    // The vendor's terms, in code: an agent only a person may drive is never sent an instruction, and a subscription agent only takes the
    // user's own approval of that instruction, in either mode (an automatic run waits for the user at such a step, 15.8).
    if (agent.interactiveOnly !== undefined) return refuse('interactive_only');
    if (isSubscription(agent) && row.approvedBy !== 'user') return refuse('approve_each_only');
    if (agent.unavailable !== undefined) return refuse(reasonOf(agent.unavailable.code));
    if (rostered !== undefined && !rostered.ready) return refuse('worker_not_ready');
    return label;
  };

  /** Whether the chat a step names can take an instruction now (read as it is, no await): the worker's own, a plain chat, idle, not in the terminal. */
  const requireChatReady = (workspaceId: WorkspaceId, row: StepRow, chatId: string, label: string): SessionId => {
    let session: ReturnType<OrchestrationChat['getSession']>;
    try {
      session = chat.getSession(workspaceId, chatId as SessionId);
    } catch (error) {
      if (error instanceof NotFoundError) throw refusal('chat_gone', label);
      throw error;
    }
    if (session.kind !== 'chat') throw refusal('chat_not_a_chat', label);
    if (session.agentId !== row.worker) throw refusal('chat_other_agent', label);
    if (session.driver !== 'ui') throw refusal('driver_is_terminal', label);
    if (session.state !== 'idle') throw refusal('chat_busy', label);
    return session.id;
  };

  /** Records a refused dispatch as an event (15.8). Best effort: the refusal itself is what the caller gets. */
  const noteRefusal = (workspaceId: WorkspaceId, runId: string, row: StepRow, error: DispatchRefusedError): void => {
    try {
      events.append({
        type: 'orchestration.dispatch_refused',
        workspaceId,
        streamId: workspaceId,
        payload: { runId: runId as OrchestrationRun['id'], stepId: row.stepId, worker: row.worker, reason: error.reason, message: error.message.slice(0, 400) },
      });
    } catch {
      // A damaged database is not this call's to report.
    }
  };

  /**
   * Sends an approved step's instruction into a new worker chat, or into the worker's own idle chat the step names (15.7).
   * {@link StepNotApprovedError} for any step not approved, and {@link DispatchRefusedError} (plain words, a reason token) when the
   * worker or the chat cannot take it: both before anything is created or sent, so every chat is as it was.
   */
  const dispatchStep = async (workspaceId: WorkspaceId, runId: string, stepId: string) => {
    feature.requireOrchestration(workspaceId);
    // The mode is the project's own as it is now: a run switched back to Approve each instruction no longer takes the mode's approvals.
    const run: RunRow = syncMode(workspaceId, requireRun(workspaceId, runId));
    const row = requireStep(run.id, stepId);
    // No orchestration path sends a build (15.11): it is started only in the Build dialog, whoever asks and in either mode.
    if (row.buildRef !== null) throw new StepNotApprovedError();
    // The rule that matters, in code: only a step the user approved is ever sent. Checked before anything is created.
    if (row.state !== 'approved' || row.approvedBy === null || !isOpen(run.state)) throw new StepNotApprovedError();
    // In the default mode only the user's own approval counts, and what a step needs must be done (belt and braces: approval checked both).
    if (run.mode === 'approve_each' && row.approvedBy !== 'user') throw new StepNotApprovedError();
    const needs = stepOf(row).dependsOn;
    if (needs.some((id) => stepsOf(run.id).find((other) => other.stepId === id)?.state !== 'done')) throw new StepNotApprovedError();
    const key = `${run.id}:${row.stepId}`;
    if (sending.has(key)) throw new StepNotApprovedError();
    sending.add(key);
    try {
      // Everything that can be refused is checked before a chat is made, so a refusal leaves every chat as it was (15.7).
      const label = await requireWorkerReady(workspaceId, row);
      // A review step sends the manager's question with a capped, masked summary of the reviewed result, built here (15.10).
      const message = row.reviewOf === null ? row.instruction : await reviewMessageFor(workspaceId, run, row, label);
      const named = row.chat === 'new' ? undefined : row.chat;
      if (named !== undefined) requireChatReady(workspaceId, row, named, label);
      // The run may have been stopped, or the step edited, while the worker was checked: nothing is created then.
      const stillApproved = (): StepRow => {
        const again = syncMode(workspaceId, requireRun(workspaceId, runId));
        const current = requireStep(run.id, row.stepId);
        // What is sent is the text the user approved: an edit meanwhile sent the step back to waiting, and a changed text is never sent.
        if (current.state !== 'approved' || current.approvedBy === null || current.instruction !== row.instruction || !isOpen(again.state)) throw new StepNotApprovedError();
        if (again.mode === 'approve_each' && current.approvedBy !== 'user') throw new StepNotApprovedError();
        return current;
      };
      stillApproved();
      // The worker's own chat, in its own mode: a new one is created with the worker's default (this never sets one), an existing one keeps the mode it is in.
      let session: { id: SessionId };
      if (named !== undefined) session = { id: named as SessionId };
      else {
        try {
          session = await chat.createChatSession(workspaceId, { kind: 'chat', agentId: row.worker });
        } catch (error) {
          if (error instanceof AgentNotReadyError) throw refusal(reasonOf(error.code), label);
          if (error instanceof UnknownAgentError) throw refusal('worker_not_on_team', label);
          throw error;
        }
      }
      const made = named === undefined;
      /** A chat made for this step that did not get its instruction: named so it is not mistaken for work, never sent into twice. */
      const leaveUnsent = (): void => {
        if (!made) return;
        try {
          chat.renameSession(workspaceId, session.id, `Not sent: step ${row.stepId}`);
        } catch {
          // The name is a courtesy; the step records the chat.
        }
      };
      let current: StepRow;
      try {
        current = stillApproved();
      } catch (error) {
        leaveUnsent();
        throw error;
      }
      if (named !== undefined) requireChatReady(workspaceId, row, named, label);
      try {
        const sent = chat.sendMessage(workspaceId, session.id, current.reviewOf === null ? current.instruction : message, { origin: current.approvedBy === 'mode' ? 'manager_auto' : 'manager' });
        if (sent.queued) {
          // The chat took it to wait behind a turn that was still ending: it is not an instruction at once, so it is taken back.
          let taken = true;
          try {
            chat.removeQueuedMessage(workspaceId, session.id, sent.messageId);
          } catch {
            // It was sent meanwhile: it counts as sent, and the step reads back like any other.
            taken = false;
          }
          if (taken) throw refusal('chat_busy', label);
        }
      } catch (error) {
        const refused =
          error instanceof DispatchRefusedError
            ? error
            : error instanceof DriverIsTerminalError
              ? refusal('driver_is_terminal', label)
              : error instanceof SessionNotIdleError || error instanceof SessionBusyError || error instanceof QueueFullError
                ? refusal('chat_busy', label)
                : undefined;
        // The worker's own chat took nothing: whatever the reason, the step and the chat are left as they were.
        if (named !== undefined) throw refused ?? error;
        // A chat made for this step exists but did not take the instruction (or nobody can tell): the step is failed and says which chat, so a retry never sends twice.
        events.transaction(() => {
          updateStep(run.id, row.stepId, { state: 'failed', sessionId: session.id });
          // As a worker's own error does at read-back: a failed step is final, so the run stops here, plainly.
          const live = findRun(run.id);
          if (live !== undefined && !isRunOver(live.state as OrchestrationRunState)) {
            moveRun(run.id, 'failed', 'worker_error');
            events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'worker_error' } });
          }
        });
        leaveUnsent();
        throw refused ?? error;
      }
      events.transaction(() => {
        updateStep(run.id, row.stepId, { state: 'dispatched', sessionId: session.id });
        moveRun(run.id, 'running');
        events.append({ type: 'orchestration.step_dispatched', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: row.stepId, worker: row.worker, sessionId: session.id } });
      });
    } catch (error) {
      // A refused dispatch leaves an event (15.8), so a restart and the activity log still show it, and the plain words with it.
      if (error instanceof DispatchRefusedError) noteRefusal(workspaceId, run.id, row, error);
      throw error;
    } finally {
      sending.delete(key);
    }
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  return { requireWorkerReady, requireChatReady, noteRefusal, dispatchStep };
}

export type DispatchApi = ReturnType<typeof createDispatch>;
