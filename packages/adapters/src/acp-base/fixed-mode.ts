/**
 * An agent whose permission mode is given once, when a chat starts (epic 12,
 * 12.3; the descriptor's `modeFixedAtStart`), as the shared client opens it:
 * the quirk's `startOptions` put the chat's mode in the `_meta` of
 * `session/new`, `resume` and `load`; the session never sends
 * `session/set_mode`, offers every mode the descriptor declares, and takes
 * only the mode it started in (core stops a session started in a looser mode
 * than the chat's, and restarts a stricter one). It names no agent.
 */
import { AgentError, declaredModes, type AgentDescriptor, type AgentSession, type ProtectedPaths } from '@ogden-agents/core';
import type { PermissionMode } from '@ogden-agents/shared';
import type { AcpAgentQuirks, acpReasons } from './quirks.js';

/** What a fixed-mode start adds to the session requests and the session. */
export interface FixedModeStart {
  /** Spread into `session/new`, `resume` and `load`. */
  sessionMeta: { _meta?: Record<string, unknown> };
  /** Whether the session keeps the protected paths guarded. */
  guardsPaths: boolean;
  /** Overrides on the session: the mode it started in, the modes it offers, and the one `set_mode` it takes. */
  session: Required<Pick<AgentSession, 'fixedPermissionMode' | 'permissionModes' | 'setPermissionMode'>>;
}

/** Throws (a wiring bug) when the descriptor and the quirks disagree on whether the mode is fixed at start. */
export function checkFixedModeWiring(descriptor: AgentDescriptor, quirks: Pick<AcpAgentQuirks, 'startOptions'>): void {
  const fixed = descriptor.modeFixedAtStart === true;
  if (fixed && quirks.startOptions === undefined) throw new Error(`acp-base: ${descriptor.agentId} fixes its mode at start but gives no startOptions`);
  if (!fixed && quirks.startOptions !== undefined) throw new Error(`acp-base: ${descriptor.agentId} gives startOptions but does not fix its mode at start`);
}

/** The fixed-mode start for a chat in `permissionMode`; `undefined` for an agent that takes its mode after it started. */
export function startFixedMode(
  descriptor: AgentDescriptor,
  quirks: Pick<AcpAgentQuirks, 'startOptions'>,
  input: { permissionMode: PermissionMode; protectedPaths?: ProtectedPaths | undefined },
  reasons: ReturnType<typeof acpReasons>,
): FixedModeStart | undefined {
  if (descriptor.modeFixedAtStart !== true || quirks.startOptions === undefined) return undefined;
  const options = quirks.startOptions(input);
  const offered = declaredModes(descriptor);
  return {
    sessionMeta: options.meta === undefined ? {} : { _meta: options.meta },
    guardsPaths: options.guardsPaths,
    session: {
      fixedPermissionMode: input.permissionMode,
      permissionModes: offered,
      async setPermissionMode(mode) {
        if (mode !== input.permissionMode) throw new AgentError('agent_failed', reasons.couldNotSwitchMode);
      },
    },
  };
}
