/**
 * Story 5.2's adapters besides git: the build runner (`buildrunner-acp`, the
 * only place naming `bmad-build-auto`), Claude Code's native sandbox check
 * (`sandbox-claude-native`: Seatbelt, bubblewrap with socat, none on
 * Windows), and a build session's sandbox in Claude Code's flag settings
 * (`acp-claude-code`), seen by the fake ACP agent.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTECTED_PATHS, type AgentEvent, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeSandboxSettings, claudeSessionSettings } from '../src/acp-claude-code/claude-guards.js';
import { BUILD_AUTO_SKILL, createAcpBuildRunner, createClaudeCodeAgent, createClaudeNativeSandbox, createFixedSandbox, NO_BUBBLEWRAP, NO_SANDBOX_ON_WINDOWS, NO_SEATBELT } from '../src/index.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('buildrunner-acp (story 5.2)', () => {
  it('sends bmad-build-auto for exactly one named ticket, as a slash command', () => {
    expect(createAcpBuildRunner().invocation('5.2')).toBe(`/${BUILD_AUTO_SKILL} ticket 5.2`);
    expect(BUILD_AUTO_SKILL).toBe('bmad-build-auto');
    expect(() => createAcpBuildRunner().invocation('5.2 && rm -rf /')).toThrow();
    expect(() => createAcpBuildRunner().invocation('-x')).toThrow();
  });
});

describe('sandbox-claude-native (story 5.2, fail closed)', () => {
  const only = (files: string[]) => (file: string) => files.includes(file);
  it('macOS: Seatbelt with sandbox-exec, else unavailable', async () => {
    expect(await createClaudeNativeSandbox({ platform: 'darwin', isExecutable: only(['/usr/bin/sandbox-exec']) }).check()).toEqual({ available: true, kind: 'seatbelt' });
    expect(await createClaudeNativeSandbox({ platform: 'darwin', isExecutable: only([]) }).check()).toEqual({ available: false, reason: NO_SEATBELT });
  });

  it('Linux: bubblewrap only with both bwrap and socat on PATH', async () => {
    const path = ['/opt/a', '/usr/bin'].join(':');
    expect(await createClaudeNativeSandbox({ platform: 'linux', path, isExecutable: only(['/usr/bin/bwrap', '/opt/a/socat']) }).check()).toEqual({ available: true, kind: 'bubblewrap' });
    expect(await createClaudeNativeSandbox({ platform: 'linux', path, isExecutable: only(['/usr/bin/bwrap']) }).check()).toEqual({ available: false, reason: NO_BUBBLEWRAP });
    expect(await createClaudeNativeSandbox({ platform: 'linux', path: '', isExecutable: () => true }).check()).toEqual({ available: false, reason: NO_BUBBLEWRAP });
  });

  it('Windows (and anything else): no native sandbox, never unsandboxed', async () => {
    expect(await createClaudeNativeSandbox({ platform: 'win32', isExecutable: () => true }).check()).toEqual({ available: false, reason: NO_SANDBOX_ON_WINDOWS });
    expect(await createClaudeNativeSandbox({ platform: 'freebsd', isExecutable: () => true }).check()).toEqual({ available: false, reason: NO_SANDBOX_ON_WINDOWS });
  });

  it('a fixed sandbox answers what it was given (tests)', async () => {
    expect(await createFixedSandbox({ available: true, kind: 'test' }).check()).toEqual({ available: true, kind: 'test' });
  });
});

describe("a build session's sandbox in Claude Code's settings (story 5.2)", () => {
  const sandbox = { kind: 'seatbelt', writableRoots: ['/data/w/abcdefgh', '/repo/.git/objects'], deniedPaths: ['/repo/.git/hooks', '/data/w/abcdefgh/_bmad'] };

  it('runs Bash sandboxed, without asking and never outside it, with only the writable roots and no network', () => {
    expect(claudeSandboxSettings(sandbox)).toEqual({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        network: { allowedDomains: [], strictAllowlist: true },
        filesystem: { allowWrite: sandbox.writableRoots, denyWrite: sandbox.deniedPaths },
      },
      permissions: { deny: ['WebFetch', 'WebSearch'] },
      disableAllHooks: true,
    });
    expect(claudeSessionSettings(undefined, undefined)).toBeUndefined();
    // With the Auto guards too, both rule lists hold.
    expect((claudeSessionSettings(PROTECTED_PATHS, sandbox)?.permissions as { ask: string[]; deny: string[] }).deny).toEqual(['WebFetch', 'WebSearch']);
    expect((claudeSessionSettings(PROTECTED_PATHS, sandbox)?.permissions as { ask: string[] }).ask).toContain('Edit(**/_bmad/**)');
  });

  it('reaches the agent in its session settings (`_meta.claudeCode.options.settings`)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ogden-agents-build-acp-'));
    dirs.push(cwd);
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
    const session = await agent.startSession({ cwd, env: { PATH: process.env.PATH ?? '' }, sandbox });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('session-start');
    const reply = events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('');
    const started = JSON.parse(reply) as { meta: { claudeCode: { options: { settings: unknown } } }; cwd: string };
    expect(started.cwd).toBe(cwd);
    expect(started.meta.claudeCode.options.settings).toEqual(claudeSandboxSettings(sandbox));
  });
});
