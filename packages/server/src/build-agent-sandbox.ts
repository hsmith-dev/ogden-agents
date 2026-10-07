/**
 * The sandbox answer per agent (epic 17; moved out of `start-builds.ts` by the
 * epic's sweep, no behaviour change): an agent that cannot take the build's
 * sandbox at start, or whose own sandbox is not verified yet, builds only with
 * the user watching, whatever this computer's sandbox is. Never a guess that
 * it can. Every other agent gets the computer's answer.
 */
import type { AgentPort, SandboxPort } from '@ogden-agents/core';

/** Unattended support is explicit; missing ports and undeclared capabilities fail closed. */
export function supportsUnattendedBuild(agent: Pick<AgentPort, 'unattendedBuild'> | undefined): boolean {
  return agent?.unattendedBuild === true;
}

/** Why an agent that cannot take the build's sandbox here is refused an unattended build (plain words, no dashes). */
export const AGENT_ATTENDED_ONLY_REASON = "This agent can't build unattended on this computer yet. It can build with you watching.";

export function createPerAgentSandbox({
  machine,
  unattendedAgents,
  attendedOnlyReason,
}: {
  machine: SandboxPort;
  /** Whether an agent can run an unattended build here (its port says so; `AgentPort.unattendedBuild`). */
  unattendedAgents: (agentId: string) => boolean;
  /** An agent's own plain reason it builds only with the user watching, when it says one. */
  attendedOnlyReason: (agentId: string) => string | undefined;
}): SandboxPort {
  return {
    async check(request) {
      const agent = request?.agent;
      if (agent !== undefined && !unattendedAgents(agent)) return { available: false, reason: attendedOnlyReason(agent) ?? AGENT_ATTENDED_ONLY_REASON, choices: ['attended', 'other_agent'] };
      return machine.check(request);
    },
    async status(request) {
      const agent = request?.agent;
      const status = await machine.status(request);
      if (agent === undefined || unattendedAgents(agent)) return status;
      return { ...status, available: false, kind: null, summary: attendedOnlyReason(agent) ?? AGENT_ATTENDED_ONLY_REASON, choices: ['attended', 'other_agent'], installHint: null };
    },
    run: (request) => machine.run(request),
  };
}
