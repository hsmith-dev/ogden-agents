/**
 * `acp-custom` (epic 21, story 21.1, E21-R1, E21-R2): an ACP agent the user
 * brings, named by its command line, on the shared ACP client (`acp-base`).
 * What is its own:
 *
 * - Its descriptor is built from what the user typed: `custom-<slug>`, their
 *   name for it, no pinned install (`install.kind: 'user'`: they install it,
 *   Ogden runs it), no account and no sign in methods.
 * - Its command is resolved like a linked command (`resolveLinkedCommand`:
 *   absolute, runnable, never through a shell) at every start, against the
 *   chat's own environment, so a command removed or changed since it was
 *   registered fails the start in plain words (`agent_unavailable`).
 * - Ask only, fixed at start: Ogden never sends `session/set_mode`, and every
 *   tool that runs or writes reaches a card through the shared client.
 * - It needs a trusted project (it may run the project's own config), and
 *   its skills go in `.agents/skills`, run as a slash command (`/name idea`).
 */
import { AgentError, type AgentDescriptor, type AgentPort } from '@ogden-agents/core';
import type { AgentId, CustomAgentAdvertised } from '@ogden-agents/shared';
import { createAcpAgent, type AcpAgentPort, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import { resolveLinkedCommand } from '../acp-base/linked-command.js';
import { maskSecrets, secretValues } from '../acp-base/mask.js';
import { slashSkillInvocation } from '../acp-base/quirks.js';
import type { AcpToolInputPaths } from '../acp-base/tool-paths.js';

/** Every custom agent's id starts with this (`custom-<slug>`). */
export const CUSTOM_AGENT_ID_PREFIX = 'custom-';

/** Its one mode's id: Ogden never sends a mode, so the id is only Ask's own name for it. */
export const CUSTOM_ASK_MODE_ID = 'ask';

/** Where a custom agent's skills go in a project. */
export const CUSTOM_SKILLS_FOLDER = '.agents/skills';

/** The input fields an arbitrary agent's tools most often name a path in (the shapes the shipped agents use). */
const TOOL_INPUT_PATHS: AcpToolInputPaths = { pathFields: ['path', 'filePath', 'file_path', 'paths'], patternFields: ['pattern', 'glob'] };

/** What a custom agent is, as data, from the id Ogden gave it and the user's own name for it. */
export function customAgentDescriptor(input: { agentId: AgentId; displayName: string }): AgentDescriptor {
  return {
    agentId: input.agentId,
    displayName: input.displayName,
    provider: 'You',
    install: { kind: 'user' },
    signInMethods: [],
    noAccount: true,
    permissionModes: { ask: CUSTOM_ASK_MODE_ID },
    modeFixedAtStart: true,
    modesNote: 'An agent you add yourself runs in Ask only.',
    needsProjectTrust: true,
    skillsFolder: CUSTOM_SKILLS_FOLDER,
    sendNow: 'interrupt',
  };
}

export interface CustomAgentOptions {
  descriptor: AgentDescriptor;
  /** The command line the user typed (quote-aware, never run through a shell). */
  commandLine: string;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: ((message: string, fields?: Record<string, unknown>) => void) | undefined;
  /** Default `START_TIMEOUT_MS`. */
  startTimeoutMs?: number | undefined;
}

/** Core's `AgentPort` for a custom agent: its command resolved again at each start. */
export function createCustomAgent(options: CustomAgentOptions): AcpAgentPort {
  const { descriptor, commandLine } = options;
  const quirks: AcpAgentQuirks = {
    launch({ env }) {
      const resolved = resolveLinkedCommand({ command: commandLine }, env);
      if (!resolved.ok) throw new AgentError('agent_unavailable', resolved.reason);
      return { command: resolved.resolved.command, args: [...resolved.resolved.args], logFields: { server: resolved.resolved.command, custom: true } };
    },
    toolInputPaths: TOOL_INPUT_PATHS,
    askingModeIds: [CUSTOM_ASK_MODE_ID],
    // No account: sessions open as they are.
    authMethod: () => undefined,
    // Ask is all it has, so there is nothing to send.
    startOptions: () => ({ guardsPaths: false }),
    skillInvocation: slashSkillInvocation,
  };
  return createAcpAgent(descriptor, quirks, { onDiagnostic: options.onDiagnostic, startTimeoutMs: options.startTimeoutMs });
}

/**
 * Test (story 21.3, E21-R2): starts `commandLine` once with `env`, reads its
 * `initialize` answer and stops it; no session is opened. The command is
 * resolved first (a refusal is `AgentError('agent_unavailable', <reason>)`
 * before anything starts); the agent's own failure is its plain reason.
 */
export async function probeCustomAgent(options: {
  displayName: string;
  commandLine: string;
  env: Readonly<Record<string, string>>;
  onDiagnostic?: CustomAgentOptions['onDiagnostic'];
  startTimeoutMs?: number | undefined;
}): Promise<CustomAgentAdvertised> {
  const resolved = resolveLinkedCommand({ command: options.commandLine }, options.env);
  if (!resolved.ok) throw new AgentError('agent_unavailable', resolved.reason);
  const descriptor = customAgentDescriptor({ agentId: `${CUSTOM_AGENT_ID_PREFIX}test`, displayName: options.displayName });
  const port = createCustomAgent({ descriptor, commandLine: options.commandLine, onDiagnostic: options.onDiagnostic, startTimeoutMs: options.startTimeoutMs });
  const init = await port.probe({ env: options.env });
  // Its name and version are the agent's own words: masked like any of its output, so a key it echoes never reaches the page.
  const secrets = secretValues(options.env);
  const shown = (text: string, max: number) => maskSecrets(text, secrets).slice(0, max);
  const capabilities = init.agentCapabilities;
  const prompt = capabilities?.promptCapabilities;
  return {
    ...(init.agentInfo?.name === undefined ? {} : { name: shown(init.agentInfo.title ?? init.agentInfo.name, 80) }),
    ...(init.agentInfo?.version === undefined ? {} : { version: shown(init.agentInfo.version, 40) }),
    resume: capabilities?.sessionCapabilities?.resume !== undefined && capabilities.sessionCapabilities.resume !== null,
    load: capabilities?.loadSession === true,
    image: prompt?.image === true,
    audio: prompt?.audio === true,
    embeddedContext: prompt?.embeddedContext === true,
  };
}
