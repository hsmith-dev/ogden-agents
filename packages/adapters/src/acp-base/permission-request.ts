/**
 * A permission request from the agent, answered (story 2.6, 6.4; moved out of
 * `acp-agent.ts` by story 6.9 to keep it under 600 lines): core's decision
 * picks the agent's `allow_once` or `reject_once` option, never an
 * `allow_always` or session-wide one; anything else, or no one to ask,
 * declines or cancels it.
 */
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentPermissionDecision, AgentPermissionRequest } from '@ogden-agents/core';
import type { AcpAgentQuirks } from './quirks.js';
import { commandOf, toolCallPaths } from './tool-paths.js';

/** Core's `onPermissionRequest`. */
export type PermissionCallback = (request: AgentPermissionRequest) => Promise<AgentPermissionDecision>;

/** A protocol note for the log. Never the environment, stderr or the agent's messages. */
export type Diagnostic = (message: string, fields?: Record<string, unknown>) => void;

/** The permission option kinds ACP defines; anything else is logged as `unknown`. */
const OPTION_KINDS: ReadonlySet<string> = new Set(['allow_once', 'allow_always', 'reject_once', 'reject_always']);

export interface PermissionRequestContext {
  /** The session's folder, for the paths a card names. */
  cwd: string;
  quirks: Pick<AcpAgentQuirks, 'commandFields' | 'toolInputPaths'>;
  /** Masks the agent's secret-looking values. */
  mask: (text: string) => string;
  diagnostic: Diagnostic;
  onPermissionRequest: PermissionCallback | undefined;
}

/** The answer to the agent's `session/request_permission`. */
export async function answerPermissionRequest(
  params: acp.RequestPermissionRequest,
  { cwd, quirks, mask, diagnostic, onPermissionRequest }: PermissionRequestContext,
): Promise<acp.RequestPermissionResponse> {
  const option = (kind: acp.PermissionOptionKind) => params.options.find((candidate) => candidate.kind === kind);
  // A card only ever picks "once" options (6.4): with neither on offer there is nothing it may answer.
  if (option('allow_once') === undefined && option('reject_once') === undefined) {
    diagnostic('the agent offered neither allow_once nor reject_once; cancelling the request', {
      optionKinds: params.options.map((candidate) => (OPTION_KINDS.has(candidate.kind) ? candidate.kind : 'unknown')),
    });
    return { outcome: { outcome: 'cancelled' } };
  }
  const select = (kind: acp.PermissionOptionKind): acp.RequestPermissionResponse => {
    const chosen = option(kind);
    if (chosen === undefined) {
      diagnostic('the agent offered no option for the decision; cancelling the request', { option: kind });
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
  };
  if (onPermissionRequest === undefined) {
    diagnostic('declined a permission request (no one to ask)', { toolKind: params.toolCall.kind ?? null });
    return select('reject_once');
  }
  try {
    const command = commandOf(params.toolCall.rawInput, quirks.commandFields);
    const decision: AgentPermissionDecision | null | undefined = await onPermissionRequest({
      toolCallId: params.toolCall.toolCallId,
      title: mask(params.toolCall.title ?? ''),
      kind: params.toolCall.kind ?? undefined,
      command: command === undefined ? undefined : mask(command),
      paths: toolCallPaths(params.toolCall, cwd, quirks.toolInputPaths).map(mask),
      // Unmasked, for core's own decisions only (the build policy): never shown or stored.
      rawPaths: toolCallPaths(params.toolCall, cwd, quirks.toolInputPaths),
    });
    switch (decision?.outcome) {
      case 'allow_once':
        return select('allow_once');
      case 'deny':
        return select('reject_once');
      case 'cancelled':
        return { outcome: { outcome: 'cancelled' } };
      default:
        // A missing or unknown decision never lets the tool call run.
        diagnostic('the permission request got no known decision; declining it', { outcome: String((decision as { outcome?: unknown } | null | undefined)?.outcome ?? null) });
        return select('reject_once');
    }
  } catch (error) {
    diagnostic('the permission request could not be decided; declining it', { reason: mask(String(error)) });
    return select('reject_once');
  }
}
