/**
 * Claude Code's descriptor (epic 6, entry 3): sound, matching the adapter it
 * describes (its name, declared modes and their ACP ids, the pinned adapter
 * version, the API key variable), so the registry takes it.
 */
import { agentDescriptorProblems, agentEnvKeys, createAgentRegistry, declaredModes } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { ACP_MODE_IDS, CLAUDE_AGENT_ACP_PACKAGE, CLAUDE_CODE_DESCRIPTOR, createClaudeCodeAgent, pinnedVersion } from '../src/index.js';

describe("Claude Code's descriptor (6.3)", () => {
  it('has no problem and describes the adapter as it is', () => {
    expect(agentDescriptorProblems(CLAUDE_CODE_DESCRIPTOR)).toEqual([]);
    const agent = createClaudeCodeAgent({ adapterPath: () => undefined, claudeExecutable: null });
    expect(CLAUDE_CODE_DESCRIPTOR.displayName).toBe(agent.displayName);
    expect(declaredModes(CLAUDE_CODE_DESCRIPTOR)).toEqual(agent.permissionModes);
    expect(CLAUDE_CODE_DESCRIPTOR.permissionModes).toEqual(ACP_MODE_IDS);
    expect(CLAUDE_CODE_DESCRIPTOR.install).toEqual({ kind: 'npm', package: CLAUDE_AGENT_ACP_PACKAGE, version: pinnedVersion() });
    expect(CLAUDE_CODE_DESCRIPTOR.homeEnv).toBeUndefined();
    expect(agentEnvKeys([CLAUDE_CODE_DESCRIPTOR])).toEqual(['ANTHROPIC_API_KEY']);
    expect(() => createAgentRegistry([{ descriptor: CLAUDE_CODE_DESCRIPTOR, agent }])).not.toThrow();
  });
});
