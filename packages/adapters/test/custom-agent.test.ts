/**
 * A custom ACP agent (epic 21, story 21.1): its descriptor, and its launch,
 * which resolves the user's command line at every start, against the fake ACP
 * agent run under this Node.
 */
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentDescriptorProblems, AgentError, createAgentRegistry, type AgentEvent, type AgentSession } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createCustomAgent, customAgentDescriptor, probeCustomAgent, splitCommandLine } from '../src/index.js';
import { customAgentTestLines, joinCommandLine } from '@ogden-agents/shared';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-custom-'));
  dirs.push(dir);
  return dir;
};

const descriptor = customAgentDescriptor({ agentId: 'custom-my-agent', displayName: 'My Agent' });
const env = { PATH: process.env.PATH ?? '' };

describe('a custom ACP agent (epic 21 story 21.1)', () => {
  it('is described soundly: no pin, no account, Ask only and fixed, a trusted project, `.agents/skills`', () => {
    expect(agentDescriptorProblems(descriptor)).toEqual([]);
    expect(descriptor).toMatchObject({ install: { kind: 'user' }, signInMethods: [], noAccount: true, permissionModes: { ask: 'ask' }, modeFixedAtStart: true, needsProjectTrust: true, skillsFolder: '.agents/skills' });
    const agent = createCustomAgent({ descriptor, commandLine: 'anything' });
    expect(agent.displayName).toBe('My Agent');
    expect(agent.permissionModes).toEqual(['ask']);
    expect(agent.modeFixedAtStart).toBe(true);
    expect(agent.unattendedBuild).toBe(false);
    expect(agent.skillInvocation('bmad-help', 'an idea')).toBe('/bmad-help an idea');
    expect(() => createAgentRegistry([{ descriptor, agent }])).not.toThrow();
  });

  it('resolves an absolute command at start and streams a reply', async () => {
    const agent = createCustomAgent({ descriptor, commandLine: `"${process.execPath}" "${FAKE_AGENT}"` });
    const session = await agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' });
    sessions.push(session);
    expect(session.fixedPermissionMode).toBe('ask');
    const events: AgentEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.prompt('hi');
    expect(events.flatMap((event) => (event.type === 'message_chunk' ? [event.text] : [])).join('')).toBe('Hello from the fake agent.');
  });

  it('fails a start `agent_unavailable` in plain words when the command is missing, and resolves it again at each start', async () => {
    const missing = createCustomAgent({ descriptor, commandLine: 'ogden-no-such-agent-command --acp' });
    const error = await missing.startSession({ cwd: tempDir(), env, permissionMode: 'ask' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: 'agent_unavailable', message: expect.stringContaining('ogden-no-such-agent-command') });

    // A link to Node (a copy on Windows, where links need privileges) that goes away after the first start: the second start finds it gone.
    const node = join(tempDir(), process.platform === 'win32' ? 'node.exe' : 'node');
    if (process.platform === 'win32') copyFileSync(process.execPath, node);
    else symlinkSync(process.execPath, node);
    const agent = createCustomAgent({ descriptor, commandLine: `"${node}" "${FAKE_AGENT}"` });
    const first = await agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' });
    await first.close();
    rmSync(node, { force: true, maxRetries: 10, retryDelay: 200 });
    await expect(agent.startSession({ cwd: tempDir(), env, permissionMode: 'ask' })).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
});

describe('Test: start a custom agent once and read what it advertises (story 21.3)', () => {
  const command = `"${process.execPath}" "${FAKE_AGENT}"`;

  it("reports the fake agent's default answer: its name, no resume, text only", async () => {
    const advertised = await probeCustomAgent({ displayName: 'My Agent', commandLine: command, env });
    expect(advertised).toEqual({ name: 'fake-acp-agent', version: '1.0.0', resume: false, load: false, image: false, audio: false, embeddedContext: false });
    expect(customAgentTestLines(advertised)).toEqual([
      'It started and says it is fake-acp-agent 1.0.0.',
      "It can't reopen a chat itself. Ogden shows the saved conversation instead.",
      'Messages to it are text only.',
    ]);
  });

  it('reports resume, load and prompt capabilities when it advertises them', async () => {
    const resumes = await probeCustomAgent({ displayName: 'My Agent', commandLine: command, env: { ...env, FAKE_ACP_RESUME: 'resume', FAKE_ACP_PROMPT_CAPS: 'image,embeddedContext' } });
    expect(resumes).toMatchObject({ resume: true, load: false, image: true, audio: false, embeddedContext: true });
    expect(customAgentTestLines(resumes).slice(1)).toEqual(['It can pick a chat up where it left off.', 'Messages to it can include images and file contents.']);
    expect(await probeCustomAgent({ displayName: 'My Agent', commandLine: command, env: { ...env, FAKE_ACP_RESUME: 'load' } })).toMatchObject({ resume: false, load: true });
  });

  it('fails agent_unavailable in plain words when it exits before answering, or its command is refused before anything starts', async () => {
    const exits = probeCustomAgent({ displayName: 'My Agent', commandLine: command, env: { ...env, FAKE_ACP_EXIT_AT_START: '1' } });
    await expect(exits).rejects.toBeInstanceOf(AgentError);
    await expect(probeCustomAgent({ displayName: 'My Agent', commandLine: 'relative/agent --acp', env })).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
});

describe("the form's joined command line splits back into the same program and arguments (story 21.3)", () => {
  it.each([
    ['/usr/local/bin/goose', 'acp', ['/usr/local/bin/goose', 'acp']],
    ['/Applications/My Agent/agent', '--acp "two words"', ['/Applications/My Agent/agent', '--acp', 'two words']],
    ['C:\\Program Files\\Agent\\agent.exe', '', ['C:\\Program Files\\Agent\\agent.exe']],
    ['C:\\tools\\agent.exe', 'acp', ['C:\\tools\\agent.exe', 'acp']],
    ['/tmp/it\'s "odd"', '', ['/tmp/it\'s "odd"']],
  ])('%s %s', (command, args, expected) => {
    expect(splitCommandLine(joinCommandLine(command, args))).toEqual(expected);
  });
});
