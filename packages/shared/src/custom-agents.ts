import { z } from 'zod';
import { AgentId } from './events-common.js';

/**
 * Custom agents (epic 21, story 21.1; CAP-27, E21-R1): an ACP agent the user
 * brings, registered by its product name and the command line that starts
 * it. The server gives it its id (`custom-<slug>` from the name); its command
 * is resolved to an absolute, runnable program, never through a shell.
 */

/** The longest a custom agent's name may be. */
export const MAX_CUSTOM_AGENT_NAME_LENGTH = 40;
/** The longest a custom agent's command line may be. */
export const MAX_CUSTOM_AGENT_COMMAND_LENGTH = 1000;

// Control characters (C0, DEL and C1) never belong in a name.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** `POST /api/v1/custom-agents`: the agent's name, as the UI shows it, and its command line. */
export const CustomAgentCreateRequest = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Give the agent a name.')
    .max(MAX_CUSTOM_AGENT_NAME_LENGTH, `Keep the name to ${MAX_CUSTOM_AGENT_NAME_LENGTH} characters.`)
    .refine((name) => !CONTROL.test(name), "The name has a character that can't be shown."),
  commandLine: z.string().trim().min(1, 'Type the command to run.').max(MAX_CUSTOM_AGENT_COMMAND_LENGTH, 'That command is too long.'),
});
export type CustomAgentCreateRequest = z.infer<typeof CustomAgentCreateRequest>;

/** The id the registered agent got. */
export const CustomAgentCreateResponse = z.object({ agentId: AgentId });
export type CustomAgentCreateResponse = z.infer<typeof CustomAgentCreateResponse>;
