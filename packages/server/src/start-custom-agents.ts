/**
 * The custom agents' wiring (epic 21, stories 21.1 and 21.2; E21-R1, E21-R3):
 * each stored custom agent joins the live registry, the unwrapped ports and
 * the descriptors as a wired agent does, through the same `forChat` wrapper
 * (AD-16: the chat's environment only), at start and whenever the routes
 * change one. Its key, read from the keychain, joins only its own chat
 * environment, under its own variable ({@link CustomKeyEnv}).
 */
import { createCustomAgent, customAgentDescriptor, probeCustomAgent } from '@ogden-agents/adapters';
import { NotFoundError, type AgentDescriptor, type AgentPort, type CustomAgents as CustomAgentStore, type MutableAgentRegistry } from '@ogden-agents/core';
import type { AgentId, CustomAgent } from '@ogden-agents/shared';
import type { CustomAgents } from './custom-agent-routes.js';
import type { Logger } from './log.js';

export interface CustomAgentsWiringOptions {
  store: CustomAgentStore;
  agents: MutableAgentRegistry;
  unwrapped: Map<AgentId, AgentPort>;
  descriptors: { current: readonly AgentDescriptor[] };
  /** Filled here; read by every chat start (`start-agents.ts`). */
  keyEnv: Map<AgentId, Readonly<Record<string, string>>>;
  forChat: (agentId: AgentId, port: AgentPort) => AgentPort;
  chatEnv: (agentId: AgentId) => Readonly<Record<string, string>>;
  /** Whether a stored chat or project default still names `agentId` (21.1: such an id is never given to another program). */
  isAgentIdInUse: (agentId: AgentId) => boolean;
  log: Logger;
  /** Stops every running chat turn of an agent (core's `chat.stopAgent`); bound once the chat exists, after this wiring. */
  stopChats?: { current: ((agentId: AgentId) => void) | undefined };
  /** How long Test waits for `initialize` (default {@link TEST_TIMEOUT_MS}). */
  testTimeoutMs?: number;
}

/** How long Test waits for an agent to answer `initialize`: shorter than a chat start, since someone is watching the button. */
export const TEST_TIMEOUT_MS = 20_000;
/** The environment Test starts an unsaved command with: no stored agent can have this id (a slug never has two dashes in a row). */
const UNSAVED_TEST_ID = 'custom--test';

export interface CustomAgentsWiring extends CustomAgents {
  /** Registers every stored custom agent; one that can't be registered, or whose key can't be read, is logged and skipped or keyless. */
  load(): Promise<void>;
}

export function createCustomAgentsWiring(options: CustomAgentsWiringOptions): CustomAgentsWiring {
  const { store, agents, unwrapped, descriptors, keyEnv, forChat, chatEnv, isAgentIdInUse, log } = options;

  const unregister = (agentId: AgentId) => {
    agents.remove(agentId);
    unwrapped.delete(agentId);
    descriptors.current = descriptors.current.filter((descriptor) => descriptor.agentId !== agentId);
  };
  /** Registers `agent`, in place of its earlier registration if any; when the new one is refused, the earlier one stays. */
  const register = ({ agentId, displayName, commandLine }: CustomAgent) => {
    const descriptor = customAgentDescriptor({ agentId, displayName });
    const port = createCustomAgent({ descriptor, commandLine, onDiagnostic: (message, fields) => log.info(`agent: ${message}`, { agentId, ...fields }) });
    const earlier = agents.get(agentId);
    const earlierDescriptor = agents.describe(agentId);
    const earlierPort = unwrapped.get(agentId);
    if (earlier !== undefined) unregister(agentId);
    try {
      agents.add({ descriptor, agent: forChat(agentId, port) });
    } catch (error) {
      if (earlier !== undefined && earlierDescriptor !== undefined && earlierPort !== undefined) {
        agents.add({ descriptor: earlierDescriptor, agent: earlier });
        unwrapped.set(agentId, earlierPort);
        descriptors.current = [...descriptors.current, earlierDescriptor];
      }
      throw error;
    }
    unwrapped.set(agentId, port);
    descriptors.current = [...descriptors.current, descriptor];
  };
  // Changes run one at a time, so a change and a removal never interleave across their keychain waits.
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => {});
    return run;
  };
  /** Reads the agent's key into its chat environment (none: removed from it). */
  const loadKey = async (agentId: AgentId) => {
    const key = await store.key(agentId);
    if (key === undefined) keyEnv.delete(agentId);
    else keyEnv.set(agentId, { [key.envName]: key.value });
  };

  return {
    isRegistered: (agentId) => agents.get(agentId) !== undefined || store.get(agentId) !== undefined || isAgentIdInUse(agentId),
    env: chatEnv,
    list: () => store.list(),

    create: (agentId, request) =>
      serially(async () => {
        const agent = await store.create(agentId, request);
        try {
          register(agent);
        } catch (error) {
          // Not kept when it can't be registered: the user sees one refusal, not a stored agent that doesn't chat.
          await store.remove(agentId).catch(() => {});
          throw error;
        }
        if (request.apiKey !== undefined) keyEnv.set(agentId, { [request.apiKey.envName]: request.apiKey.value });
        return agent;
      }),

    update: (agentId, request) =>
      serially(async () => {
        const before = store.get(agentId);
        if (before === undefined) throw new NotFoundError('custom agent', agentId);
        const renamed = request.displayName !== undefined || request.commandLine !== undefined;
        // Registered first, as it will be saved: a refusal changes nothing, the key included. Chats already
        // running keep their process; the next start uses the new name and command.
        if (renamed) register({ ...before, displayName: request.displayName ?? before.displayName, commandLine: request.commandLine ?? before.commandLine });
        let agent: CustomAgent;
        try {
          agent = await store.update(agentId, request);
        } catch (error) {
          if (renamed) {
            try {
              register(before);
            } catch (restore) {
              log.error('a custom agent could not be registered again after a refused change', { agentId, reason: restore instanceof Error ? restore.message : 'unexpected' });
            }
          }
          throw error;
        }
        if (request.apiKey === null) keyEnv.delete(agentId);
        else if (request.apiKey !== undefined) keyEnv.set(agentId, { [request.apiKey.envName]: request.apiKey.value });
        return agent;
      }),

    test: (request) =>
      probeCustomAgent({
        displayName: 'This agent',
        commandLine: request.commandLine,
        // A chat's environment (AD-16), and the typed key under its variable only.
        env: { ...chatEnv(UNSAVED_TEST_ID), ...(request.apiKey === undefined ? {} : { [request.apiKey.envName]: request.apiKey.value }) },
        onDiagnostic: (message, fields) => log.info(`agent: ${message}`, { test: true, ...fields }),
        startTimeoutMs: options.testTimeoutMs ?? TEST_TIMEOUT_MS,
      }),

    async testSaved(agentId) {
      const agent = store.get(agentId);
      if (agent === undefined) throw new NotFoundError('custom agent', agentId);
      return probeCustomAgent({
        displayName: agent.displayName,
        commandLine: agent.commandLine,
        env: chatEnv(agentId),
        onDiagnostic: (message, fields) => log.info(`agent: ${message}`, { agentId, test: true, ...fields }),
        startTimeoutMs: options.testTimeoutMs ?? TEST_TIMEOUT_MS,
      });
    },

    remove: (agentId) =>
      serially(async () => {
        try {
          await store.remove(agentId);
        } finally {
          // A key already gone from the keychain stops reaching the agent even when the row could not be removed.
          if (store.get(agentId)?.hasKey !== true) keyEnv.delete(agentId);
        }
        unregister(agentId);
        // A chat working with it stops now, as Stop does; what it had queued stays unsent (21.4).
        try {
          options.stopChats?.current?.(agentId);
        } catch (error) {
          log.warn("a removed custom agent's chats could not all be stopped", { agentId, code: error instanceof Error ? error.name : 'unexpected' });
        }
      }),

    async load() {
      const stored = store.list();
      const registered = stored.filter((agent) => {
        try {
          register(agent);
          return true;
        } catch (error) {
          log.error('a stored custom agent could not be registered', { agentId: agent.agentId, reason: error instanceof Error ? error.message : 'unexpected' });
          return false;
        }
      });
      // Keys are read side by side: a locked keychain costs one wait at start, not one per agent.
      await Promise.all(
        registered
          .filter((agent) => agent.hasKey)
          .map((agent) =>
            loadKey(agent.agentId).catch((error: unknown) => {
              // It still chats; its harness reports the missing key in its own words.
              log.warn("a custom agent's key could not be read from the keychain", { agentId: agent.agentId, code: error instanceof Error ? error.name : 'unexpected' });
            }),
          ),
      );
      if (registered.length > 0) log.info('custom agents registered', { agents: registered.length });
    },
  };
}
