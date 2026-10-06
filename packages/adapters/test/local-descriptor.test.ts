/**
 * The Local model's descriptor and pins (epic 14, story 14.2): the descriptor
 * is sound, Ask only, fixed at start, and matches the adapter; every pin is
 * well formed and ties to the registry's own values from spike 14.1; Windows
 * carries a pinned ripgrep. No test reaches the network.
 */
import { agentDescriptorProblems, AGENT_PLATFORMS, declaredModes } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createLocalAgent, LOCAL_DESCRIPTOR, LOCAL_PINS, LOCAL_SHIPPED } from '../src/index.js';

const SHA256 = /^[0-9a-f]{64}$/;

describe("the Local model's descriptor", () => {
  it('has no problem and describes the adapter as it is', () => {
    expect(agentDescriptorProblems(LOCAL_DESCRIPTOR)).toEqual([]);
    const agent = createLocalAgent({ dataDir: '/nowhere' });
    expect(LOCAL_DESCRIPTOR.displayName).toBe(agent.displayName);
    expect(declaredModes(LOCAL_DESCRIPTOR)).toEqual(agent.permissionModes);
    expect(agent.modeFixedAtStart).toBe(true);
  });

  it('declares Ask only, needs no sign in and no key, and trusts no project config', () => {
    expect(LOCAL_DESCRIPTOR.agentId).toBe('local');
    expect(LOCAL_DESCRIPTOR.displayName).toBe('Local model');
    expect(declaredModes(LOCAL_DESCRIPTOR)).toEqual(['ask']);
    expect(LOCAL_DESCRIPTOR.signInMethods).toEqual([]);
    expect(LOCAL_DESCRIPTOR.noAccount).toBe(true);
    expect(agentDescriptorProblems({ ...LOCAL_DESCRIPTOR, signInMethods: [{ id: 'x', kind: 'subscription', label: 'x' }] })).toEqual(['local: it needs no account but lists sign in methods']);
    expect(LOCAL_DESCRIPTOR.needsProjectTrust).toBe(false);
    expect(LOCAL_DESCRIPTOR.homeEnv).toBeUndefined();
    expect(LOCAL_DESCRIPTOR.modesNote).toBe('Small local models make more mistakes with tools, so every command and file change asks first.');
    expect(agentDescriptorProblems({ ...LOCAL_DESCRIPTOR, modesNote: '  ' })).toEqual(['local: the modes note is empty or has a dash']);
    expect(agentDescriptorProblems({ ...LOCAL_DESCRIPTOR, modesNote: 'Only Ask \u2014 for now.' })).toEqual(['local: the modes note is empty or has a dash']);
  });

  it('runs a skill as a slash command from .agents/skills, and keeps a handoff brief small', () => {
    const agent = createLocalAgent({ dataDir: '/nowhere' });
    expect(agent.skillInvocation('bmad-help')).toBe('/bmad-help');
    expect(agent.skillInvocation('bmad-help', 'an idea')).toBe('/bmad-help an idea');
    expect(LOCAL_DESCRIPTOR.skillsFolder).toBe('.agents/skills');
    expect(LOCAL_DESCRIPTOR.handoffBudgetChars).toBeLessThanOrEqual(20_000);
    expect(LOCAL_DESCRIPTOR.configFolders).toContain('.opencode');
  });

  it('is registered by a shipped install now that its chat is complete (story 14.6)', () => {
    expect(LOCAL_SHIPPED).toBe(true);
  });
});

describe('the pins (spike 14.1, from the ACP registry, every sha256 re-verified)', () => {
  const registry: Record<string, string> = {
    'darwin-arm64': '8522b70f545184b3a8d97c5ca4f814093b2476d72aebfda8c48bcd072ec31d1b',
    'darwin-x64': '66bf0638cffad3b65bd6648cc3947619e1dd71f4bfeee0a81e087ac036bb1088',
    'linux-x64': '0f22479647226d1d2dd99595d20082ee7bda3870b62dc6a90b41efc1a71d7e9a',
    'linux-arm64': 'bbdb3f00c2c51e42e315525233151309724226a8776da8e9145e3b0fa3d5310f',
    'win32-x64': '8ec42ed1ad8db108052394b83ab69d0331398f761fbfff5fe50f91d65bdd3548',
    'win32-arm64': 'b738ae4e823c862eaba6d6bd6e1d35e01b46851d7160882c7bdb189f33a16447',
  };

  it('pins OpenCode 1.18.34 for all six platforms, by the registry\'s hashes, from the project\'s own GitHub releases', () => {
    expect(LOCAL_PINS.version).toBe('1.18.34');
    expect(Object.keys(LOCAL_PINS.archives).sort()).toEqual([...AGENT_PLATFORMS].sort());
    for (const platform of AGENT_PLATFORMS) {
      const pin = LOCAL_PINS.archives[platform]!;
      expect(pin.sha256, platform).toBe(registry[platform]);
      expect(pin.url.startsWith('https://github.com/anomalyco/opencode/releases/download/v1.18.34/opencode-'), platform).toBe(true);
      expect(pin.size).toBeGreaterThan(0);
      expect(pin.args).toEqual(['acp']);
      for (const [name, file] of Object.entries(pin.files)) {
        expect(file.sha256, `${platform} ${name}`).toMatch(SHA256);
        expect(file.size).toBeGreaterThan(0);
      }
      expect(Object.keys(pin.files), platform).toEqual([pin.binary]);
    }
  });

  it('names the Windows binary opencode.exe (the registry\'s cmd lacks the extension) and uses tar.gz only on Linux', () => {
    expect(LOCAL_PINS.archives['win32-x64']!.binary).toBe('opencode.exe');
    expect(LOCAL_PINS.archives['win32-arm64']!.binary).toBe('opencode.exe');
    for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'] as const) expect(LOCAL_PINS.archives[platform]!.binary).toBe('opencode');
    for (const platform of AGENT_PLATFORMS) expect(LOCAL_PINS.archives[platform]!.format).toBe(platform.startsWith('linux') ? 'tar.gz' : 'zip');
  });

  it('pins ripgrep 15.1.0 for Windows only, hash checked, so the harness never downloads it', () => {
    expect(LOCAL_PINS.ripgrep.version).toBe('15.1.0');
    expect(Object.keys(LOCAL_PINS.ripgrep.archives).sort()).toEqual(['win32-arm64', 'win32-x64']);
    expect(LOCAL_PINS.ripgrep.archives['win32-x64']).toMatchObject({
      url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-pc-windows-msvc.zip',
      sha256: '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a',
      size: 1_810_687,
    });
    for (const pin of Object.values(LOCAL_PINS.ripgrep.archives)) {
      expect(pin!.sha256).toMatch(SHA256);
      expect(pin!.file.sha256).toMatch(SHA256);
      expect(pin!.member.endsWith('/rg.exe')).toBe(true);
    }
  });

  it('matches the descriptor\'s install source', () => {
    expect(LOCAL_DESCRIPTOR.install.kind).toBe('archive');
    if (LOCAL_DESCRIPTOR.install.kind !== 'archive') return;
    expect(LOCAL_DESCRIPTOR.install.version).toBe(LOCAL_PINS.version);
    for (const platform of AGENT_PLATFORMS) expect(LOCAL_DESCRIPTOR.install.archives[platform]).toEqual({ url: LOCAL_PINS.archives[platform]!.url, sha256: LOCAL_PINS.archives[platform]!.sha256 });
  });
});
