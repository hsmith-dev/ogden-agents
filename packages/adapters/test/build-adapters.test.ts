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
import { claudeSandboxSettings, claudeSessionOptions } from '../src/acp-claude-code/claude-guards.js';
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
    expect(await createClaudeNativeSandbox({ platform: 'darwin', isExecutable: only([]) }).check()).toEqual({ available: false, reason: NO_SEATBELT, choices: ['install_docker', 'attended', 'other_agent'] });
  });

  it('Linux: bubblewrap only with both bwrap and socat on PATH', async () => {
    const path = ['/opt/a', '/usr/bin'].join(':');
    expect(await createClaudeNativeSandbox({ platform: 'linux', path, isExecutable: only(['/usr/bin/bwrap', '/opt/a/socat']) }).check()).toEqual({ available: true, kind: 'bubblewrap' });
    expect(await createClaudeNativeSandbox({ platform: 'linux', path, isExecutable: only(['/usr/bin/bwrap']) }).check()).toEqual({ available: false, reason: NO_BUBBLEWRAP, choices: ['install_docker', 'attended', 'other_agent'] });
    expect(await createClaudeNativeSandbox({ platform: 'linux', path: '', isExecutable: () => true }).check()).toEqual({ available: false, reason: NO_BUBBLEWRAP, choices: ['install_docker', 'attended', 'other_agent'] });
  });

  it('Windows (and anything else): no native sandbox, never unsandboxed', async () => {
    expect(await createClaudeNativeSandbox({ platform: 'win32', isExecutable: () => true }).check()).toEqual({ available: false, reason: NO_SANDBOX_ON_WINDOWS, choices: ['attended', 'install_docker', 'other_agent'] });
    expect(await createClaudeNativeSandbox({ platform: 'freebsd', isExecutable: () => true }).check()).toEqual({ available: false, reason: NO_SANDBOX_ON_WINDOWS, choices: ['attended', 'install_docker', 'other_agent'] });
  });

  it('a fixed sandbox answers what it was given (tests)', async () => {
    expect(await createFixedSandbox({ available: true, kind: 'test' }).check()).toEqual({ available: true, kind: 'test' });
  });
});

describe("a build session's lockdown in Claude Code's options (story 5.2, review loop 1)", () => {
  const sandbox = {
    kind: 'seatbelt',
    writableRoots: ['/data/w/abcdefgh', '/repo/.git/objects'],
    deniedPaths: ['/repo/.git/hooks', '/data/w/abcdefgh/_bmad'],
    deniedReads: ['/data', '/home/u/.ssh'],
    allowedReads: ['/data/w/abcdefgh'],
  };

  it('managed settings only: no user, project or local rule, hook or MCP server counts; Bash sandboxed with no network; reads fenced', () => {
    expect(claudeSandboxSettings(sandbox)).toEqual({
      allowManagedPermissionRulesOnly: true,
      allowManagedHooksOnly: true,
      allowManagedMcpServersOnly: true,
      permissions: { deny: ['WebFetch', 'WebSearch', 'mcp__*'] },
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        network: { allowedDomains: [], allowManagedDomainsOnly: true, strictAllowlist: true },
        filesystem: { allowWrite: sandbox.writableRoots, denyWrite: sandbox.deniedPaths, denyRead: sandbox.deniedReads, allowRead: sandbox.allowedReads },
      },
    });
    expect(claudeSessionOptions(undefined, undefined)).toBeUndefined();
    expect(claudeSessionOptions(undefined, sandbox)).toEqual({ managedSettings: claudeSandboxSettings(sandbox), settingSources: ['project'], strictMcpConfig: true });
    // A chat in Auto keeps only its guards as flag settings.
    expect(Object.keys(claudeSessionOptions(PROTECTED_PATHS, undefined)!)).toEqual(['settings']);
  });

  it('reaches the agent in its session options (`_meta.claudeCode.options`)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ogden-agents-build-acp-'));
    dirs.push(cwd);
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
    const session = await agent.startSession({ cwd, env: { PATH: process.env.PATH ?? '' }, sandbox });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('session-start');
    const reply = events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('');
    const started = JSON.parse(reply) as { meta: { claudeCode: { options: Record<string, unknown> } }; cwd: string };
    expect(started.cwd).toBe(cwd);
    expect(started.meta.claudeCode.options).toEqual({ managedSettings: claudeSandboxSettings(sandbox), settingSources: ['project'], strictMcpConfig: true });
  });
});
