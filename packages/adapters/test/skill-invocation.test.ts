/**
 * Each ACP agent's skill invocation (epic 6 entry 8, E6-R7; AD-12): the
 * message that makes it run an installed BMad skill, in its own syntax.
 * Nothing is started.
 */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAcpAgent, slashSkillInvocation, type AcpAgentQuirks } from '../src/acp-base/index.js';
import { ANTIGRAVITY_DESCRIPTOR, createAntigravityAgent, createClaudeCodeAgent } from '../src/index.js';

describe('skill invocation (epic 6 entry 8)', () => {
  it('is a slash command, the idea as its argument', () => {
    expect(slashSkillInvocation('bmad-prd')).toBe('/bmad-prd');
    expect(slashSkillInvocation('bmad-prd', 'a habit tracker')).toBe('/bmad-prd a habit tracker');
  });

  it.each([
    ['Claude Code', () => createClaudeCodeAgent({ adapterPath: () => undefined, claudeExecutable: null })],
    ['Antigravity', () => createAntigravityAgent({ dataDir: tmpdir(), server: () => undefined })],
  ])('%s runs an installed skill as a slash command', (_name, make) => {
    const agent = make();
    expect(agent.skillInvocation('bmad-brainstorming')).toBe('/bmad-brainstorming');
    expect(agent.skillInvocation('bmad-prd', 'an idea')).toBe('/bmad-prd an idea');
  });

  it("is the adapter's own: the shared client adds no syntax of its own", () => {
    const quirks: AcpAgentQuirks = {
      launch: () => {
        throw new Error('never started');
      },
      toolInputPaths: { pathFields: [], patternFields: [] },
      askingModeIds: ['default'],
      skillInvocation: (skill) => `run ${skill}`,
    };
    expect(createAcpAgent(ANTIGRAVITY_DESCRIPTOR, quirks).skillInvocation('bmad-prd')).toBe('run bmad-prd');
  });
});
