import { describe, expect, it, vi } from 'vitest';
import { createFixedSandbox } from '@ogden-agents/adapters';
import { createPerAgentSandbox, supportsUnattendedBuild } from '../src/build-agent-sandbox.js';

describe('unattended build capability', () => {
  it.each([undefined, {}, { unattendedBuild: undefined }, { unattendedBuild: false }])('refuses an absent or undeclared capability: %j', async (port) => {
    const machine = createFixedSandbox({ available: true, kind: 'test' });
    const check = vi.spyOn(machine, 'check');
    const sandbox = createPerAgentSandbox({ machine, unattendedAgents: () => supportsUnattendedBuild(port), attendedOnlyReason: () => undefined });
    expect((await sandbox.check({ agent: 'unknown' })).available).toBe(false);
    expect((await sandbox.status({ agent: 'unknown' })).available).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });
  it('accepts only an explicit true and still requires the machine sandbox', async () => {
    expect(supportsUnattendedBuild({ unattendedBuild: true })).toBe(true);
    const sandbox = createPerAgentSandbox({ machine: createFixedSandbox({ available: false, reason: 'missing' }), unattendedAgents: () => true, attendedOnlyReason: () => undefined });
    expect(await sandbox.check({ agent: 'declared' })).toMatchObject({ available: false, reason: 'missing' });
  });
});
