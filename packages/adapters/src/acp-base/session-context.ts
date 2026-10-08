/**
 * ACP protocol details and `startOnChild`'s own context type, split out of
 * `acp-agent.ts` by story 19.7's refactor sweep to keep it under this repo's
 * 600-line convention (`quirks.ts`'s own header: "moved out of acp-agent.ts
 * by story 6.9 to keep it under 600 lines"). Zero behavior change: every
 * function here is the exact code that lived in `acp-agent.ts`, unchanged.
 */
import * as acp from '@agentclientprotocol/sdk';
import type { AgentDescriptor, AgentSandbox, ProtectedPaths } from '@ogden-agents/core';
import type { PermissionMode } from '@ogden-agents/shared';
import type { FixedModeStart } from './fixed-mode.js';
import type { Diagnostic, PermissionCallback } from './permission-request.js';
import type { AcpAgentQuirks, acpReasons } from './quirks.js';

/** The ACP steering extension request (claude-agent-acp 0.84): a user message into the running turn. */
export const STEER_METHOD = '_session/steering';

/** Whether the agent advertised the steering extension (`InitializeResponse._meta.steering.supported`). */
export function steeringAdvertised(init: acp.InitializeResponse): boolean {
  const steering: unknown = (init._meta as Record<string, unknown> | null | undefined)?.steering;
  return typeof steering === 'object' && steering !== null && (steering as { supported?: unknown }).supported === true;
}

/** ACP's `-32000`: the agent needs the user to sign in again (9.4). */
export function isAuthRequired(error: unknown): boolean {
  return error instanceof acp.RequestError && error.code === -32000;
}

/**
 * The agent's own words for a failed request, for its descriptor's
 * usage-limit patterns (handoff): the error's message and its data, as text.
 * Read in memory only, never logged or shown.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const data = error instanceof acp.RequestError ? error.data : undefined;
  let extra = '';
  try {
    extra = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    // Data that can't be read adds nothing.
  }
  return `${error.message}\n${extra}`;
}

/** What the agent is started for: a new session, a session it had before, or only to ask what it offers (`initialize`). */
export type Opening = { kind: 'new' } | { kind: 'reopen'; agentSessionId: string } | { kind: 'probe' };

export interface StartContext {
  descriptor: AgentDescriptor;
  quirks: AcpAgentQuirks;
  reasons: ReturnType<typeof acpReasons>;
  cwd: string;
  /** Core's environment for the agent, for the `authMethod` quirk only. */
  env: Readonly<Record<string, string>>;
  secrets: readonly string[];
  diagnostic: Diagnostic;
  startTimeoutMs: number;
  onPermissionRequest: PermissionCallback | undefined;
  /** Kept guarded for the session's life, through the agent's `sessionMeta` quirk (Auto only). */
  protectedPaths: ProtectedPaths | undefined;
  /** An unattended build session's sandbox (story 5.2), in the same `sessionMeta` quirk. */
  sandbox: AgentSandbox | undefined;
  /** An attended build session (story 5.6): the agent's own policy tier keeps the user's settings from skipping a card. */
  attended: boolean;
  /** The static-list model the process was started on (story 11), if any. */
  startModel: string | undefined;
  /** The list of MCP servers (2.9) */
  mcpServers?: unknown[];
  /** The chat's mode at start: given at start to an agent that fixes it (`startOptions`). */
  permissionMode: PermissionMode;
  /** The fixed-mode start, computed before the process was spawned. */
  fixed: FixedModeStart | undefined;
  /** The session modes that ask as much as Ask (an unattended build's own start adds its modes). */
  askingModeIds: readonly string[];
  /** An unattended build start's own session modes (epic 17): the session must open in one and may never leave it. */
  buildModeIds: readonly string[] | undefined;
}
