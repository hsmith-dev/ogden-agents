/**
 * Epic 6, entry 3 (contracts and stubs): what an agent is, as data (its
 * descriptor), checked when the registry is built; the agent list every
 * later entry reads; and a new chat refused, with its code and the action
 * that fixes it, for an agent that isn't installed, isn't signed in, or
 * needs a trusted project. No real agent runs: these are in-memory ports.
 */
import { ChatAgentsResponse, type AgentId, type AgentSetupStatus } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  agentDescriptorProblems,
  agentEnvKeys,
  AgentNotReadyError,
  createAgentRegistry,
  createAgentSetup,
  createChat,
  type AgentDescriptor,
  type AgentPort,
  type AgentReadiness,
} from '../src/index.js';
import { openTestCore, registered, tempDir, testDescriptor } from './helpers.js';

const port = (displayName: string, permissionModes?: AgentPort['permissionModes']): AgentPort => ({
  displayName,
  ...(permissionModes === undefined ? {} : { permissionModes }),
  listAuthMethods: async () => [],
  startSession: () => Promise.reject(new Error('no agent runs here')),
  reopenSession: () => Promise.reject(new Error('no agent runs here')),
});

/** The four shapes the spikes found (6.1, 12.1, 12.2), as fields only: core must take every one without a branch. */
const SHAPES: Array<Partial<AgentDescriptor>> = [
  // An agent on the user's own profile, installed from npm, three modes.
  {},
  // An archive per OS with Ogden's SHA-256, a home variable, Ask and Skip all only.
  {
    install: { kind: 'archive', version: '1.3.0', archives: { 'darwin-arm64': { url: 'https://example.invalid/a.zip', sha256: 'a'.repeat(64) }, 'win32-x64': { url: 'https://example.invalid/w.zip', sha256: 'b'.repeat(64) } } },
    homeEnv: 'AGENT_HOME',
    signInMethods: [
      { id: 'login-personal', kind: 'subscription', label: 'Log in' },
      { id: 'api-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['AGENT_API_KEY'] } },
    ],
    permissionModes: { ask: 'default', skip_all: 'yolo' },
    skillsFolder: '.agents/skills',
  },
  // A key read from several variables (Ogden sets the first), modes as ids.
  {
    homeEnv: 'OTHER_HOME',
    signInMethods: [{ id: 'api-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['OTHER_KEY', 'OTHER_FALLBACK_KEY'] } }],
    permissionModes: { ask: 'read-only', auto: 'agent', skip_all: 'agent-full-access' },
  },
  // An npm binary Ogden checks itself, modes as session flags, a project to trust first.
  {
    install: { kind: 'npm', package: '@vendor/cli', version: '1.0.49', binarySha256: { 'linux-x64': 'c'.repeat(64) } },
    permissionModes: { ask: 'default', auto: '_meta.autoMode', skip_all: '_meta.yoloMode' },
    needsProjectTrust: true,
    skillsFolder: '.claude/skills',
  },
];

describe('an agent descriptor (6.3)', () => {
  it('takes every shape the spikes found', () => {
    for (const shape of SHAPES) {
      const descriptor = testDescriptor('some-agent', port('Some Agent', ['ask', 'auto', 'skip_all']), shape);
      expect(agentDescriptorProblems(descriptor)).toEqual([]);
    }
  });

  it.each([
    ['a lower-case env name', { homeEnv: 'agent_home' }, /not an environment variable name/],
    ['a short SHA-256', { install: { kind: 'archive', version: '1', archives: { 'linux-x64': { url: 'https://example.invalid/l.zip', sha256: 'abc' } } } }, /SHA-256/],
    ['a plain http archive', { install: { kind: 'archive', version: '1', archives: { 'linux-x64': { url: 'http://example.invalid/l.zip', sha256: 'a'.repeat(64) } } } }, /https/],
    ['an unknown platform', { install: { kind: 'npm', package: 'p', version: '1', binarySha256: { 'beos-x86': 'a'.repeat(64) } } }, /not a platform/],
    ['no archive', { install: { kind: 'archive', version: '1', archives: {} } }, /no archive/],
    ['a skills folder outside the repo', { skillsFolder: '../skills' }, /skills folder/],
    ['an absolute skills folder', { skillsFolder: '/etc/skills' }, /skills folder/],
    ['a Windows skills folder', { skillsFolder: 'C:\\skills' }, /skills folder/],
    ['an API key method with no variable', { signInMethods: [{ id: 'k', kind: 'api_key', label: 'Key' }] }, /names no variable/],
    ['a method listed twice', { signInMethods: [{ id: 'a', kind: 'subscription', label: 'A' }, { id: 'a', kind: 'subscription', label: 'B' }] }, /twice/],
    ['no Ask', { permissionModes: { skip_all: 'yolo' } as unknown as AgentDescriptor['permissionModes'] }, /does not declare Ask/],
    ['a mode Ogden has not', { permissionModes: { ask: 'default', plan: 'plan' } as unknown as AgentDescriptor['permissionModes'] }, /not a permission mode/],
    ['no provider', { provider: ' ' }, /provider is empty/],
  ] as Array<[string, Partial<AgentDescriptor>, RegExp]>)('finds %s', (_what, overrides, problem) => {
    expect(agentDescriptorProblems(testDescriptor('some-agent', port('Some Agent'), overrides)).join('\n')).toMatch(problem);
  });

  it("refuses to register an agent whose descriptor has a problem, or disagrees with its port's name or modes", () => {
    const agent = port('Some Agent', ['ask', 'skip_all']);
    expect(() => createAgentRegistry([registered('some-agent', agent, { skillsFolder: '..' })])).toThrow(/skills folder/);
    expect(() => createAgentRegistry([registered('some-agent', agent, { displayName: 'Other Name' })])).toThrow(/is named/);
    expect(() => createAgentRegistry([registered('some-agent', agent, { permissionModes: { ask: 'default' } })])).toThrow(/declares the modes ask,skip_all/);
    const registry = createAgentRegistry([registered('some-agent', agent)]);
    expect(registry.describe('some-agent')?.provider).toBe('Test Provider');
    expect(registry.describe('missing-agent')).toBeUndefined();
  });

  it("derives every agent's key variables, each once (AGENT_ENV_KEYS)", () => {
    const a = testDescriptor('a-agent', port('A'), SHAPES[2]);
    const b = testDescriptor('b-agent', port('B'));
    expect(agentEnvKeys([a, b, a])).toEqual(['OTHER_KEY', 'OTHER_FALLBACK_KEY', 'TEST_AGENT_KEY']);
  });
});

function setUp(readiness: Record<string, AgentReadiness | Error> = {}, options: { trusted?: boolean; trustAgent?: boolean } = {}) {
  const core = openTestCore();
  const agents = createAgentRegistry([
    registered('first-agent', port('First Agent', ['ask', 'auto', 'skip_all'])),
    registered('second-agent', port('Second Agent', ['ask', 'skip_all']), { needsProjectTrust: options.trustAgent ?? false, signInMethods: [{ id: 'login', kind: 'subscription', label: 'Log in' }] }),
  ]);
  const asked: AgentId[] = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents,
    agentReadiness: async (agentId) => {
      asked.push(agentId);
      const answer = readiness[agentId];
      if (answer instanceof Error) throw answer;
      return answer ?? { install: 'installed', auth: 'signed_in' };
    },
    ...(options.trusted === undefined ? {} : { projectTrusted: () => options.trusted! }),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, workspace, asked };
}

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AgentNotReadyError);
  const { code, message, agentId, action } = error as AgentNotReadyError;
  return { code, message, agentId, action };
};

describe('a new chat only with an agent that can start it (6.3)', () => {
  it('starts a chat with a ready agent, and with one whose readiness could not be read', async () => {
    const { chat, workspace, asked } = setUp({ 'second-agent': new Error('status failed') });
    expect((await chat.createChatSession(workspace.id)).agentId).toBe('first-agent');
    expect((await chat.createChatSession(workspace.id, { agentId: 'second-agent' })).agentId).toBe('second-agent');
    expect(asked).toEqual(['first-agent', 'second-agent']);
  });

  it('refuses one that is not installed, or still installing, naming it and the fix; nothing is created', async () => {
    const { core, chat, workspace } = setUp({
      'first-agent': { install: 'not_installed', auth: 'needs_sign_in', blocked: 'agent_not_installed' },
      'second-agent': { install: 'installing', auth: 'needs_sign_in', blocked: 'agent_not_installed' },
    });
    expect(await refusal(chat.createChatSession(workspace.id))).toEqual({
      code: 'agent_not_installed',
      message: "First Agent isn't installed. Install it in Settings → Agents.",
      agentId: 'first-agent',
      action: 'install',
    });
    expect((await refusal(chat.createChatSession(workspace.id, { agentId: 'second-agent' }))).message).toBe("Second Agent is still installing. Start the chat once it's done.");
    expect(core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('refuses one that is signed out, offering an API key only to an agent that takes one', async () => {
    const out: AgentReadiness = { install: 'installed', auth: 'needs_sign_in', blocked: 'agent_signed_out' };
    const { chat, workspace } = setUp({ 'first-agent': out, 'second-agent': out });
    expect(await refusal(chat.createChatSession(workspace.id))).toEqual({
      code: 'agent_signed_out',
      message: "First Agent isn't signed in. Sign in or add an API key in Settings → Agents.",
      agentId: 'first-agent',
      action: 'sign_in',
    });
    expect((await refusal(chat.createChatSession(workspace.id, { agentId: 'second-agent' }))).message).toBe("Second Agent isn't signed in. Sign in in Settings → Agents.");
  });

  it('refuses an agent that needs a trusted project until the project is trusted; others never ask', async () => {
    const untrusted = setUp({}, { trustAgent: true });
    expect(await refusal(untrusted.chat.createChatSession(untrusted.workspace.id, { agentId: 'second-agent' }))).toMatchObject({ code: 'project_not_trusted', action: 'trust_project', agentId: 'second-agent' });
    expect((await untrusted.chat.createChatSession(untrusted.workspace.id)).agentId).toBe('first-agent');
    const trusted = setUp({}, { trustAgent: true, trusted: true });
    expect((await trusted.chat.createChatSession(trusted.workspace.id, { agentId: 'second-agent' })).agentId).toBe('second-agent');
  });

  it('lists every agent as the frozen agent list says, with why a chat is refused', async () => {
    const { chat } = setUp({ 'second-agent': { install: 'installed', auth: 'needs_sign_in', blocked: 'agent_signed_out' } });
    const listed = ChatAgentsResponse.parse(await chat.chatAgents());
    expect(listed).toEqual({
      agents: [
        {
          agentId: 'first-agent',
          displayName: 'First Agent',
          provider: 'Test Provider',
          signInMethods: [
            { kind: 'subscription', label: 'Sign in with your account' },
            { kind: 'api_key', label: 'Use an API key' },
          ],
          apiKeyFormat: 'Starts with test-',
          install: 'installed',
          auth: 'signed_in',
          terminalResume: false,
          needsProjectTrust: false,
          permissionModes: ['ask', 'auto', 'skip_all'],
        },
        {
          agentId: 'second-agent',
          displayName: 'Second Agent',
          provider: 'Test Provider',
          signInMethods: [{ kind: 'subscription', label: 'Log in' }],
          install: 'installed',
          auth: 'needs_sign_in',
          terminalResume: false,
          needsProjectTrust: false,
          permissionModes: ['ask', 'skip_all'],
          unavailable: { code: 'agent_signed_out', reason: "Second Agent isn't signed in. Sign in in Settings → Agents.", action: 'sign_in' },
        },
      ],
      defaultAgentId: 'first-agent',
    });
  });
});

describe("an agent's readiness, from its setup (6.3)", () => {
  /** A setup port whose status the test sets; it counts its reads. */
  function setupPort(status: { install: AgentSetupStatus['install']; auth: AgentSetupStatus['auth']; subscription?: 'signed_in' | 'signed_out' | 'unknown' }) {
    const port = {
      agentId: 'some-agent',
      displayName: 'Some Agent',
      current: status,
      reads: 0,
      async status() {
        port.reads += 1;
        return { agentId: 'some-agent', displayName: 'Some Agent', version: null, ...port.current };
      },
      install: async () => ({ version: null }),
      signIn: () => Promise.reject(new Error('no sign-in here')),
    };
    return port;
  }

  it('is ready for an agent with no setup port', async () => {
    const setup = createAgentSetup(openTestCore().events, []);
    expect(await setup.readiness('test-agent', 30_000)).toEqual({ install: 'installed', auth: 'signed_in' });
  });

  it('blocks an agent that is not installed, or confirmed signed out, but never one whose sign-in it could not tell', async () => {
    let clock = 0;
    const port = setupPort({ install: 'not_installed', auth: 'needs_sign_in' });
    const setup = createAgentSetup(openTestCore().events, [port], { now: () => clock });
    expect(await setup.readiness('some-agent', 1_000)).toEqual({ install: 'not_installed', auth: 'needs_sign_in', blocked: 'agent_not_installed' });
    port.current = { install: 'installed', auth: 'needs_sign_in', subscription: 'signed_out' };
    // Read again only once the last reading is older than the limit.
    expect((await setup.readiness('some-agent', 1_000)).blocked).toBe('agent_not_installed');
    expect(port.reads).toBe(1);
    clock = 1_000;
    expect(await setup.readiness('some-agent', 1_000)).toEqual({ install: 'installed', auth: 'needs_sign_in', blocked: 'agent_signed_out' });
    port.current = { install: 'installed', auth: 'signed_in', subscription: 'signed_in' };
    clock = 2_000;
    expect(await setup.readiness('some-agent', 1_000)).toEqual({ install: 'installed', auth: 'signed_in' });
    // An agent whose sign-in it never could tell (no confirmed state to fall back on, 9.2) is not refused.
    const unsure = setupPort({ install: 'installed', auth: 'needs_sign_in', subscription: 'unknown' });
    const other = createAgentSetup(openTestCore().events, [unsure]);
    expect(await other.readiness('some-agent', 1_000)).toEqual({ install: 'installed', auth: 'needs_sign_in' });
  });

  it('never blocks on a status read that failed: nobody could tell', async () => {
    const port = setupPort({ install: 'installed', auth: 'signed_in' });
    port.status = async () => {
      throw new Error('status broke');
    };
    const setup = createAgentSetup(openTestCore().events, [port]);
    // The setup shows an agent it couldn't check as not installed (9.1), but a new chat isn't refused for it.
    expect(await setup.readiness('some-agent', 0)).toEqual({ install: 'not_installed', auth: 'needs_sign_in' });
  });
});
