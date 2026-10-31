import { z } from 'zod';
import { AgentId } from './events-common.js';

/**
 * Custom agents (epic 21, story 21.1; CAP-27, E21-R1): an ACP agent the user
 * brings, registered by its product name and the command line that starts
 * it. The server gives it its id (`custom-<slug>` from the name); its command
 * is resolved to an absolute, runnable program, never through a shell.
 * Story 21.2 keeps them (install-wide rows, AD-11) with an optional API key
 * in the keychain that reaches only that agent's process (E21-R3, AD-16).
 */

/** The longest a custom agent's name may be. */
export const MAX_CUSTOM_AGENT_NAME_LENGTH = 40;
/** The longest a custom agent's command line may be. */
export const MAX_CUSTOM_AGENT_COMMAND_LENGTH = 1000;

// Control characters (C0, DEL and C1) never belong in a name.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const displayName = z
  .string()
  .trim()
  .min(1, 'Give the agent a name.')
  .max(MAX_CUSTOM_AGENT_NAME_LENGTH, `Keep the name to ${MAX_CUSTOM_AGENT_NAME_LENGTH} characters.`)
  .refine((name) => !CONTROL.test(name), "The name has a character that can't be shown.");
const commandLine = z.string().trim().min(1, 'Type the command to run.').max(MAX_CUSTOM_AGENT_COMMAND_LENGTH, 'That command is too long.');

/** The longest an API key may be. */
export const MAX_CUSTOM_AGENT_KEY_LENGTH = 4096;

// The `_API_KEY` ending already keeps out every name a child process gets (PATH, HOME, NODE_OPTIONS…);
// these prefixes are the dynamic loader's, which reads any variable under them.
const LOADER_PREFIXES = ['LD_', 'DYLD_'];

/**
 * The variable a custom agent's API key reaches its process under (E21-R3):
 * upper case, ending `_API_KEY`, and neither a name a child process already
 * gets nor one that changes how a program loads.
 */
export const CustomAgentKeyEnvName = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]*_API_KEY$/, 'Use capital letters, digits and _ and end the name with _API_KEY, such as MY_AGENT_API_KEY.')
  .max(64, 'Keep the variable name to 64 characters.')
  .refine((name) => !LOADER_PREFIXES.some((prefix) => name.startsWith(prefix)), "That variable changes how programs start, so it can't hold a key. Pick another name.");
export type CustomAgentKeyEnvName = z.infer<typeof CustomAgentKeyEnvName>;

/** An API key and the variable it reaches the agent under. The value is kept in the keychain only. */
export const CustomAgentKeyInput = z.object({
  envName: CustomAgentKeyEnvName,
  value: z.string().trim().min(1, 'Paste the key.').max(MAX_CUSTOM_AGENT_KEY_LENGTH, 'That key is too long.'),
});
export type CustomAgentKeyInput = z.infer<typeof CustomAgentKeyInput>;

/** `POST /api/v1/custom-agents`: the agent's name, as the UI shows it, its command line and an optional key. */
export const CustomAgentCreateRequest = z.object({ displayName, commandLine, apiKey: CustomAgentKeyInput.optional() });
export type CustomAgentCreateRequest = z.infer<typeof CustomAgentCreateRequest>;

/** `PATCH /api/v1/custom-agents/:agentId`: what changes; `apiKey: null` removes the key. Its id never changes. */
export const CustomAgentUpdateRequest = z
  .object({
    displayName: displayName.optional(),
    commandLine: commandLine.optional(),
    apiKey: CustomAgentKeyInput.nullable().optional(),
  })
  .refine((body) => body.displayName !== undefined || body.commandLine !== undefined || body.apiKey !== undefined, 'Nothing to change.');
export type CustomAgentUpdateRequest = z.infer<typeof CustomAgentUpdateRequest>;

/** A stored custom agent as the API shows it: never its key, only whether one is kept and its variable. */
export const CustomAgent = z.object({
  agentId: AgentId,
  displayName: z.string(),
  commandLine: z.string(),
  keyEnvName: z.string().nullable(),
  hasKey: z.boolean(),
});
export type CustomAgent = z.infer<typeof CustomAgent>;

/** The agent as created or changed. */
export const CustomAgentResponse = z.object({ agent: CustomAgent });
export type CustomAgentResponse = z.infer<typeof CustomAgentResponse>;

/** `GET /api/v1/custom-agents`: every stored custom agent, oldest first. */
export const CustomAgentListResponse = z.object({ agents: z.array(CustomAgent) });
export type CustomAgentListResponse = z.infer<typeof CustomAgentListResponse>;

/** How a custom agent changed (`settings.custom_agent_changed`). */
export const CUSTOM_AGENT_CHANGES = ['added', 'updated', 'removed'] as const;
export const CustomAgentChange = z.enum(CUSTOM_AGENT_CHANGES);
