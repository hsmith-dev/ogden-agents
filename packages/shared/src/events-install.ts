/**
 * Install-level toolchain and agent setup events (stories 1.8, 9.3, epic 6
 * entry 7; moved out of `events.ts` by story 6.9 to keep it under 600
 * lines), re-exported from `events.ts`.
 */
import { z } from 'zod';
import { AGENTS_STREAM, AgentAuthMethodKind, AgentAuthState, AgentId, TOOLCHAIN_STREAM } from './events-common.js';
import { assigned } from './events-envelope.js';
import { ToolchainErrorCode, ToolName, ToolSource } from './toolchain.js';

const onToolchainStream = { workspaceId: z.null(), streamId: z.literal(TOOLCHAIN_STREAM) };

export const ToolchainInstallStartedInput = z.object({
  type: z.literal('toolchain.install_started'),
  ...onToolchainStream,
  payload: z.object({ tool: ToolName, version: z.string().min(1) }),
});
/** The user clicked Install and the download began (story 1.8). */
export const ToolchainInstallStartedEvent = ToolchainInstallStartedInput.extend(assigned);
export type ToolchainInstallStartedEvent = z.infer<typeof ToolchainInstallStartedEvent>;

export const ToolchainInstallProgressInput = z.object({
  type: z.literal('toolchain.install_progress'),
  ...onToolchainStream,
  payload: z.object({
    tool: ToolName,
    bytes: z.number().int().nonnegative(),
    total: z.number().int().positive().nullable(),
  }),
});
/** Bytes downloaded so far (throttled); `total` is `null` when the server did not say. */
export const ToolchainInstallProgressEvent = ToolchainInstallProgressInput.extend(assigned);
export type ToolchainInstallProgressEvent = z.infer<typeof ToolchainInstallProgressEvent>;

export const ToolchainInstallCompletedInput = z.object({
  type: z.literal('toolchain.install_completed'),
  ...onToolchainStream,
  payload: z.object({ tool: ToolName, version: z.string().min(1), source: ToolSource }),
});
/** The private copy is verified, unpacked and ready. */
export const ToolchainInstallCompletedEvent = ToolchainInstallCompletedInput.extend(assigned);
export type ToolchainInstallCompletedEvent = z.infer<typeof ToolchainInstallCompletedEvent>;

export const ToolchainInstallFailedInput = z.object({
  type: z.literal('toolchain.install_failed'),
  ...onToolchainStream,
  payload: z.object({
    tool: ToolName,
    code: ToolchainErrorCode,
    reason: z.string().min(1),
    canInstall: z.boolean(),
  }),
});
/** The install failed; nothing half-installed is left behind. `reason` is plain words, no secrets. */
export const ToolchainInstallFailedEvent = ToolchainInstallFailedInput.extend(assigned);
export type ToolchainInstallFailedEvent = z.infer<typeof ToolchainInstallFailedEvent>;

const onAgentsStream = { workspaceId: z.null(), streamId: z.literal(AGENTS_STREAM) };

export const AgentInstallStartedInput = z.object({
  type: z.literal('agent.install_started'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId }),
});
/** The user clicked Install for an agent (onboarding, AD-21). */
export const AgentInstallStartedEvent = AgentInstallStartedInput.extend(assigned);
export type AgentInstallStartedEvent = z.infer<typeof AgentInstallStartedEvent>;

export const AgentInstallProgressInput = z.object({
  type: z.literal('agent.install_progress'),
  ...onAgentsStream,
  payload: z.object({
    agentId: AgentId,
    /** Plain words for the step under way ("Downloading Claude Code"). */
    step: z.string().min(1),
    /** 0 to 100, or `null` when the step can't tell. */
    percent: z.number().min(0).max(100).nullable(),
  }),
});
export const AgentInstallProgressEvent = AgentInstallProgressInput.extend(assigned);
export type AgentInstallProgressEvent = z.infer<typeof AgentInstallProgressEvent>;

export const AgentInstallCompletedInput = z.object({
  type: z.literal('agent.install_completed'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId, version: z.string().min(1).optional() }),
});
export const AgentInstallCompletedEvent = AgentInstallCompletedInput.extend(assigned);
export type AgentInstallCompletedEvent = z.infer<typeof AgentInstallCompletedEvent>;

export const AgentInstallFailedInput = z.object({
  type: z.literal('agent.install_failed'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId, reason: z.string().min(1) }),
});
/** The install failed. `reason` is plain words, no secrets. */
export const AgentInstallFailedEvent = AgentInstallFailedInput.extend(assigned);
export type AgentInstallFailedEvent = z.infer<typeof AgentInstallFailedEvent>;

export const AgentUninstalledInput = z.object({
  type: z.literal('agent.uninstalled'),
  ...onAgentsStream,
  payload: z.object({ agentId: AgentId }),
});
/** The user uninstalled an agent Ogden Agents had installed (epic 6 entry 7). */
export const AgentUninstalledEvent = AgentUninstalledInput.extend(assigned);
export type AgentUninstalledEvent = z.infer<typeof AgentUninstalledEvent>;

export const AgentAuthChangedInput = z.object({
  type: z.literal('agent.auth_changed'),
  ...onAgentsStream,
  payload: z.object({
    agentId: AgentId,
    state: AgentAuthState,
    method: AgentAuthMethodKind.optional(),
    /** Plain words, when there is something to say (a failed sign-in). Never a URL, a code or a key. */
    reason: z.string().min(1).optional(),
  }),
});
/** An agent's sign-in state changed. Carries no URL, code or key (AD-15, AD-16). */
export const AgentAuthChangedEvent = AgentAuthChangedInput.extend(assigned);
export type AgentAuthChangedEvent = z.infer<typeof AgentAuthChangedEvent>;
