/**
 * Regression test (epic 21, refactor sweep S1): the server's `forChat` wrapper
 * (`start-agents.ts`), which every registered agent's chat runs through,
 * copied an agent's fields by hand and dropped `localOnlyReason` (and the two
 * Build flags), so core's refusal of a remote Local chat or build (21.6,
 * `core/src/chat/agents.ts`) never fired in the started server. Core's own
 * test (`chat-remote.test.ts`) gives the port straight to the chat; this one
 * goes through the real wrapper the started server builds.
 */
import { createLocalAgent, LOCAL_ATTENDED_ONLY_REASON, LOCAL_ONLY_REASON } from '@ogden-agents/adapters';
import type { AgentPort } from '@ogden-agents/core';
import { describe, expect, it, vi } from 'vitest';
import { startTestServer, tempDataDir } from './helpers.js';

const captured: { forChat?: (agentId: string, agent: AgentPort) => AgentPort } = {};

vi.mock('../src/start-agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/start-agents.js')>();
  return {
    ...actual,
    wireAgents: (input: Parameters<typeof actual.wireAgents>[0]) => {
      const wired = actual.wireAgents(input);
      captured.forChat = wired.forChat;
      return wired;
    },
  };
});

describe("the server's chat wrapper keeps what Build and the remote check read of an agent (21.6)", () => {
  it('a wrapped Local-like port keeps its local only reason, its Build flags and its mode fixed at start', async () => {
    await startTestServer();
    const forChat = captured.forChat!;
    expect(forChat).toBeDefined();
    const base: AgentPort = {
      displayName: 'Local-like',
      startSession: async () => {
        throw new Error('unused');
      },
      reopenSession: async () => {
        throw new Error('unused');
      },
      listAuthMethods: async () => [],
      skillInvocation: (skill) => `/${skill}`,
    };
    const wrapped = forChat('local-like', { ...base, modeFixedAtStart: true, unattendedBuild: false, attendedOnlyReason: 'Only with you watching.', localOnlyReason: 'Only on this computer.' });
    expect(wrapped).toMatchObject({ modeFixedAtStart: true, unattendedBuild: false, attendedOnlyReason: 'Only with you watching.', localOnlyReason: 'Only on this computer.' });
    // An agent with none of them gets none.
    const plain = forChat('plain', base);
    expect(['modeFixedAtStart', 'unattendedBuild', 'attendedOnlyReason', 'localOnlyReason'].filter((key) => key in plain)).toEqual([]);
    // The real Local model, through its endpoint watch and then the chat wrapper, keeps its own words.
    const local = forChat('local', createLocalAgent({ dataDir: tempDataDir(), server: () => ({ command: process.execPath, args: [] }) }));
    expect(local.localOnlyReason).toBe(LOCAL_ONLY_REASON);
    expect(local.attendedOnlyReason).toBe(LOCAL_ATTENDED_ONLY_REASON);
    expect(local.unattendedBuild).not.toBe(true);
  });
});
