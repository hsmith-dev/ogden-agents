/**
 * The Local model's wiring (epic 14, story 14.2): its descriptor, its chat
 * port (`acp-opencode`) and its setup port (`setup-local`) as one
 * `AgentWiring` for the wiring slot in `start-agents.ts`, so later stories
 * fill the ports behind this function and never edit a shared wiring list. A
 * shipped install registers it only when `LOCAL_SHIPPED` (its own adapter
 * folder) is on; a test registers it through `StartOptions.local`.
 *
 * `prepareChat` is what makes a chat's process Ogden's own: before every
 * start Ogden probes the endpoint itself (a dead endpoint makes the harness
 * retry for 63 to 66 seconds before it says so), writes the generated config
 * into the data folder (no key in it), and returns the variables that point
 * the harness at it, its empty home and its `XDG_*` folders, with the
 * endpoint's key (if it has one) as `OGDEN_ENDPOINT_KEY`, in memory only.
 */
import {
  createLocalAgent,
  createLocalSetup,
  endpointFailureWords,
  installedOpenCode,
  LOCAL_DESCRIPTOR,
  opencodeChatEnv,
  opencodeConfig,
  probeEndpoint,
  SAFE_MODEL_ID,
  seedRipgrep,
  writeOpenCodeConfig,
  type LocalModel,
  type LocalSetupOptions,
} from '@ogden-agents/adapters';
import { AgentError, CoreError, type AgentPort, type AgentSetupPort } from '@ogden-agents/core';
import type { AgentWiring } from './agent-wiring.js';

/** What a test gives in place of the Local model's own ports (the fake agent's personality, a memory setup). */
export interface LocalPorts {
  agent?: AgentPort | undefined;
  setup?: AgentSetupPort | undefined;
  /** The endpoint a chat talks to; absent as shipped until story 14.3 reads the user's own. */
  target?: LocalChatTargetSource | undefined;
}

/** Where a chat's endpoint is, what it serves and the key for it (in memory only; never stored by this module). */
export interface LocalChatTarget {
  baseUrl: string;
  /** The model a chat starts on; one of the endpoint's. Absent: the first it lists. */
  model?: string | undefined;
  /** Models to offer with what is known of them; absent: every model the endpoint lists, with default limits. */
  models?: readonly LocalModel[] | undefined;
  key?: string | undefined;
}

/** Called before every start; `undefined` means no endpoint is set up. */
export type LocalChatTargetSource = () => Promise<LocalChatTarget | undefined>;

export const NO_ENDPOINT = 'Set up a server for the Local model in Settings, Agents first.';

export function localWiring(input: {
  dataDir: string;
  /** The script a test runs in place of the pinned harness (`OGDEN_AGENTS_TEST_LOCAL_SERVER`), under this Node. */
  serverScript?: string | undefined;
  given?: LocalPorts | undefined;
  /** The endpoint a chat talks to, when `given` has none. */
  target?: LocalChatTargetSource | undefined;
  /** Install's pins and download, from the test hook (a local fixture archive); absent as shipped. */
  install?: Pick<LocalSetupOptions, 'pins' | 'fetch' | 'idleTimeoutMs' | 'backoffMs'> | undefined;
  /** Replaces the endpoint's `fetch` (tests); default: the global one. */
  fetch?: typeof fetch | undefined;
  /** Protocol notes for the log; never the environment, stderr or the agent's messages. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}): AgentWiring {
  const source = input.given?.target ?? input.target;
  const prepareChat: AgentWiring['prepareChat'] = async () => {
    let target: LocalChatTarget | undefined;
    try {
      target = await source?.();
    } catch (error) {
      // An endpoint nobody confirmed, or a key the keychain no longer holds: said in plain words, nothing is called.
      if (error instanceof CoreError) throw new AgentError('agent_unavailable', error.message, { details: { code: error.code } });
      throw error;
    }
    if (target === undefined) throw new AgentError('agent_unavailable', NO_ENDPOINT);
    const probe = await probeEndpoint({ baseUrl: target.baseUrl, key: target.key, fetch: input.fetch });
    if (!probe.ok) {
      input.onDiagnostic?.('the Local model endpoint is not usable', { kind: probe.kind, ...(probe.status === undefined ? {} : { status: probe.status }) });
      throw new AgentError('agent_unavailable', endpointFailureWords(probe.kind, target.baseUrl, probe.status), { details: { kind: probe.kind } });
    }
    const listed: LocalModel[] = target.models !== undefined && target.models.length > 0 ? [...target.models] : probe.models.map((id) => ({ id }));
    // Only ids the harness can safely be told (a brace or path token in an id from a server is never written).
    const models = listed.filter((each) => SAFE_MODEL_ID.test(each.id));
    if (listed.length === 0) throw new AgentError('agent_unavailable', 'The server has no models yet. Load one in the server, then try again.');
    if (models.length === 0) throw new AgentError('agent_unavailable', "None of the server's model names can be used. Names use letters, digits and . _ : / @ + - only.");
    const model = target.model !== undefined && models.some((each) => each.id === target.model) ? target.model : models[0]!.id;
    let configFile: string;
    try {
      configFile = writeOpenCodeConfig(input.dataDir, opencodeConfig({ baseUrl: target.baseUrl, models, model, hasKey: target.key !== undefined && target.key !== '' }));
      const installed = installedOpenCode(input.dataDir);
      if (installed !== undefined) seedRipgrep(input.dataDir, installed);
    } catch (error) {
      input.onDiagnostic?.('the Local model could not be prepared', { code: (error as NodeJS.ErrnoException).code ?? 'unknown' });
      throw new AgentError('agent_unavailable', "The Local model couldn't be prepared. Check that Ogden Agents' data folder has free space and can be written to, then try again.");
    }
    return opencodeChatEnv({ dataDir: input.dataDir, configFile, key: target.key });
  };
  return {
    descriptor: LOCAL_DESCRIPTOR,
    agent:
      input.given?.agent ??
      createLocalAgent({
        dataDir: input.dataDir,
        ...(input.serverScript === undefined ? {} : { server: () => ({ command: process.execPath, args: [input.serverScript!] }) }),
        onDiagnostic: input.onDiagnostic,
      }),
    setup:
      input.given?.setup ??
      createLocalSetup({
        dataDir: input.dataDir,
        ...(input.install ?? {}),
        ...(input.onDiagnostic === undefined ? {} : { onDiagnostic: (message: string, fields?: Record<string, unknown>) => input.onDiagnostic!(`setup: ${message}`, fields) }),
      }),
    prepareChat,
  };
}
