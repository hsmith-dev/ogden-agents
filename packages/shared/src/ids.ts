import { z } from 'zod';

/**
 * Ogden Agents-owned identifiers (AD-9): a type prefix, an underscore and a
 * 26-character Crockford base32 ULID, e.g. `ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3`.
 * Agent session IDs and CLI resume IDs are never keys; they live in a
 * session's `adapterRefs`.
 */
export const ID_PREFIXES = {
  workspace: 'ws',
  session: 'ses',
  run: 'run',
  event: 'evt',
  /** An always-allow permission rule, scoped to one workspace (story 2.3; stored by 2.6). */
  permissionRule: 'rule',
  /** A notification webhook target (story 5.3 contract; stored by 11.4). */
  webhook: 'hook',
  /** A terminal pane of the Terminals workspace (epic 16, story 16.2). */
  pane: 'pan',
  /** An OpenAI-compatible endpoint the Local model talks to (epic 14 story 14.3). */
  localEndpoint: 'lep',
  /** An orchestration run: a manager's goal and plan (epic 15, story 15.2). */
  orchestrationRun: 'orc',
  /** A remote machine added over SSH (CAP-24, epic 19 story 19.1; architecture's id-prefix note). */
  remoteMachine: 'mach',
} as const;
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

const ULID_BODY = '[0-9A-HJKMNP-TV-Z]{26}';

function prefixedUlid<P extends IdPrefix>(prefix: P) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${ULID_BODY}$`), `expected a ${prefix}_<ULID> id`) as unknown as z.ZodType<
    `${P}_${string}`,
    string
  >;
}

export const WorkspaceId = prefixedUlid('ws');
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const SessionId = prefixedUlid('ses');
export type SessionId = z.infer<typeof SessionId>;

export const RunId = prefixedUlid('run');
export type RunId = z.infer<typeof RunId>;

export const EventId = prefixedUlid('evt');
export type EventId = z.infer<typeof EventId>;

/** An always-allow permission rule (E2-R3): stored and enforced in core, scoped to one workspace. */
export const PermissionRuleId = prefixedUlid('rule');
export type PermissionRuleId = z.infer<typeof PermissionRuleId>;

/** A notification webhook target (story 5.3; 11.4 stores it, its URL through `SecretStorePort`). */
export const WebhookId = prefixedUlid('hook');
export type WebhookId = z.infer<typeof WebhookId>;

/** A terminal pane (epic 16): one pseudo-terminal running one launcher in a project. */
export const PaneId = prefixedUlid('pan');
export type PaneId = z.infer<typeof PaneId>;
/** An OpenAI-compatible endpoint (epic 14 story 14.3); its key is `agent-endpoint-key/<id>` in the keychain (AD-16). */
export const LocalEndpointId = prefixedUlid('lep');
export type LocalEndpointId = z.infer<typeof LocalEndpointId>;

/** An orchestration run (epic 15 story 15.2). */
export const OrchestrationRunId = prefixedUlid('orc');
export type OrchestrationRunId = z.infer<typeof OrchestrationRunId>;

/** A remote machine the user added over SSH (CAP-24, epic 19 story 19.1). */
export const RemoteMachineId = prefixedUlid('mach');
export type RemoteMachineId = z.infer<typeof RemoteMachineId>;
