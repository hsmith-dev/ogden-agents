/**
 * What a `build` session's agent starts with (story 5.2), held in memory by
 * core and shared by the builds use-cases (which register it when a run
 * starts) and the chat (which reads it when the session's agent starts): the
 * run's worktree as its folder, the sandbox, and the deny-by-default
 * permission policy in place of cards. A `build` session without one (after
 * a restart: no restart recovery in the tracer) never starts an agent.
 */
import type { SessionId } from '@ogden-agents/shared';
import type { AgentPermissionDecision, AgentPermissionRequest } from './agent-port.js';
import type { AgentSandbox } from './sandbox-port.js';

export interface UnattendedBuildSetup {
  attended?: false;
  /** The run's worktree: the agent's folder. */
  cwd: string;
  sandbox: AgentSandbox;
  /** Added to the agent's environment (story 5.6: the run's own git object store). */
  env?: Readonly<Record<string, string>>;
  /** Core's answer to each permission request, by rule (never a card). */
  decide(request: AgentPermissionRequest): AgentPermissionDecision;
}

/**
 * A build with the user watching (story 5.6): no sandbox, no policy, every
 * tool call is a permission card at the `ask_every_time` level. It is only
 * ever set for a run the user started with `mode: 'attended'`.
 */
export interface AttendedBuildSetup {
  attended: true;
  cwd: string;
}

export type BuildSessionSetup = UnattendedBuildSetup | AttendedBuildSetup;

export interface BuildSessions {
  set(sessionId: SessionId, setup: BuildSessionSetup): void;
  get(sessionId: SessionId): BuildSessionSetup | undefined;
  delete(sessionId: SessionId): void;
}

export function createBuildSessions(): BuildSessions {
  const setups = new Map<SessionId, BuildSessionSetup>();
  return {
    set: (sessionId, setup) => void setups.set(sessionId, setup),
    get: (sessionId) => setups.get(sessionId),
    delete: (sessionId) => void setups.delete(sessionId),
  };
}
