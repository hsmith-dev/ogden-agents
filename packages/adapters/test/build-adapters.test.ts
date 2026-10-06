/**
 * Story 5.2's adapters besides git: the build runner (`buildrunner-acp`, the
 * only place naming `bmad-build-auto`), Claude Code's native sandbox check
 * (`sandbox-claude-native`: Seatbelt, bubblewrap with socat, none on
 * Windows), and a build session's sandbox in Claude Code's flag settings
 * (`acp-claude-code`), seen by the fake ACP agent.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTECTED_PATHS, type AgentEvent, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeAttendedSettings, claudeSandboxSettings, claudeSessionOptions } from '../src/acp-claude-code/claude-guards.js';
import { BUILD_AUTO_SKILL, createAcpBuildRunner, createClaudeCodeAgent, createFixedSandbox } from '../src/index.js';

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

  it('story 5.7: every halt the installed bmad-build-auto writes has an Ogden code other than other (drift check)', () => {
    const skill = join(import.meta.dirname, '..', '..', '..', '.agents', 'skills', 'bmad-build-auto');
    // The skill ships in the repo's own agent files; a checkout without it has nothing to check against.
    if (!existsSync(skill)) return;
    const files = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(folder, entry.name)) : entry.name.endsWith('.md') ? [join(folder, entry.name)] : []));
    const halts = new Set<string>();
    for (const file of files(skill)) for (const found of readFileSync(file, 'utf8').matchAll(/blocking condition `([^`]+)`/g)) halts.add(found[1]!.replace(/\s*\(non-convergence\)$/, ''));
    // The skill's own list is what this reads: if it ever stops naming halts this way, the test says so rather than passing empty.
    expect(halts.size).toBeGreaterThanOrEqual(10);
    const runner = createAcpBuildRunner();
    const unmapped = [...halts].filter((condition) => runner.blockedCode(condition) === 'other');
    expect(unmapped).toEqual([]);
    // The skill adds detail after a condition, and says it in any case.
    expect(runner.blockedCode('Intent Gap: the patch is saved beside the plan')).toBe('intent_gap');
    expect(runner.blockedCode('something nobody listed')).toBe('other');
  });
});

describe('createFixedSandbox (story 5.2)', () => {
  it('answers what it was given (tests), in words too', async () => {
    expect(await createFixedSandbox({ available: true, kind: 'test' }).check()).toEqual({ available: true, kind: 'test' });
    expect(await createFixedSandbox({ available: false, reason: 'No.', choices: ['attended'] }).status()).toMatchObject({ available: false, summary: 'No.', choices: ['attended'] });
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
    // An attended build (story 5.6): managed rules, hooks and MCP only and no bypass, so the user's own settings cannot skip a card; no sandbox.
    expect(claudeSessionOptions(undefined, undefined, true)).toEqual({ managedSettings: claudeAttendedSettings() });
    expect(claudeAttendedSettings()).toMatchObject({ allowManagedPermissionRulesOnly: true, allowManagedHooksOnly: true, allowManagedMcpServersOnly: true, permissions: { disableBypassPermissionsMode: 'disable' } });
    expect(JSON.stringify(claudeAttendedSettings())).not.toContain('sandbox');
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

  it('an attended build session starts with the attended managed settings and no sandbox', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ogden-agents-build-acp-'));
    dirs.push(cwd);
    const agent = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
    const session = await agent.startSession({ cwd, env: { PATH: process.env.PATH ?? '' }, attended: true });
    sessions.push(session);
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('session-start');
    const reply = events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('');
    const started = JSON.parse(reply) as { meta: { claudeCode: { options: Record<string, unknown> } } };
    expect(started.meta.claudeCode.options).toEqual({ managedSettings: claudeAttendedSettings() });
  });
});
