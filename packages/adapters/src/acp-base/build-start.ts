/**
 * The unattended build start of an ACP session (epic 17; moved out of
 * `acp-agent.ts` by the epic's sweep, no behaviour change): what a start with a
 * sandbox needs, refused (fail closed) before anything is spawned. An agent
 * with no way to take the sandbox, or whose own sandbox is not verified yet,
 * never runs a build session; one that names a switch skipping a permission
 * decision is a wiring bug and is refused too.
 */
import { AgentError, type AgentSandbox } from '@ogden-agents/core';
import { namesForbiddenSwitch } from './fixed-mode.js';
import type { AcpAgentQuirks, AcpBuildStart, acpReasons } from './quirks.js';

/**
 * The build start for a session started with `sandbox`, or `undefined` when it
 * is not a sandboxed build or the agent takes the sandbox through `sessionMeta`
 * (Claude Code). Throws an {@link AgentError} (`agent_unavailable`) when the
 * agent cannot run it.
 */
export function prepareBuildStart(
  displayName: string,
  quirks: Pick<AcpAgentQuirks, 'buildSession' | 'sessionMeta'>,
  sandbox: AgentSandbox | undefined,
  reasons: Pick<ReturnType<typeof acpReasons>, 'couldNotStart'>,
): AcpBuildStart | undefined {
  if (sandbox === undefined) return undefined;
  const quirk = quirks.buildSession;
  // Fail closed: an agent with no way to take the sandbox never runs a build session without one (story 5.2).
  if (quirks.sessionMeta === undefined && quirk === undefined) throw new AgentError('agent_unavailable', `${displayName} can't run a sandboxed build.`);
  if (quirk === undefined) return undefined;
  // Codex-style agents take it through their own start, and only when it is verified.
  if (!quirk.verified) throw new AgentError('agent_unavailable', `${displayName} can't build unattended on this computer yet. Build with you watching instead.`);
  try {
    const start = quirk.start(sandbox);
    if (namesForbiddenSwitch(start)) throw new Error('a build start may not name a switch that skips a permission decision');
    return start;
  } catch (error) {
    throw new AgentError('agent_unavailable', reasons.couldNotStart, { cause: error });
  }
}
