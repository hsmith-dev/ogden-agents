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
  // At least 8: shorter values escape the output masking (it skips values under 4) and no real key is that short.
  value: z.string().trim().min(1, 'Paste the key.').min(8, 'That key is too short. Paste the whole key.').max(MAX_CUSTOM_AGENT_KEY_LENGTH, 'That key is too long.'),
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

/**
 * `POST /api/v1/custom-agents/test` (story 21.3, E21-R2): a command to start
 * once, before it is saved, with the key it would get. Nothing is kept.
 * `POST /api/v1/custom-agents/:agentId/test` takes no body: the saved command
 * and key are used.
 */
export const CustomAgentTestRequest = z.object({ commandLine, apiKey: CustomAgentKeyInput.optional() });
export type CustomAgentTestRequest = z.infer<typeof CustomAgentTestRequest>;

/** What an agent advertised in its `initialize` answer, as far as Ogden uses it. */
export const CustomAgentAdvertised = z.object({
  /** Its own name and version, when it gave them. */
  name: z.string().optional(),
  version: z.string().optional(),
  /** It can pick a chat up where it left off (`session/resume`). */
  resume: z.boolean(),
  /** It can reopen a chat by replaying it (`session/load`). */
  load: z.boolean(),
  image: z.boolean(),
  audio: z.boolean(),
  embeddedContext: z.boolean(),
});
export type CustomAgentAdvertised = z.infer<typeof CustomAgentAdvertised>;

/** The Test answer: what it advertised, and the same in plain lines for the page. */
export const CustomAgentTestResponse = z.object({ advertised: CustomAgentAdvertised, lines: z.array(z.string()) });
export type CustomAgentTestResponse = z.infer<typeof CustomAgentTestResponse>;

/** Plain lines for what `advertised` says (EXPERIENCE.md, Add your own agent): its name, how chats reopen, what a message can carry. */
export function customAgentTestLines(advertised: CustomAgentAdvertised): string[] {
  const lines: string[] = [];
  const name = advertised.name?.trim();
  if (name !== undefined && name !== '') lines.push(`It started and says it is ${name}${advertised.version === undefined || advertised.version.trim() === '' ? '' : ` ${advertised.version.trim()}`}.`);
  else lines.push("It started. It didn't say its name.");
  if (advertised.resume) lines.push('It can pick a chat up where it left off.');
  else if (advertised.load) lines.push('It can reopen a chat by replaying it.');
  else lines.push("It can't reopen a chat itself. Ogden shows the saved conversation instead.");
  const takes = [advertised.image ? 'images' : undefined, advertised.audio ? 'audio' : undefined, advertised.embeddedContext ? 'file contents' : undefined].filter((each) => each !== undefined);
  lines.push(takes.length === 0 ? 'Messages to it are text only.' : `Messages to it can include ${takes.join(' and ')}.`);
  return lines;
}

/**
 * The one stored command line for a Command and its Arguments (story 21.3):
 * the program quoted when it has a space or a quote (backslashes and quotes
 * escaped, so a Windows path survives the server's quote-aware split), then
 * the arguments exactly as typed. Empty arguments store the program alone.
 */
export function joinCommandLine(command: string, args: string): string {
  const program = command.trim();
  const rest = args.trim();
  const quoted = /[\s"']/.test(program) ? `"${program.replace(/[\\"]/g, (ch) => `\\${ch}`)}"` : program;
  return rest === '' ? quoted : `${quoted} ${rest}`;
}
