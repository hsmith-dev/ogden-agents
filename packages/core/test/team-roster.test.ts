/**
 * The team roster (epic 15, story 15.5): who can take each role and why not, the defaults for a role nobody was chosen
 * for, the check every assignment passes, the install-wide default for new projects, and the manager adapter
 * addressing only the rostered workers. No agent, model, network or keychain: agents are plain data, the model port a stub.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ChatAgent, type LocalEndpointView, type TeamRoster } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  assess,
  checkRoster,
  createNewProjectDefaults,
  defaultModel,
  describeRoster,
  effectiveRoster,
  PREFERENCES_FILE,
  ValidationError,
  workersOf,
  type LocalModelPort,
  type ManagerTestResult,
  type OrchestrationChat,
  type RosterContext,
  type SecretStorePort,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const EP1 = 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const EP2 = 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W4';

const agent = (agentId: string, displayName: string, fields: Partial<ChatAgent> = {}): ChatAgent =>
  ({
    agentId,
    displayName,
    provider: 'Test',
    signInMethods: [{ kind: 'api_key', label: 'Use a key' }],
    install: 'installed',
    auth: 'signed_in',
    terminalResume: false,
    needsProjectTrust: false,
    permissionModes: ['ask'],
    ...fields,
  }) as ChatAgent;
const server = (id: string, fields: Partial<LocalEndpointView> = {}): LocalEndpointView =>
  ({ id, label: id === EP1 ? 'My Mac' : 'Company gateway', preset: null, baseUrl: 'http://localhost:1234/v1', auth: 'none', model: null, remoteConfirmedFor: null, createdAt: 't', host: 'localhost:1234', loopback: true, needsConfirmation: false, insecureRemote: false, keySaved: false, ...fields }) as LocalEndpointView;
const test = (endpointId: string, model: string, pass: boolean, message = 'The model answered with JSON, but ignored the shape it was asked for, even when asked again.'): ManagerTestResult => ({ endpointId: endpointId as never, model, pass, message });

function context(fields: Partial<Omit<RosterContext, 'tests'>> & { tests?: ManagerTestResult[] } = {}): RosterContext {
  const results = fields.tests ?? [];
  return {
    agents: [agent('alpha', 'Alpha'), agent('beta', 'Beta'), agent('gamma', 'Gamma')],
    projectDefaultAgent: undefined,
    endpoints: [],
    defaultEndpointId: null,
    mode: 'approve_each',
    ...fields,
    tests: { result: (endpointId, model) => results.find((entry) => entry.endpointId === endpointId && entry.model === model), all: () => results },
  };
}
const memorySecrets = (): SecretStorePort => {
  const values = new Map<string, string>();
  return { backend: 'memory', get: async (name) => values.get(name), set: async (name, value) => void values.set(name, value), delete: async (name) => void values.delete(name) };
};
const none: TeamRoster = { manager: null, planner: null, worker: null, reviewer: null };

describe('who can take a role (assess)', () => {
  it('an agent that is ready can be a planner, worker or reviewer, and never the manager', () => {
    const ctx = context();
    expect(assess('worker', { kind: 'agent', agentId: 'alpha' }, ctx)).toEqual({ label: 'Alpha', available: true });
    expect(assess('planner', { kind: 'agent', agentId: 'alpha' }, ctx).available).toBe(true);
    expect(assess('reviewer', { kind: 'agent', agentId: 'alpha' }, ctx).available).toBe(true);
    expect(assess('manager', { kind: 'agent', agentId: 'alpha' }, ctx)).toMatchObject({ available: false, reason: 'The manager must be a model on one of your servers, not an agent.' });
  });

  it('an agent that is not ready says why, in the agent list\'s own words', () => {
    const ctx = context({ agents: [agent('alpha', 'Alpha', { unavailable: { code: 'agent_signed_out', reason: 'Alpha is signed out. Sign in to Alpha.', action: 'sign_in' } })] });
    expect(assess('worker', { kind: 'agent', agentId: 'alpha' }, ctx)).toEqual({ label: 'Alpha', available: false, reason: 'Alpha is not ready. Alpha is signed out. Sign in to Alpha.' });
    expect(assess('worker', { kind: 'agent', agentId: 'gone' }, ctx)).toMatchObject({ available: false, reason: 'gone is not part of this install.' });
  });

  it('an agent whose vendor allows only a person is never a worker or reviewer, but may plan', () => {
    const ctx = context({ agents: [agent('cli', 'Terminal Helper', { interactiveOnly: 'Its terms allow only a person at the keyboard.' })] });
    for (const role of ['worker', 'reviewer'] as const) {
      expect(assess(role, { kind: 'agent', agentId: 'cli' }, ctx)).toEqual({ label: 'Terminal Helper', available: false, reason: 'Terminal Helper is never given instructions by a manager. Its terms allow only a person at the keyboard.' });
    }
    expect(assess('planner', { kind: 'agent', agentId: 'cli' }, ctx).available).toBe(true);
  });

  it('a subscription agent takes only instructions the user approves one by one: allowed with a note, refused when the project dispatches automatically', () => {
    const subscription = agent('sub', 'Account Agent', { signInMethods: [{ kind: 'subscription', label: 'Sign in with your account' }, { kind: 'api_key', label: 'Use a key' }] });
    const approve = assess('worker', { kind: 'agent', agentId: 'sub' }, context({ agents: [subscription] }));
    expect(approve).toEqual({ label: 'Account Agent', available: true, approveEachOnly: true, note: 'Account Agent signs in with your account, so for now it only takes instructions you approve one by one.' });
    const automatic = assess('reviewer', { kind: 'agent', agentId: 'sub' }, context({ agents: [subscription], mode: 'automatic' }));
    expect(automatic).toMatchObject({ available: false, approveEachOnly: true });
    expect(automatic.reason).toContain('Switch it to Approve each instruction');
    // An agent with keys only is not held to it.
    expect(assess('worker', { kind: 'agent', agentId: 'alpha' }, context({ mode: 'automatic' })).available).toBe(true);
  });

  it('a model needs a server that is set up and confirmed, and cannot be a worker', () => {
    const ctx = context({ endpoints: [server(EP1), server(EP2, { loopback: false, needsConfirmation: true })] });
    expect(assess('worker', { kind: 'model', endpointId: EP1 as never, model: 'm' }, ctx)).toMatchObject({ available: false, reason: 'A worker must be an agent. A model on its own cannot run commands or edit files.' });
    expect(assess('reviewer', { kind: 'model', endpointId: EP1 as never, model: 'm' }, ctx)).toEqual({ label: 'm', where: 'on this computer, on My Mac', available: true });
    expect(assess('reviewer', { kind: 'model', endpointId: EP2 as never, model: 'm' }, ctx)).toMatchObject({ available: false, reason: expect.stringContaining('Company gateway is on another computer you have not confirmed') });
    expect(assess('manager', { kind: 'model', endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W5' as never, model: 'm' }, ctx)).toMatchObject({ available: false, reason: 'Choose a model on a server you have set up.' });
  });

  it('a manager or planner model that failed Test as a manager is refused with the test\'s words; one that passed or was not tested is allowed, and says which', () => {
    const ctx = context({ endpoints: [server(EP1)], tests: [test(EP1, 'bad', false), test(EP1, 'good', true)] });
    const bad = assess('manager', { kind: 'model', endpointId: EP1 as never, model: 'bad' }, ctx);
    expect(bad).toMatchObject({ available: false });
    expect(bad.reason).toBe('bad did not pass Test as a manager. The model answered with JSON, but ignored the shape it was asked for, even when asked again.');
    expect(assess('planner', { kind: 'model', endpointId: EP1 as never, model: 'bad' }, ctx).available).toBe(false);
    expect(assess('manager', { kind: 'model', endpointId: EP1 as never, model: 'good' }, ctx)).toMatchObject({ available: true, note: 'It passed Test as a manager.' });
    const unknown = assess('manager', { kind: 'model', endpointId: EP1 as never, model: 'new' }, ctx);
    expect(unknown).toMatchObject({ available: true });
    expect(unknown.note).toContain('has not been tested as a manager since Ogden Agents started');
    // The test only matters for the roles that make plans.
    expect(assess('reviewer', { kind: 'model', endpointId: EP1 as never, model: 'bad' }, ctx).available).toBe(true);
  });

  it('every reason is plain words with no dash', () => {
    const ctx = context({ agents: [agent('cli', 'Helper', { interactiveOnly: 'Its terms allow only a person at the keyboard.', unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } })], endpoints: [server(EP2, { needsConfirmation: true })], tests: [test(EP1, 'bad', false)] });
    const reasons = [
      assess('manager', { kind: 'agent', agentId: 'cli' }, ctx),
      assess('worker', { kind: 'agent', agentId: 'cli' }, ctx),
      assess('worker', { kind: 'model', endpointId: EP2 as never, model: 'm' }, ctx),
      assess('manager', { kind: 'model', endpointId: EP2 as never, model: 'm' }, ctx),
    ].map((found) => found.reason ?? '');
    for (const reason of reasons) expect(reason).not.toMatch(/[–—]| - /);
  });
});

describe('the defaults for a role nobody was chosen for', () => {
  it('the manager and planner are the first model that passed the test, on the default server first', () => {
    const ctx = context({ endpoints: [server(EP1, { model: 'chosen' }), server(EP2)], defaultEndpointId: EP2, tests: [test(EP1, 'passed-one', true), test(EP2, 'passed-two', true)] });
    expect(defaultModel(ctx)).toEqual({ kind: 'model', endpointId: EP2, model: 'passed-two' });
    expect(effectiveRoster(none, ctx).roster).toMatchObject({ manager: { model: 'passed-two' }, planner: { model: 'passed-two' } });
  });

  it('with no passed test it is the model a server was set up with, never one that failed, and not on a server nobody confirmed', () => {
    expect(defaultModel(context({ endpoints: [server(EP1, { model: 'chosen' })] }))).toEqual({ kind: 'model', endpointId: EP1, model: 'chosen' });
    expect(defaultModel(context({ endpoints: [server(EP1, { model: 'chosen' })], tests: [test(EP1, 'chosen', false)] }))).toBeNull();
    expect(defaultModel(context({ endpoints: [server(EP1, { model: 'chosen', needsConfirmation: true })], tests: [test(EP1, 'passed', true)] }))).toBeNull();
    expect(defaultModel(context({ endpoints: [server(EP1)] }))).toBeNull();
    expect(defaultModel(context())).toBeNull();
  });

  it('a default nobody chose never points at another computer, and the newest pass wins', () => {
    const remote = server(EP2, { loopback: false, model: 'far' });
    expect(defaultModel(context({ endpoints: [remote] }))).toBeNull();
    expect(defaultModel(context({ endpoints: [remote], tests: [test(EP2, 'far', true)] }))).toEqual({ kind: 'model', endpointId: EP2, model: 'far' });
    expect(defaultModel(context({ endpoints: [server(EP1)], tests: [test(EP1, 'old', true), test(EP1, 'new', true)] }))).toEqual({ kind: 'model', endpointId: EP1, model: 'new' });
  });

  it('the worker is the project\'s default agent when it is ready, else the first agent that is', () => {
    expect(effectiveRoster(none, context({ projectDefaultAgent: 'beta' })).roster.worker).toEqual({ kind: 'agent', agentId: 'beta' });
    const notReady = agent('beta', 'Beta', { unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } });
    expect(effectiveRoster(none, context({ projectDefaultAgent: 'beta', agents: [agent('alpha', 'Alpha'), notReady] })).roster.worker).toEqual({ kind: 'agent', agentId: 'alpha' });
    expect(effectiveRoster(none, context({ agents: [notReady] })).roster.worker).toBeNull();
  });

  it('the reviewer is a different ready agent from the worker where one exists, and nobody where none does', () => {
    expect(effectiveRoster(none, context({ projectDefaultAgent: 'beta' })).roster.reviewer).toEqual({ kind: 'agent', agentId: 'alpha' });
    expect(effectiveRoster({ ...none, worker: { kind: 'agent', agentId: 'alpha' } }, context()).roster.reviewer).toEqual({ kind: 'agent', agentId: 'beta' });
    expect(effectiveRoster(none, context({ agents: [agent('alpha', 'Alpha')] })).roster.reviewer).toBeNull();
  });

  it('an agent that cannot be a worker is skipped for the default worker and reviewer', () => {
    const ctx = context({ projectDefaultAgent: 'cli', agents: [agent('cli', 'Helper', { interactiveOnly: 'Only a person.' }), agent('alpha', 'Alpha')] });
    expect(effectiveRoster(none, ctx).roster).toMatchObject({ worker: { agentId: 'alpha' }, reviewer: null });
  });

  it('a chosen role is kept, whoever else could hold it, and one holder may have several roles', () => {
    const chosen: TeamRoster = { manager: null, planner: { kind: 'agent', agentId: 'gamma' }, worker: { kind: 'agent', agentId: 'gamma' }, reviewer: { kind: 'agent', agentId: 'gamma' } };
    const found = effectiveRoster(chosen, context());
    expect(found.roster).toMatchObject({ planner: { agentId: 'gamma' }, worker: { agentId: 'gamma' }, reviewer: { agentId: 'gamma' } });
    expect(found.chosen).toEqual({ manager: false, planner: true, worker: true, reviewer: true });
  });

  it('in automatic mode a subscription agent is not a default worker', () => {
    const subscription = agent('sub', 'Account Agent', { signInMethods: [{ kind: 'subscription', label: 'x' }] });
    const ctx = (mode: 'approve_each' | 'automatic') => context({ mode, projectDefaultAgent: 'sub', agents: [subscription, agent('alpha', 'Alpha')] });
    expect(effectiveRoster(none, ctx('approve_each')).roster.worker).toEqual({ kind: 'agent', agentId: 'sub' });
    expect(effectiveRoster(none, ctx('automatic')).roster.worker).toEqual({ kind: 'agent', agentId: 'alpha' });
  });
});

describe('the roster as the screen shows it', () => {
  it('lists the four roles in order with who holds each, where it came from, and every option with its reason', () => {
    const ctx = context({ endpoints: [server(EP1, { model: 'chosen' })], tests: [test(EP1, 'passed', true), test(EP1, 'failed', false)], projectDefaultAgent: 'alpha' });
    const view = describeRoster({ ...none, reviewer: { kind: 'agent', agentId: 'gamma' } }, ctx);
    expect(view.roles.map((role) => role.role)).toEqual(['manager', 'planner', 'worker', 'reviewer']);
    const [manager, , worker, reviewer] = view.roles;
    expect(manager).toMatchObject({ source: 'default', label: 'passed on this computer, on My Mac', chosen: null });
    expect(worker).toMatchObject({ source: 'default', label: 'Alpha' });
    expect(reviewer).toMatchObject({ source: 'chosen', label: 'Gamma' });
    expect(manager!.options.filter((option) => !option.available).map((option) => option.label)).toEqual(['Alpha', 'Beta', 'Gamma', 'failed']);
    expect(manager!.options.find((option) => option.label === 'failed')!.reason).toContain('did not pass Test as a manager');
    // A model is not offered for the worker.
    expect(worker!.options.every((option) => option.assignee.kind === 'agent')).toBe(true);
    expect(view.mode).toBe('approve_each');
    expect(JSON.stringify(view)).not.toMatch(/[–—]| - /);
  });

  it('says why a role is empty, and shows a holder that stopped being ready with its reason, never swapped', () => {
    const empty = describeRoster(none, context({ agents: [] }));
    for (const role of empty.roles) expect(role).toMatchObject({ source: 'none', effective: null, label: null, empty: expect.any(String) });
    const stale = agent('alpha', 'Alpha', { unavailable: { code: 'agent_signed_out', reason: 'Alpha is signed out.', action: 'sign_in' } });
    const view = describeRoster({ ...none, worker: { kind: 'agent', agentId: 'alpha' } }, context({ agents: [stale, agent('beta', 'Beta')] }));
    expect(view.roles[2]).toMatchObject({ source: 'chosen', label: 'Alpha', problem: 'Alpha is not ready. Alpha is signed out.' });
    expect(view.workers).toEqual([{ agentId: 'alpha', label: 'Alpha', ready: false, role: 'worker' }, { agentId: 'beta', label: 'Beta', ready: true, role: 'reviewer' }]);
  });

  it('the manager addresses the worker and the reviewer when it is an agent, once each', () => {
    const roster = { manager: null, planner: null, worker: { kind: 'agent', agentId: 'alpha' }, reviewer: { kind: 'agent', agentId: 'alpha' } } as TeamRoster;
    expect(workersOf(roster, context())).toEqual([{ agentId: 'alpha', label: 'Alpha', ready: true, role: 'worker' }]);
    expect(workersOf({ ...roster, reviewer: { kind: 'model', endpointId: EP1 as never, model: 'm' } }, context({ endpoints: [server(EP1)] })).map((worker) => worker.agentId)).toEqual(['alpha']);
    expect(workersOf(none, context())).toEqual([]);
  });
});

describe('the check an assignment passes', () => {
  const ctx = context({ endpoints: [server(EP1)], tests: [test(EP1, 'bad', false)], agents: [agent('alpha', 'Alpha'), agent('cli', 'Helper', { interactiveOnly: 'Only a person.' }), agent('off', 'Off', { unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } })] });
  const refusal = (next: Partial<TeamRoster>, current: TeamRoster = none) => {
    try {
      checkRoster(current, { ...none, ...next }, ctx);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      return (error as ValidationError).message;
    }
    return undefined;
  };

  it('accepts roles that can be taken, and clearing a role', () => {
    expect(refusal({ worker: { kind: 'agent', agentId: 'alpha' }, reviewer: { kind: 'agent', agentId: 'alpha' } })).toBeUndefined();
    expect(refusal({}, { ...none, worker: { kind: 'agent', agentId: 'off' } })).toBeUndefined();
  });

  it.each([
    [{ manager: { kind: 'agent', agentId: 'alpha' } }, 'The manager must be a model on one of your servers, not an agent.'],
    [{ worker: { kind: 'model', endpointId: EP1, model: 'm' } }, 'A worker must be an agent. A model on its own cannot run commands or edit files.'],
    [{ worker: { kind: 'agent', agentId: 'off' } }, 'Off is not ready. Signed out.'],
    [{ worker: { kind: 'agent', agentId: 'cli' } }, 'Helper is never given instructions by a manager. Only a person.'],
    [{ reviewer: { kind: 'agent', agentId: 'cli' } }, 'Helper is never given instructions by a manager. Only a person.'],
    [{ manager: { kind: 'model', endpointId: EP1, model: 'bad' } }, expect.stringContaining('bad did not pass Test as a manager.')],
    [{ planner: { kind: 'model', endpointId: EP1, model: 'bad' } }, expect.stringContaining('bad did not pass Test as a manager.')],
    [{ reviewer: { kind: 'model', endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W9', model: 'x' } }, 'Choose a model on a server you have set up.'],
  ] as const)('refuses %j with its reason', (next, message) => {
    expect(refusal(next as never)).toEqual(message);
  });

  it('never re-checks a role left as it was, so something that stopped being ready never blocks another change', () => {
    const current: TeamRoster = { ...none, worker: { kind: 'agent', agentId: 'off' }, manager: { kind: 'model', endpointId: EP1 as never, model: 'bad' } };
    expect(refusal({ worker: { kind: 'agent', agentId: 'off' }, manager: { kind: 'model', endpointId: EP1 as never, model: 'bad' }, reviewer: { kind: 'agent', agentId: 'alpha' } }, current)).toBeUndefined();
  });

  it('leaves an agent this install does not have to the settings use-case, which names it', () => {
    expect(refusal({ worker: { kind: 'agent', agentId: 'nobody' } })).toBeUndefined();
  });
});

describe('the team of a project and the default for new projects', () => {
  const agents = [agent('alpha', 'Alpha'), agent('beta', 'Beta')];
  async function setUp(options: { tests?: ManagerTestResult[]; agentList?: ChatAgent[] } = {}) {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
    const endpoints = core.localEndpoints(memorySecrets());
    const defaults = createNewProjectDefaults({ dataDir, bmad: core.bmad, isAgentRegistered: (id) => ['alpha', 'beta'].includes(id) });
    const results = options.tests ?? [];
    const team = core.createTeam({
      chat: { async chatAgents() { return { agents: options.agentList ?? agents, defaultAgentId: 'alpha' }; } },
      endpoints: () => endpoints,
      tests: () => ({ result: (id, model) => results.find((entry) => entry.endpointId === id && entry.model === model), all: () => results }),
      defaults,
    });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    return { dataDir, core, endpoints, defaults, team, workspace, results };
  }

  it('a fresh project resolves to the defaults and a stored choice wins', async () => {
    const { team, workspace, core } = await setUp();
    const fresh = await team.view(workspace.id);
    expect(fresh.stored).toEqual(none);
    expect(fresh.roster.roles.map((role) => [role.role, role.label])).toEqual([['manager', null], ['planner', null], ['worker', 'Alpha'], ['reviewer', 'Beta']]);
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: { worker: { kind: 'agent', agentId: 'beta' } } });
    const chosen = await team.view(workspace.id);
    expect(chosen.roster.roles.map((role) => role.label)).toEqual([null, null, 'Beta', 'Alpha']);
    expect(await team.workers(workspace.id)).toEqual([{ agentId: 'beta', label: 'Beta', ready: true, role: 'worker' }, { agentId: 'alpha', label: 'Alpha', ready: true, role: 'reviewer' }]);
  });

  it('the project\'s own default agent is the default worker', async () => {
    const { team, workspace, core } = await setUp();
    core.permissions.updateSettings(workspace.id, { defaultAgentId: 'beta' });
    expect((await team.view(workspace.id)).roster.roles[2]).toMatchObject({ label: 'Beta', source: 'default' });
  });

  it('checks a project\'s roster against the mode it is being saved with', async () => {
    const subscription = agent('beta', 'Beta', { signInMethods: [{ kind: 'subscription', label: 'x' }] });
    const { team, workspace } = await setUp({ agentList: [agent('alpha', 'Alpha'), subscription] });
    await team.check(workspace.id, { ...none, worker: { kind: 'agent', agentId: 'beta' } });
    await expect(team.check(workspace.id, { ...none, worker: { kind: 'agent', agentId: 'beta' } }, 'automatic')).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps the default for new projects in the preferences file, appends one event, and a project added later starts with it', async () => {
    const { team, workspace, core, defaults, dataDir } = await setUp();
    expect((await team.defaultView()).stored).toEqual(none);
    const seqBefore = core.events.lastSeq();
    const saved = await team.setDefault({ worker: { kind: 'agent', agentId: 'beta' } });
    expect(saved.stored).toEqual({ ...none, worker: { kind: 'agent', agentId: 'beta' } });
    expect(JSON.parse(readFileSync(join(dataDir, PREFERENCES_FILE), 'utf8')).newProjects.orchestrationRoster.worker).toEqual({ kind: 'agent', agentId: 'beta' });
    const events = core.events.readAfter(seqBefore);
    expect(events.map((event) => event.type)).toEqual(['settings.team_roster_default_changed']);
    expect(events[0]).toMatchObject({ workspaceId: null, payload: { orchestrationRoster: { worker: { agentId: 'beta' } }, previousOrchestrationRoster: none } });
    // Saving the same roster again changes nothing and appends nothing.
    const again = core.events.lastSeq();
    await team.setDefault({ worker: { kind: 'agent', agentId: 'beta' } });
    expect(core.events.lastSeq()).toBe(again);
    // A project added now starts with it, with one settings event; the project that exists keeps its own.
    const added = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'), { orchestrationRoster: () => defaults.get().orchestrationRoster });
    expect((await team.view(added.id)).stored).toEqual({ ...none, worker: { kind: 'agent', agentId: 'beta' } });
    expect((await team.view(workspace.id)).stored).toEqual(none);
    const settingsEvents = core.events.readAfter(again).filter((event) => event.type === 'workspace.settings_changed');
    expect(settingsEvents).toHaveLength(1);
    expect(settingsEvents[0]).toMatchObject({ payload: { orchestrationRoster: { worker: { agentId: 'beta' } } } });
  });

  it('refuses a default that breaks a rule and writes nothing', async () => {
    const { team, core, dataDir } = await setUp({ tests: [test(EP1, 'bad', false)] });
    await expect(team.setDefault({ manager: { kind: 'agent', agentId: 'alpha' } })).rejects.toBeInstanceOf(ValidationError);
    await expect(team.setDefault({ worker: { kind: 'agent', agentId: 'unknown-agent' } })).rejects.toBeInstanceOf(ValidationError);
    await expect(team.setDefault('not a roster')).rejects.toBeInstanceOf(ValidationError);
    expect(existsSync(join(dataDir, PREFERENCES_FILE))).toBe(false);
    expect(core.events.readAfter(0).some((event) => event.type === 'settings.team_roster_default_changed')).toBe(false);
  });

  it('a project with no roster at all and an older preferences file read as defaults', async () => {
    const { team, workspace, defaults } = await setUp();
    expect(defaults.get()).toEqual({ bmadPieces: [] });
    expect((await team.view(workspace.id)).roster.workers).toHaveLength(2);
  });
});

describe('the manager addresses only the rostered workers (15.5)', () => {
  it('offers the manager the worker and the reviewer, not every agent, and refuses a start with no ready worker', async () => {
    const core = openTestCore(tempDir(), undefined, { orchestrationAvailable: true });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
    const list = [agent('alpha', 'Alpha'), agent('beta', 'Beta'), agent('gamma', 'Gamma')];
    let agentsNow = list;
    const chat = { listSessions: () => [], async chatAgents() { return { agents: agentsNow, defaultAgentId: 'alpha' }; } } as unknown as OrchestrationChat;
    const team = core.createTeam({ chat, endpoints: () => core.localEndpoints(memorySecrets()), tests: () => ({ result: () => undefined, all: () => [] }), defaults: createNewProjectDefaults({ dataDir: tempDir(), bmad: core.bmad }) });
    const seen: string[][] = [];
    const orchestration = core.createOrchestration({
      chat,
      team,
      manager: {
        async proposePlan(context) {
          seen.push(context.workers.map((worker) => `${worker.agentId}:${worker.ready}`));
          return { ok: false, kind: 'malformed', reason: 'No plan in this test.' };
        },
        async decideNext() {
          return { ok: false, kind: 'malformed', reason: 'unused' };
        },
      },
    });
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: { worker: { kind: 'agent', agentId: 'gamma' }, reviewer: { kind: 'agent', agentId: 'beta' } } });
    await expect(orchestration.startRun(workspace.id, { goal: 'Do it' })).rejects.toThrow();
    expect(seen).toEqual([['gamma:true', 'beta:true']]);
    // The default roster offers the default agent and a different one, not all three.
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: { worker: null, reviewer: null } });
    await expect(orchestration.startRun(workspace.id, { goal: 'Do it' })).rejects.toThrow();
    expect(seen[1]).toEqual(['alpha:true', 'beta:true']);
    // Nobody ready: refused with plain words, nothing asked of the manager.
    agentsNow = list.map((entry) => ({ ...entry, unavailable: { code: 'agent_signed_out' as const, reason: 'Signed out.', action: 'sign_in' as const } }));
    await expect(orchestration.startRun(workspace.id, { goal: 'Do it' })).rejects.toThrow(/No worker on this project's team is ready/);
    expect(seen).toHaveLength(2);
  });
});

describe('a project\'s manager follows the roster\'s defaults (15.5)', () => {
  const port: LocalModelPort = { probe: async () => ({ ok: true, models: ['m'] }), listModels: async () => ({ ok: true, models: [] }), structuredComplete: async () => ({ ok: false, kind: 'unreachable', reason: 'unused' }) };
  it('uses the default manager when none is chosen, and not a model that failed the test', async () => {
    const core = openTestCore(tempDir(), undefined, { orchestrationAvailable: true });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const endpoints = core.localEndpoints(memorySecrets());
    const added = await endpoints.add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1', model: 'chosen' });
    const results: ManagerTestResult[] = [];
    const source = core.createManagerSource({ endpoints: () => endpoints, port, tests: () => ({ result: (id, model) => results.find((entry) => entry.endpointId === id && entry.model === model), all: () => results }) });
    expect(source.status(workspace.id)).toEqual({ state: 'ready', message: 'The manager is chosen on this computer, on My Mac.' });
    // The server's own model failed the test: it is not the default, so nothing is.
    results.push(test(added.id, 'chosen', false));
    expect(source.status(workspace.id).state).toBe('not_chosen');
    expect(source.managerFor(workspace.id)).toBeUndefined();
    results.push(test(added.id, 'better', true));
    expect(source.status(workspace.id)).toEqual({ state: 'ready', message: 'The manager is better on this computer, on My Mac.' });
    // A chosen manager that failed is not used either; one chosen and untested is.
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: { kind: 'model', endpointId: added.id, model: 'chosen' } } });
    expect(source.status(workspace.id).state).toBe('test_failed');
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: { kind: 'model', endpointId: added.id, model: 'untested' } } });
    expect(source.status(workspace.id).state).toBe('ready');
  });
});
