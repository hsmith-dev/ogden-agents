/**
 * Generic developer CLI tools' adapter (CAP-25, story: generic developer CLI
 * tools detect, install, and sandbox-gate): detection by lookup only (no
 * install, no exec to check), and running the real install command under an
 * allowlisted environment. A fake computer stands in for the real one.
 */
import type { DevToolDescriptor } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { detectDevTool, runDevTool, seedDevTools, type DevToolsSystem } from '../src/index.js';

const SENTINELS = { ANTHROPIC_API_KEY: 'sk-ant-planted', OPENAI_API_KEY: 'sk-planted', GH_TOKEN: 'ghp_planted' };

function computer(
  files: string[],
  opts: { platform?: NodeJS.Platform; env?: Record<string, string>; execResult?: { code: number | null; stderrTail: string }; execCalls?: Array<{ command: string; env: Record<string, string> }> } = {},
): DevToolsSystem {
  return {
    platform: opts.platform ?? 'darwin',
    env: opts.env ?? { PATH: '/usr/bin:/opt/bin', HOME: '/home/u', ...SENTINELS },
    runnable: (path) => files.includes(path),
    async exec(command, env) {
      opts.execCalls?.push({ command, env });
      return opts.execResult ?? { code: 0, stderrTail: '' };
    },
  };
}

const TOOL: DevToolDescriptor = { id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', executables: ['gcloud', '~/sdk/bin/gcloud'], installCommand: 'install gcloud' };

describe('generic dev tools: detection looks only, never execs (CAP-25)', () => {
  it('finds a bare name on PATH', async () => {
    expect(await detectDevTool(TOOL, computer(['/usr/bin/gcloud']))).toEqual({ installed: true, path: '/usr/bin/gcloud' });
  });

  it('finds it at a declared known location, with ~ expanded, when it is not on PATH', async () => {
    expect(await detectDevTool(TOOL, computer(['/home/u/sdk/bin/gcloud']))).toEqual({ installed: true, path: '/home/u/sdk/bin/gcloud' });
  });

  it('says not installed when nothing matches', async () => {
    expect(await detectDevTool(TOOL, computer([]))).toEqual({ installed: false });
  });

  it('tries Windows PATHEXT extensions for a bare name', async () => {
    const system = computer(['C:\\bin\\gcloud.cmd'], { platform: 'win32', env: { PATH: 'C:\\bin', PATHEXT: '.EXE;.CMD' } });
    expect(await detectDevTool(TOOL, system)).toEqual({ installed: true, path: 'C:\\bin\\gcloud.cmd' });
  });
});

describe('generic dev tools: running the real install command (CAP-25)', () => {
  it('runs the exact command under an allowlisted environment, never the server\'s secrets', async () => {
    const calls: Array<{ command: string; env: Record<string, string> }> = [];
    const result = await runDevTool(TOOL, computer([], { execCalls: calls }));
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('install gcloud');
    expect(calls[0]!.env).toMatchObject({ PATH: '/usr/bin:/opt/bin', HOME: '/home/u' });
    expect(calls[0]!.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(calls[0]!.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(calls[0]!.env).not.toHaveProperty('GH_TOKEN');
  });

  it('answers ok: false with a plain reason, the last line of stderr, on a non-zero exit', async () => {
    const system = computer([], { execResult: { code: 1, stderrTail: 'Downloading...\nbrew: command not found' } });
    expect(await runDevTool(TOOL, system)).toEqual({ ok: false, reason: 'brew: command not found' });
  });

  it('refuses before running anything when the tool has no install command for this computer', async () => {
    const noCommand: DevToolDescriptor = { ...TOOL, installCommand: undefined };
    const calls: Array<{ command: string; env: Record<string, string> }> = [];
    const result = await runDevTool(noCommand, computer([], { execCalls: calls }));
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('the seed catalog (CAP-25: a starting point, not the whole mechanism)', () => {
  it('names gcloud, docker, kubectl and aws, each with real executables and an install command for every OS', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const seed = seedDevTools(platform);
      expect(seed.map((tool) => tool.id).sort()).toEqual(['aws', 'docker', 'gcloud', 'kubectl']);
      for (const tool of seed) {
        expect(tool.source, tool.id).toBe('seed');
        expect(tool.executables.length, tool.id).toBeGreaterThan(0);
        expect(tool.installCommand, `${tool.id} on ${platform}`).toBeTruthy();
      }
    }
  });
});
