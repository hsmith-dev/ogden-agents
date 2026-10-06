/**
 * A project's manager (epic 15, story 15.4): read from its roster, `manager`
 * role, each time it is asked. Its state is told in plain words (not chosen,
 * server gone, host not confirmed, ready), a run with no usable manager stores
 * nothing, a ready one plans through the endpoint's model, and the manager's
 * masked answer is recorded in the event log. No model, agent or keychain.
 */
import { MANAGER_PLAN_VERSION, MANAGER_STATE_WORDS, type ManagerPlan, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { ManagerFailedError, ManagerUnavailableError, type LocalModelPort, type OrchestrationChat, type StructuredRequest, type StructuredResult } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const PLAN: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form',
  steps: [{ id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] }],
};

function setUp(reply: (request: StructuredRequest) => StructuredResult = () => ({ ok: true, value: PLAN, mode: 'json_schema' })) {
  const core = openTestCore(tempDir(), undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  const values = new Map<string, string>();
  const secrets = { values, backend: 'memory' as const, get: async (name: string) => values.get(name), set: async (name: string, value: string) => void values.set(name, value), delete: async (name: string) => void values.delete(name) };
  const endpoints = core.localEndpoints(secrets);
  const calls: string[] = [];
  const port: LocalModelPort = {
    probe: async () => ({ ok: true, models: ['m'] }),
    listModels: async () => ({ ok: true, models: [{ id: 'm', contextTokens: 16_384 }] }),
    async structuredComplete(target, request) {
      calls.push(target.baseUrl);
      return reply(request);
    },
  };
  const source = core.createManagerSource({ endpoints: () => endpoints, port });
  const chat = {
    listSessions: () => [],
    async chatAgents() {
      return { defaultAgentId: 'claude-code', agents: [{ agentId: 'claude-code', displayName: 'Claude Code', permissionModes: ['ask'] }] } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
  } as unknown as OrchestrationChat;
  const orchestration = core.createOrchestration({ chat, managers: source });
  const choose = (endpointId: string | null, model = 'm') => core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: endpointId === null ? null : { kind: 'model', endpointId, model } } });
  return { core, workspace, endpoints, source, orchestration, choose, calls };
}

describe('the state of a project\'s manager', () => {
  it('is not chosen until the roster names a model, and says so in plain words', () => {
    const { workspace, source, orchestration } = setUp();
    expect(source.status(workspace.id)).toEqual({ state: 'not_chosen', message: MANAGER_STATE_WORDS.not_chosen });
    expect(source.managerFor(workspace.id)).toBeUndefined();
    expect(orchestration.managerStatus(workspace.id)).toMatchObject({ state: 'not_chosen' });
  });

  it('is ready on a server on this computer, and says which model runs where', async () => {
    const { workspace, endpoints, choose, source } = setUp();
    const endpoint = await endpoints.add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' });
    choose(endpoint.id, 'a-model');
    expect(source.status(workspace.id)).toEqual({ state: 'ready', message: 'The manager is a-model on this computer, on My Mac.' });
    expect(source.managerFor(workspace.id)).toBeDefined();
  });

  it('is not ready on another computer until the user confirms it, and ready after', async () => {
    const { workspace, endpoints, choose, source } = setUp();
    const far = await endpoints.add({ label: 'Company gateway', baseUrl: 'https://gateway.example.com/v1', confirmHost: 'https://gateway.example.com' });
    choose(far.id);
    expect(source.status(workspace.id)).toMatchObject({ state: 'ready', message: expect.stringContaining('on another computer') });
    const moved = await endpoints.update(far.id, { baseUrl: 'https://elsewhere.example.com/v1' });
    expect(source.status(workspace.id)).toEqual({ state: 'host_not_confirmed', message: MANAGER_STATE_WORDS.host_not_confirmed });
    expect(source.managerFor(workspace.id)).toBeUndefined();
    endpoints.confirm(moved.id, { host: 'https://elsewhere.example.com' });
    expect(source.status(workspace.id).state).toBe('ready');
  });

  it('is endpoint missing when the chosen server is removed, with its words, and the roster is not rewritten', async () => {
    const { workspace, endpoints, choose, source, core } = setUp();
    const endpoint = await endpoints.add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' });
    choose(endpoint.id);
    await endpoints.remove(endpoint.id);
    expect(source.status(workspace.id)).toEqual({ state: 'endpoint_missing', message: MANAGER_STATE_WORDS.endpoint_missing });
    expect(core.permissions.getSettings(workspace.id).orchestrationRoster?.manager).toMatchObject({ kind: 'model', endpointId: endpoint.id });
  });

  it('reads an agent in the manager role as not chosen (the role is a model, never an agent)', async () => {
    const { workspace, core, source } = setUp();
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: { worker: { kind: 'agent', agentId: 'claude-code' } } });
    expect(source.status(workspace.id).state).toBe('not_chosen');
  });
});

describe('a run with the real manager', () => {
  it('stores nothing and says the state in plain words when the manager is not usable', async () => {
    const { workspace, core, orchestration } = setUp();
    const before = core.events.lastSeq();
    const refused = await orchestration.startRun(workspace.id, { goal: 'Add a form' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ManagerUnavailableError);
    expect((refused as Error).message).toBe(MANAGER_STATE_WORDS.not_chosen);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('plans through the chosen model, and records the answer and how it went in the event log', async () => {
    const { workspace, endpoints, choose, orchestration, core, calls } = setUp(() => ({ ok: true, value: PLAN, mode: 'json_object' }));
    const endpoint = await endpoints.add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' });
    choose(endpoint.id);
    const before = core.events.lastSeq();
    const view = await orchestration.startRun(workspace.id, { goal: 'Add a contact form' });
    expect(view.steps.map((step) => [step.stepId, step.state])).toEqual([['s1', 'proposed']]);
    expect(calls).toEqual(['http://localhost:1234/v1']);
    const events = core.events.readAfter(before);
    expect(events.map((event) => event.type)).toEqual(['orchestration.run_started', 'orchestration.manager_replied', 'orchestration.plan_proposed', 'orchestration.step_proposed']);
    const replied = events.find((event) => event.type === 'orchestration.manager_replied')!;
    expect(replied.payload).toMatchObject({ call: 'plan', outcome: 'accepted', asked: 'json_object', repaired: false });
    expect(JSON.parse((replied.payload as { output: string }).output)).toMatchObject({ version: MANAGER_PLAN_VERSION });
  });

  it('keeps a failed run with the reason, and records the refusal and its rule, when the manager breaks the rules twice', async () => {
    const offRoster = { ...PLAN, steps: [{ ...PLAN.steps[0]!, worker: 'rogue' }] };
    const { workspace, endpoints, choose, orchestration, core } = setUp(() => ({ ok: true, value: offRoster, mode: 'json_schema' }));
    choose((await endpoints.add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' })).id);
    const before = core.events.lastSeq();
    await expect(orchestration.startRun(workspace.id, { goal: 'Add a form' })).rejects.toBeInstanceOf(ManagerFailedError);
    const [started, replied, stopped] = core.events.readAfter(before);
    expect([started!.type, replied!.type, stopped!.type]).toEqual(['orchestration.run_started', 'orchestration.manager_replied', 'orchestration.run_stopped']);
    expect(replied!.payload).toMatchObject({ outcome: 'refused', repaired: true, failure: 'off_roster', code: 'off_roster_worker' });
    expect((await orchestration.listRuns(workspace.id))[0]!.steps).toEqual([]);
  });

  it('refuses a host that lost its confirmation after the settings page showed it ready, with nothing dispatched', async () => {
    const { workspace, endpoints, choose, orchestration, calls } = setUp();
    const far = await endpoints.add({ label: 'Gateway', baseUrl: 'https://gateway.example.com/v1', confirmHost: 'https://gateway.example.com' });
    choose(far.id);
    await endpoints.update(far.id, { baseUrl: 'https://elsewhere.example.com/v1' });
    await expect(orchestration.startRun(workspace.id, { goal: 'Add a form' })).rejects.toThrow(MANAGER_STATE_WORDS.host_not_confirmed);
    expect(calls).toEqual([]);
  });

  it('is its own project\'s manager: another project with no model chosen has none', async () => {
    const { core, workspace, endpoints, choose, orchestration } = setUp();
    choose((await endpoints.add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' })).id);
    const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(other.id, { orchestrationEnabled: true });
    expect(orchestration.managerStatus(workspace.id).state).toBe('ready');
    expect(orchestration.managerStatus(other.id as WorkspaceId).state).toBe('not_chosen');
  });
});
