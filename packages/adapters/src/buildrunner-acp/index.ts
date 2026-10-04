/**
 * `buildrunner-acp` (story 5.2's tracer, minimal; 5.4 and 5.7 complete it):
 * core's `BuildRunnerPort` for a build run as an Ogden-managed ACP session
 * (user decision 2026-10-02: no bmad-loop, tmux or psmux). The run's `build`
 * session is sent `bmad-build-auto` for exactly one named ticket, as Claude
 * Code runs an installed skill: a slash command with its arguments. This is
 * the only place that names the skill (AD-12).
 */
import { TICKET_REF_PATTERN } from '@ogden-agents/shared';
import type { BuildRunnerPort } from '@ogden-agents/core';
import { CLAUDE_CODE_AGENT_ID } from '../setup-claude-code/descriptor.js';

/** The BMad Method skill that builds one ticket unattended. */
export const BUILD_AUTO_SKILL = 'bmad-build-auto';

export function createAcpBuildRunner(): BuildRunnerPort {
  return {
    // v1 builds run Claude Code only (user, 2026-10-02): never the project's or the install's default agent.
    agentId: CLAUDE_CODE_AGENT_ID,
    invocation(ref) {
      // Core checks the ref first; never anything but one ticket's ref goes to the agent.
      if (!TICKET_REF_PATTERN.test(ref)) throw new Error('not a ticket reference');
      return `/${BUILD_AUTO_SKILL} ticket ${ref}`;
    },
  };
}
