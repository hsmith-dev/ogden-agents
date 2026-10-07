/**
 * The shared ACP client (epic 6 entry 4, E6-R3): what every ACP agent's
 * adapter builds on, from its descriptor and a few quirks. It names no agent.
 */
export {
  acpAsksLessThanAsk,
  acpModeOf,
  acpReasons,
  createAcpAgent,
  EXIT_GRACE_MS,
  slashSkillInvocation,
  START_TIMEOUT_MS,
  type AcpAgentOptions,
  type AcpAgentQuirks,
  type AcpAuthChoice,
  type AcpBuildSessionQuirk,
  type AcpBuildStart,
  type AcpLaunch,
  type AcpLaunchInput,
  type AcpStartOptions,
} from './acp-agent.js';
export { createStreamMasker, maskSecrets, MASKED, secretValues, SECRET_ENV_NAME } from './mask.js';
export { resolveLinkedCommand, splitCommandLine, type LinkedCommandResolution, type ResolvedLinkedCommand, type ResolveLinkedCommandOptions } from './linked-command.js';
export { commandOf, toolCallPaths, type AcpToolInputPaths } from './tool-paths.js';
