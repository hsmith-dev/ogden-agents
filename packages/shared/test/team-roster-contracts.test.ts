/**
 * The team roster's contracts (epic 15, story 15.5): the rules that depend only on who is assigned, the roster
 * view and its routes, the default for new projects, the agent list's terms sentence and the new event. All
 * words are plain, with no dash.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  ChatAgent,
  CoreEvent,
  MANAGER_STATE_WORDS,
  MANAGER_STATES,
  modelWhere,
  NewCoreEvent,
  NewProjectDefaults,
  ROSTER_MANAGER_IS_A_MODEL,
  ROSTER_WORKER_IS_AN_AGENT,
  RosterView,
  rosterKindProblem,
  sameAssignee,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_SENTENCES,
  TEAM_ROLES,
  TeamRosterViewResponse,
  UpdateTeamRosterDefaultRequest,
  emptyRoster,
} from '../src/index.js';

const ENDPOINT = 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const agent = { kind: 'agent', agentId: 'claude-code' } as const;
const model = { kind: 'model', endpointId: ENDPOINT, model: 'a-model' } as const;

describe('the kind rules of a role', () => {
  it('the manager is a model and a worker is an agent; the planner and reviewer may be either; nobody is always allowed', () => {
    expect(rosterKindProblem('manager', agent)).toBe(ROSTER_MANAGER_IS_A_MODEL);
    expect(rosterKindProblem('worker', model)).toBe(ROSTER_WORKER_IS_AN_AGENT);
    expect(rosterKindProblem('manager', model)).toBeUndefined();
    expect(rosterKindProblem('worker', agent)).toBeUndefined();
    for (const role of ['planner', 'reviewer'] as const) {
      expect(rosterKindProblem(role, agent)).toBeUndefined();
      expect(rosterKindProblem(role, model)).toBeUndefined();
    }
    for (const role of TEAM_ROLES) expect(rosterKindProblem(role, null)).toBeUndefined();
  });

  it('names each role and says what it does, in plain words', () => {
    expect(TEAM_ROLES.map((role) => TEAM_ROLE_LABELS[role])).toEqual(['Manager', 'Planner', 'Worker', 'Reviewer']);
    for (const text of [...Object.values(TEAM_ROLE_SENTENCES), ROSTER_MANAGER_IS_A_MODEL, ROSTER_WORKER_IS_AN_AGENT, modelWhere(true, 'My Mac'), modelWhere(false, 'Gateway'), ...Object.values(MANAGER_STATE_WORDS)]) {
      expect(text).not.toMatch(/[–—]| - /);
    }
    expect(modelWhere(true, 'My Mac')).toBe('on this computer, on My Mac');
    expect(modelWhere(false, 'Gateway')).toBe('on another computer, on Gateway');
  });

  it('compares assignees by who they are', () => {
    expect(sameAssignee(null, null)).toBe(true);
    expect(sameAssignee(null, agent)).toBe(false);
    expect(sameAssignee(agent, { ...agent })).toBe(true);
    expect(sameAssignee(agent, { kind: 'agent', agentId: 'codex' })).toBe(false);
    expect(sameAssignee(model, { ...model })).toBe(true);
    expect(sameAssignee(model, { ...model, model: 'other' })).toBe(false);
    expect(sameAssignee(model, agent)).toBe(false);
  });

  it('the manager can also be not ready because it failed its test, with words for it', () => {
    expect(MANAGER_STATES).toContain('test_failed');
    expect(MANAGER_STATE_WORDS.test_failed).toContain('did not pass Test as a manager');
  });
});

describe('the roster view and its routes', () => {
  const role = (name: string) => ({ role: name, chosen: null, effective: null, source: 'none', label: null, empty: 'Nobody.', options: [] });
  const view = { mode: 'approve_each', workers: [{ agentId: 'claude-code', label: 'Claude Code', ready: true, role: 'worker' }], roles: TEAM_ROLES.map(role) };

  it('parses a view of four roles, and refuses a view of another count', () => {
    expect(RosterView.parse(view).roles).toHaveLength(4);
    expect(() => RosterView.parse({ ...view, roles: view.roles.slice(0, 3) })).toThrow();
    expect(TeamRosterViewResponse.parse({ roster: view, stored: emptyRoster() }).stored).toEqual(emptyRoster());
  });

  it('an option carries its reason only as text, and an unknown field is dropped from the view', () => {
    const parsed = RosterView.parse({ ...view, roles: [{ ...role('manager'), options: [{ assignee: agent, label: 'Claude Code', available: false, reason: ROSTER_MANAGER_IS_A_MODEL, secret: 'x' }] }, ...view.roles.slice(1)] });
    expect(parsed.roles[0]!.options[0]).toEqual({ assignee: agent, label: 'Claude Code', available: false, reason: ROSTER_MANAGER_IS_A_MODEL });
  });

  it('the default roster is a roster and nothing else', () => {
    expect(UpdateTeamRosterDefaultRequest.parse({ roster: { worker: agent } }).roster).toEqual({ ...emptyRoster(), worker: agent });
    expect(() => UpdateTeamRosterDefaultRequest.parse({ roster: emptyRoster(), extra: 1 })).toThrow();
    expect(() => UpdateTeamRosterDefaultRequest.parse({ roster: { worker: 'claude-code' } })).toThrow();
    expect(API_ROUTES.workspaceTeamRoster).toBe('/api/v1/workspaces/:wsId/orchestration/roster');
    expect(API_ROUTES.teamRosterDefault).toBe('/api/v1/settings/team-roster');
  });
});

describe('what an older reader still reads', () => {
  it('the default for new projects reads with or without a roster', () => {
    expect(NewProjectDefaults.parse({ bmadPieces: [] })).toEqual({ bmadPieces: [] });
    expect(NewProjectDefaults.parse({ bmadPieces: [], orchestrationRoster: { worker: agent } }).orchestrationRoster).toEqual({ ...emptyRoster(), worker: agent });
  });

  it('the agent list reads with or without the terms sentence', () => {
    const base = { agentId: 'a-agent', displayName: 'A', provider: 'P', signInMethods: [], install: 'installed', auth: 'signed_in', terminalResume: false, needsProjectTrust: false, permissionModes: ['ask'] };
    expect(ChatAgent.parse(base).interactiveOnly).toBeUndefined();
    expect(ChatAgent.parse({ ...base, interactiveOnly: 'Its terms allow only a person at the keyboard.' }).interactiveOnly).toBe('Its terms allow only a person at the keyboard.');
    expect(() => ChatAgent.parse({ ...base, interactiveOnly: '' })).toThrow();
  });

  it('the event for the default roster is install level and carries both rosters', () => {
    const input = { type: 'settings.team_roster_default_changed', workspaceId: null, streamId: 'settings', payload: { orchestrationRoster: { ...emptyRoster(), worker: agent }, previousOrchestrationRoster: emptyRoster() } };
    expect(NewCoreEvent.parse(input).type).toBe('settings.team_roster_default_changed');
    expect(CoreEvent.parse({ ...input, id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 1, at: '2026-10-05T00:00:00.000Z' }).type).toBe('settings.team_roster_default_changed');
    expect(() => NewCoreEvent.parse({ ...input, workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' })).toThrow();
  });
});
