/**
 * Core's permissions (story 2.6): a request holds the tool call and moves
 * the session to `waiting` until the user decides; an always-allow rule is
 * stored per workspace and answers later matching requests in code; nothing
 * is ever allowed but by a decision or a rule, and every cancel, failure or
 * unknown state declines.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CoreEvent, SessionId, WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { alwaysAllowRefusal, CAUTION_LEVELS, TOOL_KINDS, type CautionLevel, type ToolKind } from '@ogden-agents/shared';
import {
  alwaysAllowScope,
  cautionAllows,
  commandNamesProtectedPath,
  isProtectedSegment,
  commandPrefix,
  createDecliningPermissions,
  isCaseInsensitivePath,
  NotFoundError,
  PermissionNotPendingError,
  pathsInsideWorkspace,
  ruleMatches,
  ValidationError,
  type AgentPermissionDecision,
  type AgentPermissionRequest,
  type Core,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/** A workspace with a chat session in it, `working` as during a turn. */
function workingSession(core: Core) {
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
  core.entities.setSessionState(session.id, 'working');
  return { workspace, session };
}

const npm = (command: string): AgentPermissionRequest => ({ toolCallId: `t-${command}`, title: `Run ${command}`, kind: 'execute', command });

/** The session's permission events. */
const permissionEvents = (core: Core, sessionId: SessionId) =>
  core.events.readAfter(0).filter((event) => event.streamId === sessionId && event.type.startsWith('permission.'));

const lastRequested = (core: Core, sessionId: SessionId) => {
  const event = permissionEvents(core, sessionId).filter((e) => e.type === 'permission.requested').at(-1);
  if (event?.type !== 'permission.requested') throw new Error('no permission.requested');
  return event;
};

/** Tracks whether a request's promise has settled. */
function track(promise: Promise<AgentPermissionDecision>) {
  const state: { decision: AgentPermissionDecision | undefined } = { decision: undefined };
  void promise.then((decision) => (state.decision = decision));
  return state;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('asking', () => {
  it('appends permission.requested, moves the session to waiting and holds the tool call until Allow once', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const asked = track(core.permissions.request(session.id, npm('npm test')));
    await flush();

    const requested = lastRequested(core, session.id);
    expect(requested.payload).toMatchObject({
      sessionId: session.id,
      toolCall: { toolCallId: 't-npm test', title: 'Run npm test', kind: 'execute', command: 'npm test' },
      alwaysAllowScope: { kind: 'command_prefix', value: 'npm test', label: 'npm test' },
      cautionLevel: 'ask_every_time',
    });
    expect(requested.payload.requestId).toMatch(/^preq_[0-9A-Z]{26}$/);
    expect(core.entities.getSession(session.id)?.state).toBe('waiting');
    expect(asked.decision).toBeUndefined();

    core.permissions.decide(workspace.id, session.id, requested.payload.requestId, { decision: 'allow_once' });
    await flush();
    expect(asked.decision).toEqual({ outcome: 'allow_once' });
    expect(core.entities.getSession(session.id)?.state).toBe('working');
    expect(permissionEvents(core, session.id).at(-1)?.payload).toEqual({
      sessionId: session.id,
      requestId: requested.payload.requestId,
      decision: 'allow_once',
      by: 'user',
    });
  });

  it('Deny records its reason in permission.resolved and hands it to core (sent after the turn; story 2.10)', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const asked = track(core.permissions.request(session.id, npm('rm -rf build')));
    const { requestId } = lastRequested(core, session.id).payload;

    expect(() => core.permissions.decide(workspace.id, session.id, requestId, { decision: 'deny', reason: 'x'.repeat(2001) })).toThrow(ValidationError);
    expect(core.entities.getSession(session.id)?.state).toBe('waiting');

    core.permissions.decide(workspace.id, session.id, requestId, { decision: 'deny', reason: 'Use the clean script instead.' });
    await flush();
    expect(asked.decision).toEqual({ outcome: 'deny', reason: 'Use the clean script instead.' });
    expect(permissionEvents(core, session.id).at(-1)?.payload).toMatchObject({ decision: 'deny', by: 'user', reason: 'Use the clean script instead.' });
  });

  it('a stale answer changes nothing: decided, unknown, another session or another workspace is 409', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const other = workingSession(core);
    void core.permissions.request(session.id, npm('npm test'));
    const { requestId } = lastRequested(core, session.id).payload;
    const before = core.events.lastSeq();

    expect(() => core.permissions.decide(workspace.id, other.session.id, requestId, { decision: 'allow_once' })).toThrow(PermissionNotPendingError);
    expect(() => core.permissions.decide(other.workspace.id, session.id, requestId, { decision: 'allow_once' })).toThrow(PermissionNotPendingError);
    expect(() => core.permissions.decide(workspace.id, session.id, 'preq_unknown', { decision: 'allow_once' })).toThrow(PermissionNotPendingError);
    expect(core.events.lastSeq()).toBe(before);

    core.permissions.decide(workspace.id, session.id, requestId, { decision: 'deny' });
    const decided = core.events.lastSeq();
    expect(() => core.permissions.decide(workspace.id, session.id, requestId, { decision: 'allow_once' })).toThrow(PermissionNotPendingError);
    expect(core.events.lastSeq()).toBe(decided);
  });

  it('two requests at once: deciding one keeps the session waiting for the other', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const first = track(core.permissions.request(session.id, npm('npm test')));
    const firstId = lastRequested(core, session.id).payload.requestId;
    const second = track(core.permissions.request(session.id, npm('npm run lint')));
    const secondId = lastRequested(core, session.id).payload.requestId;

    core.permissions.decide(workspace.id, session.id, firstId, { decision: 'allow_once' });
    await flush();
    expect(first.decision).toEqual({ outcome: 'allow_once' });
    expect(second.decision).toBeUndefined();
    expect(core.entities.getSession(session.id)?.state).toBe('waiting');

    core.permissions.decide(workspace.id, session.id, secondId, { decision: 'deny' });
    await flush();
    expect(second.decision).toEqual({ outcome: 'deny' });
    expect(core.entities.getSession(session.id)?.state).toBe('working');
  });

  it('a decision that fails to record declines the request and lets the session out of waiting, unless another request still holds it', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const original = core.sessionEvents.appendSessionEvent.bind(core.sessionEvents);
    let failNext = false;
    core.sessionEvents.appendSessionEvent = ((sessionId, event) => {
      if (failNext && event.type === 'permission.resolved' && event.payload.by === 'user') {
        failNext = false;
        throw new Error('disk full');
      }
      return original(sessionId, event);
    }) as typeof core.sessionEvents.appendSessionEvent;

    const first = track(core.permissions.request(session.id, npm('npm test')));
    const firstId = lastRequested(core, session.id).payload.requestId;
    const second = track(core.permissions.request(session.id, npm('npm run lint')));
    const secondId = lastRequested(core, session.id).payload.requestId;

    failNext = true;
    expect(() => core.permissions.decide(workspace.id, session.id, firstId, { decision: 'allow_once' })).toThrow('disk full');
    await flush();
    expect(first.decision).toEqual({ outcome: 'deny' });
    expect(permissionEvents(core, session.id).at(-1)?.payload).toMatchObject({ requestId: firstId, by: 'cancelled' });
    // The other request still holds the session.
    expect(core.entities.getSession(session.id)?.state).toBe('waiting');
    expect(second.decision).toBeUndefined();

    failNext = true;
    expect(() => core.permissions.decide(workspace.id, session.id, secondId, { decision: 'allow_always' })).toThrow('disk full');
    await flush();
    expect(second.decision).toEqual({ outcome: 'deny' });
    expect(core.entities.getSession(session.id)?.state).toBe('working');
    expect(core.permissions.listRules(workspace.id)).toEqual([]);
  });

  it('an unknown session, or one with no turn running, is declined without asking', async () => {
    const core = openTestCore();
    const { session } = workingSession(core);
    expect(await core.permissions.request('ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as SessionId, npm('npm test'))).toEqual({ outcome: 'deny' });
    core.entities.setSessionState(session.id, 'idle');
    expect(await core.permissions.request(session.id, npm('npm test'))).toEqual({ outcome: 'cancelled' });
    expect(permissionEvents(core, session.id).map((e) => [e.type, (e.payload as { by?: string }).by])).toEqual([
      ['permission.requested', undefined],
      ['permission.resolved', 'cancelled'],
    ]);
    expect(core.entities.getSession(session.id)?.state).toBe('idle');
  });

  it('a request that fails its schema is declined, and nothing is stored', async () => {
    const core = openTestCore();
    const { session } = workingSession(core);
    const before = core.events.lastSeq();
    expect(await core.permissions.request(session.id, { toolCallId: '', title: 'Run it', kind: 'execute', command: 'ls' })).toEqual({ outcome: 'deny' });
    expect(core.events.lastSeq()).toBe(before);
    expect(core.entities.getSession(session.id)?.state).toBe('working');
  });
});

describe('leaving waiting', () => {
  it('cancels the pending request when the session goes idle or error, and records by:cancelled', async () => {
    for (const state of ['idle', 'error'] as const) {
      const core = openTestCore();
      const { workspace, session } = workingSession(core);
      const asked = track(core.permissions.request(session.id, npm('npm test')));
      const { requestId } = lastRequested(core, session.id).payload;
      core.entities.setSessionState(session.id, state, { reason: 'Claude Code stopped unexpectedly.' });
      await flush();
      expect(asked.decision).toEqual({ outcome: 'cancelled' });
      expect(permissionEvents(core, session.id).at(-1)?.payload).toMatchObject({ requestId, decision: 'deny', by: 'cancelled' });
      expect(() => core.permissions.decide(workspace.id, session.id, requestId, { decision: 'allow_once' })).toThrow(PermissionNotPendingError);
    }
  });

  it('a live subscriber sees the state change before the cancellation', async () => {
    const core = openTestCore();
    const { session } = workingSession(core);
    const seen: CoreEvent[] = [];
    core.events.subscribe(core.events.lastSeq(), (event) => seen.push(event));
    void core.permissions.request(session.id, npm('npm test'));
    core.entities.setSessionState(session.id, 'idle');
    await flush();
    const seqs = seen.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seen.map((e) => e.type)).toEqual(['permission.requested', 'session.state_changed', 'session.state_changed', 'permission.resolved']);
  });

  it('deleting the history cancels its pending requests; closing core cancels the rest', async () => {
    const core = openTestCore();
    const a = workingSession(core);
    const b = workingSession(core);
    const inA = track(core.permissions.request(a.session.id, npm('npm test')));
    const inB = track(core.permissions.request(b.session.id, npm('npm test')));
    core.events.deleteWorkspaceHistory(a.workspace.id);
    await flush();
    expect(inA.decision).toEqual({ outcome: 'cancelled' });
    expect(inB.decision).toBeUndefined();
    core.permissions.close();
    await flush();
    expect(inB.decision).toEqual({ outcome: 'cancelled' });
    expect(await core.permissions.request(b.session.id, npm('npm test'))).toEqual({ outcome: 'cancelled' });
  });
});

describe('always-allow rules', () => {
  it('Always allow stores the rule with its event and tells the agent allow_once; a later request in scope runs without waiting', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const asked = track(core.permissions.request(session.id, npm('npm install stripe')));
    const { requestId } = lastRequested(core, session.id).payload;
    core.permissions.decide(workspace.id, session.id, requestId, { decision: 'allow_always' });
    await flush();
    expect(asked.decision).toEqual({ outcome: 'allow_once' });

    const [rule] = core.permissions.listRules(workspace.id);
    expect(rule).toMatchObject({ workspaceId: workspace.id, scope: { kind: 'command_prefix', value: 'npm install', label: 'npm install' } });
    expect(rule!.id).toMatch(/^rule_[0-9A-Z]{26}$/);
    const added = core.events.readAfter(0).find((e) => e.type === 'workspace.permission_rule_added');
    expect(added).toMatchObject({ workspaceId: workspace.id, streamId: workspace.id, payload: { ruleId: rule!.id } });
    expect(permissionEvents(core, session.id).at(-1)?.payload).toMatchObject({ decision: 'allow_always', by: 'user', ruleId: rule!.id });

    const states: string[] = [];
    core.events.subscribe(core.events.lastSeq(), (e) => {
      if (e.type === 'session.state_changed') states.push(e.payload.state);
    });
    expect(await core.permissions.request(session.id, npm('npm install lodash'))).toEqual({ outcome: 'allow_once' });
    expect(permissionEvents(core, session.id).slice(-2).map((e) => [e.type, e.payload])).toEqual([
      ['permission.requested', expect.objectContaining({ toolCall: expect.objectContaining({ command: 'npm install lodash' }) })],
      ['permission.resolved', expect.objectContaining({ decision: 'allow_once', by: 'rule', ruleId: rule!.id })],
    ]);
    expect(states).toEqual([]);
  });

  it('a compound command, another prefix, or another workspace is still asked', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const other = workingSession(core);
    void core.permissions.request(session.id, npm('npm install stripe'));
    core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'allow_always' });

    for (const command of ['npm install x && rm -rf ~', 'npm install x; rm -rf ~', 'npm install $(curl evil)', 'npm install `id`', 'npm install x > out', 'npm installer', 'npx install']) {
      const asked = track(core.permissions.request(session.id, npm(command)));
      await flush();
      expect(asked.decision, command).toBeUndefined();
      expect(core.entities.getSession(session.id)?.state).toBe('waiting');
      core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'deny' });
    }
    const elsewhere = track(core.permissions.request(other.session.id, npm('npm install lodash')));
    await flush();
    expect(elsewhere.decision).toBeUndefined();
    expect(core.entities.getSession(other.session.id)?.state).toBe('waiting');
  });

  it('Always allow is refused for a request without a scope, and the request stays pending', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const asked = track(core.permissions.request(session.id, { toolCallId: 't1', title: 'Do something', kind: 'mystery' }));
    const requested = lastRequested(core, session.id);
    expect(requested.payload.toolCall.kind).toBe('other');
    expect(requested.payload.alwaysAllowScope).toBeNull();
    expect(() => core.permissions.decide(workspace.id, session.id, requested.payload.requestId, { decision: 'allow_always' })).toThrow(ValidationError);
    await flush();
    expect(asked.decision).toBeUndefined();
    expect(core.permissions.listRules(workspace.id)).toEqual([]);
  });

  it('undo removes the rule with its event, and the next request asks; unknown or another workspace’s rule is not found', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const other = workingSession(core);
    void core.permissions.request(session.id, { toolCallId: 't1', title: 'Edit src/a.ts', kind: 'edit', paths: ['src/a.ts'] });
    core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'allow_always' });
    const [rule] = core.permissions.listRules(workspace.id);
    expect(rule?.scope).toEqual({ kind: 'tool', value: 'edit', label: 'Editing files' });
    expect(await core.permissions.request(session.id, { toolCallId: 't2', title: 'Edit src/b.ts', kind: 'edit', paths: ['src/b.ts'] })).toEqual({ outcome: 'allow_once' });

    expect(() => core.permissions.removeRule(other.workspace.id, rule!.id)).toThrow(NotFoundError);
    core.permissions.removeRule(workspace.id, rule!.id);
    expect(core.events.readAfter(0).at(-1)).toMatchObject({ type: 'workspace.permission_rule_removed', workspaceId: workspace.id, payload: { ruleId: rule!.id } });
    expect(() => core.permissions.removeRule(workspace.id, rule!.id)).toThrow(NotFoundError);
    expect(core.permissions.listRules(workspace.id)).toEqual([]);

    const asked = track(core.permissions.request(session.id, { toolCallId: 't3', title: 'Edit src/c.ts', kind: 'edit', paths: ['src/c.ts'] }));
    await flush();
    expect(asked.decision).toBeUndefined();
  });

  it('rules survive Delete history, and an unknown workspace has none to list', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    void core.permissions.request(session.id, npm('npm test'));
    core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'allow_always' });
    core.events.deleteWorkspaceHistory(workspace.id);
    expect(core.permissions.listRules(workspace.id)).toHaveLength(1);
    expect(() => core.permissions.listRules('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId)).toThrow(NotFoundError);
  });

  it('survive a restart of core', async () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir);
    const { workspace, session } = workingSession(first);
    void first.permissions.request(session.id, npm('npm test'));
    first.permissions.decide(workspace.id, session.id, lastRequested(first, session.id).payload.requestId, { decision: 'allow_always' });
    first.close();
    const second = openTestCore(dataDir);
    expect(second.permissions.listRules(workspace.id).map((rule) => rule.scope.value)).toEqual(['npm test']);
  });
});

describe('scope and matching', () => {
  it('takes the command and its subcommand, or the first word before a flag or a path', () => {
    expect(commandPrefix('npm install stripe')).toBe('npm install');
    expect(commandPrefix('  git   commit -m "x"')).toBe('git commit');
    expect(commandPrefix('ls -la')).toBe('ls');
    expect(commandPrefix('cat ./README.md')).toBe('cat');
    expect(commandPrefix('cat src/a.ts')).toBe('cat');
    expect(commandPrefix('type C:\\a.txt')).toBe('type');
    expect(commandPrefix('cd ~')).toBe('cd');
    expect(commandPrefix('pwd')).toBe('pwd');
    expect(commandPrefix('   ')).toBeUndefined();
  });

  it('offers a scope for every named kind but other, and for execute only with a command', () => {
    expect(alwaysAllowScope('execute', 'npm test')).toEqual({ kind: 'command_prefix', value: 'npm test', label: 'npm test' });
    expect(alwaysAllowScope('execute', undefined)).toBeNull();
    expect(alwaysAllowScope('other', undefined)).toBeNull();
    expect(alwaysAllowScope('read', undefined)).toEqual({ kind: 'tool', value: 'read', label: 'Reading files' });
  });

  it('never matches shell syntax, and matches command prefixes by whole words', () => {
    const rule = { kind: 'command_prefix', value: 'npm install' } as const;
    expect(ruleMatches(rule, 'execute', 'npm install')).toBe(true);
    expect(ruleMatches(rule, 'execute', 'npm install lodash --save-dev')).toBe(true);
    for (const command of ['npm install a | sh', 'npm install a & b', 'npm install a\nrm x', 'npm install < x', 'npm install a || b']) {
      expect(ruleMatches(rule, 'execute', command), command).toBe(false);
    }
    expect(ruleMatches(rule, 'edit', 'npm install')).toBe(false);
    expect(ruleMatches({ kind: 'tool', value: 'edit' }, 'edit', undefined, true)).toBe(true);
    expect(ruleMatches({ kind: 'tool', value: 'edit' }, 'edit', undefined)).toBe(false);
    expect(ruleMatches({ kind: 'tool', value: 'fetch' }, 'fetch', undefined)).toBe(true);
    expect(ruleMatches({ kind: 'tool', value: 'edit' }, 'read', undefined)).toBe(false);
    expect(ruleMatches({ kind: 'tool', value: 'edit' }, 'edit', 'x; y')).toBe(false);
  });

  it('never matches ${…}, other control characters or whitespace other than spaces and tabs', () => {
    const rule = { kind: 'command_prefix', value: 'npm install' } as const;
    expect(ruleMatches(rule, 'execute', 'npm\tinstall  lodash')).toBe(true);
    for (const command of [
      'npm install ${HOME}',
      'npm install\u00a0lodash',
      'npm install\u2028rm -rf ~',
      'npm install\u2029x',
      'npm install\vx',
      'npm install\fx',
      'npm install\u0000x',
      'npm install\u001bx',
      'npm install\u007fx',
      'npm install\u0085x',
      'npm install\u200bx',
      'npm install\u3000x',
      'npm install\ufeffx',
    ]) {
      expect(ruleMatches(rule, 'execute', command), JSON.stringify(command)).toBe(false);
    }
  });

  it('never matches a masked command', () => {
    expect(ruleMatches({ kind: 'command_prefix', value: 'npm install' }, 'execute', 'npm install --token [redacted]')).toBe(false);
    expect(ruleMatches({ kind: 'tool', value: 'fetch' }, 'fetch', 'curl -H [redacted]')).toBe(false);
  });
});

describe('file-kind rules stay inside the project (review F1)', () => {
  /** A project with `src/a.ts`, a folder outside it, and a link inside it that escapes to that folder. */
  function project() {
    const repo = tempDir('ogden-agents-repo-');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.ts'), 'a');
    const outside = tempDir('ogden-agents-outside-');
    writeFileSync(join(outside, 'secret.txt'), 's');
    // A junction on Windows needs no privilege; elsewhere it is a plain symlink.
    symlinkSync(outside, join(repo, 'escape'), 'junction');
    return { repo, outside, workspace: { path: repo, realPath: repo } };
  }

  it('matches only when every named path resolves inside the workspace', () => {
    const { repo, outside, workspace } = project();
    expect(pathsInsideWorkspace(workspace, [join(repo, 'src', 'a.ts')])).toBe(true);
    expect(pathsInsideWorkspace(workspace, ['src/a.ts', 'src/new/b.ts', '.'])).toBe(true);
    expect(pathsInsideWorkspace(workspace, ['~/.ssh/x'])).toBe(false);
    expect(pathsInsideWorkspace(workspace, [join(homedir(), '.ssh', 'x')])).toBe(false);
    expect(pathsInsideWorkspace(workspace, ['../outside'])).toBe(false);
    expect(pathsInsideWorkspace(workspace, ['src/../../x'])).toBe(false);
    expect(pathsInsideWorkspace(workspace, [join(outside, 'secret.txt')])).toBe(false);
    expect(pathsInsideWorkspace(workspace, ['escape/secret.txt'])).toBe(false);
    expect(pathsInsideWorkspace(workspace, ['escape/new/file.txt'])).toBe(false);
    expect(pathsInsideWorkspace(workspace, ['src/a.ts', join(outside, 'secret.txt')])).toBe(false);
    expect(pathsInsideWorkspace(workspace, [])).toBe(false);
    expect(pathsInsideWorkspace(workspace, undefined)).toBe(false);
    expect(pathsInsideWorkspace(workspace, ['src/[redacted].ts'])).toBe(false);
    expect(pathsInsideWorkspace(workspace, [`${repo}-sibling/a.ts`])).toBe(false);
  });

  it('compares case-insensitively where the filesystem is', () => {
    const { repo, workspace } = project();
    if (!isCaseInsensitivePath(repo)) return;
    const swapped = join(repo, 'SRC', 'A.TS');
    expect(pathsInsideWorkspace({ path: repo.toUpperCase(), realPath: repo }, [swapped])).toBe(true);
    expect(pathsInsideWorkspace(workspace, [swapped])).toBe(true);
  });

  it('an edit rule answers an inside edit, and asks for an outside, escaping, mixed or path-less one', async () => {
    const core = openTestCore();
    const { outside } = project();
    const { workspace, session } = workingSession(core);
    const repo = workspace.realPath ?? workspace.path;
    mkdirSync(join(repo, 'src'));
    symlinkSync(outside, join(repo, 'escape'), 'junction');
    const edit = (id: string, paths?: string[]) => ({ toolCallId: id, title: `Edit ${id}`, kind: 'edit', ...(paths === undefined ? {} : { paths }) });

    void core.permissions.request(session.id, edit('first', ['src/a.ts']));
    core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'allow_always' });
    expect(await core.permissions.request(session.id, edit('inside', [join(repo, 'src', 'b.ts')]))).toEqual({ outcome: 'allow_once' });

    const cases: Array<[string, string[] | undefined]> = [
      ['home', ['~/.ssh/x']],
      ['parent', ['../outside']],
      ['escape', ['escape/secret.txt']],
      ['mixed', ['src/a.ts', join(outside, 'secret.txt')]],
      ['none', undefined],
    ];
    for (const [id, paths] of cases) {
      const asked = track(core.permissions.request(session.id, edit(id, paths)));
      await flush();
      expect(asked.decision, id).toBeUndefined();
      expect(core.entities.getSession(session.id)?.state).toBe('waiting');
      core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'deny' });
    }
  });

  it('a fetch rule stays per kind', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    void core.permissions.request(session.id, { toolCallId: 'f1', title: 'Fetch a page', kind: 'fetch' });
    core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'allow_always' });
    expect(await core.permissions.request(session.id, { toolCallId: 'f2', title: 'Fetch another', kind: 'fetch' })).toEqual({ outcome: 'allow_once' });
  });
});

describe('no Always allow for interpreters, wrappers or variable assignments (review F2)', () => {
  it('offers no scope for each class, and says why', () => {
    for (const command of [
      'sudo npm install',
      'doas ls',
      'env FOO=1 npm test',
      'xargs rm',
      'nohup node server.js',
      'time npm test',
      'nice -n 5 make',
      'exec ls',
      'eval ls',
      'command ls',
      'builtin cd',
      'bash -c "ls"',
      'sh script.sh',
      'zsh -c x',
      'fish -c x',
      'dash x',
      'ksh x',
      'pwsh -c x',
      'powershell -Command x',
      'cmd /c dir',
      'python x.py',
      'python2 x.py',
      'python3 -m http.server',
      'python3.11 x.py',
      '/usr/bin/python3 x.py',
      'C:\\Python312\\python.exe x.py',
      'node -e "x"',
      'NODE.EXE x',
      'deno run x',
      'bun x',
      'npx prettier .',
      'bunx x',
      'pnpx x',
      'ruby -e x',
      'perl -e x',
      'php -r x',
      'lua x',
      'osascript -e x',
      'FOO=1 npm test',
      '_X=y ls',
    ]) {
      expect(alwaysAllowScope('execute', command), command).toBeNull();
      expect(alwaysAllowRefusal(command), command).toMatch(/^Always allow isn't offered for /);
    }
    expect(alwaysAllowRefusal('bash -c x')).toBe("Always allow isn't offered for bash, because it can run anything.");
    expect(alwaysAllowRefusal('FOO=1 npm test')).toMatch(/sets variables first/);
    for (const command of ['npm install stripe', 'git status', 'pythonic x', 'nodemon x', 'make test']) {
      expect(alwaysAllowScope('execute', command), command).not.toBeNull();
    }
  });

  it('refuses allow_always for them with the reason, and never matches them against a rule', async () => {
    const core = openTestCore();
    const { workspace, session } = workingSession(core);
    const asked = track(core.permissions.request(session.id, npm('bash -c "npm test"')));
    const { requestId, alwaysAllowScope: scope } = lastRequested(core, session.id).payload;
    expect(scope).toBeNull();
    expect(() => core.permissions.decide(workspace.id, session.id, requestId, { decision: 'allow_always' })).toThrow(
      "Always allow isn't offered for bash, because it can run anything.",
    );
    await flush();
    expect(asked.decision).toBeUndefined();
    expect(ruleMatches({ kind: 'command_prefix', value: 'bash' }, 'execute', 'bash -c ls')).toBe(false);
    expect(ruleMatches({ kind: 'command_prefix', value: 'FOO=1' }, 'execute', 'FOO=1 npm test')).toBe(false);
  });
});

describe('caution level (story 2.8)', () => {
  /** The ladder (user decision 2026-09-30): what each level auto-allows with every path inside. */
  const LADDER: Record<CautionLevel, readonly ToolKind[]> = {
    ask_every_time: [],
    ask_for_commands: ['read', 'search', 'think'],
    ask_risky_only: ['read', 'search', 'think', 'edit'],
  };

  it('is a pure table: only the ladder kinds, only with paths inside, never execute or an unknown level', () => {
    for (const level of CAUTION_LEVELS) {
      for (const kind of TOOL_KINDS) {
        expect(cautionAllows(level, kind, true), `${level} ${kind} inside`).toBe(LADDER[level].includes(kind));
        expect(cautionAllows(level, kind, false), `${level} ${kind} outside`).toBe(false);
      }
    }
    for (const kind of ['execute', 'delete', 'move', 'fetch', 'switch_mode', 'other'] as const) {
      for (const level of CAUTION_LEVELS) expect(cautionAllows(level, kind, true), `${level} ${kind}`).toBe(false);
    }
    expect(cautionAllows('ask_everything' as CautionLevel, 'read', true)).toBe(false);
    expect(cautionAllows('ask_risky_only', 'unknown' as ToolKind, true)).toBe(false);
  });

  /** A working session in a project with `src/a.ts`, a folder outside it, and a link escaping to it. */
  function project(core: Core) {
    const { workspace, session } = workingSession(core);
    const repo = workspace.realPath ?? workspace.path;
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.ts'), 'a');
    const outside = tempDir('ogden-agents-outside-');
    writeFileSync(join(outside, 'secret.txt'), 's');
    symlinkSync(outside, join(repo, 'escape'), 'junction');
    return { workspace, session, repo, outside };
  }

  const ask = (kind: string, paths?: string[], command?: string): AgentPermissionRequest => ({
    toolCallId: `t-${kind}`,
    title: `${kind} ${paths?.join(', ') ?? ''}`,
    kind,
    ...(paths === undefined ? {} : { paths }),
    ...(command === undefined ? {} : { command }),
  });

  /** Whether `request` was answered without a card; a card is denied so the session is free again. */
  async function answeredByCaution(core: Core, workspaceId: WorkspaceId, sessionId: SessionId, request: AgentPermissionRequest) {
    const before = core.events.lastSeq();
    const asked = track(core.permissions.request(sessionId, request));
    await flush();
    // Only this request's events (the log reads in pages).
    const events = core.events.readAfter(before).filter((event) => event.streamId === sessionId && event.type.startsWith('permission.'));
    const requested = events[0];
    if (requested?.type !== 'permission.requested') throw new Error('no permission.requested');
    if (asked.decision !== undefined) {
      expect(events.map((event) => event.type)).toEqual(['permission.requested', 'permission.resolved']);
      expect(events[1]?.payload).toMatchObject({ decision: 'allow_once', by: 'caution' });
      expect(asked.decision).toEqual({ outcome: 'allow_once' });
      return true;
    }
    expect(events).toHaveLength(1);
    expect(core.entities.getSession(sessionId)?.state).toBe('waiting');
    core.permissions.decide(workspaceId, sessionId, requested.payload.requestId, { decision: 'deny' });
    await flush();
    return false;
  }

  it('defaults to Ask every time, validates a change, appends settings_changed once, and survives Delete history and a restart', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const { workspace } = workingSession(core);
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time' });

    const before = core.events.lastSeq();
    expect(() => core.permissions.updateSettings(workspace.id, { cautionLevel: 'yolo' })).toThrow(ValidationError);
    expect(() => core.permissions.updateSettings(workspace.id, {})).toThrow(ValidationError);
    const unknown = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
    expect(() => core.permissions.updateSettings(unknown, { cautionLevel: 'ask_for_commands' })).toThrow(NotFoundError);
    expect(() => core.permissions.getSettings(unknown)).toThrow(NotFoundError);
    expect(core.events.lastSeq()).toBe(before);

    expect(core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' })).toEqual({ cautionLevel: 'ask_for_commands' });
    expect(core.events.readAfter(before)).toEqual([
      expect.objectContaining({
        type: 'workspace.settings_changed',
        workspaceId: workspace.id,
        streamId: workspace.id,
        payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' },
      }),
    ]);
    const changed = core.events.lastSeq();
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    expect(core.events.lastSeq()).toBe(changed);

    core.events.deleteWorkspaceHistory(workspace.id);
    expect(core.permissions.getSettings(workspace.id).cautionLevel).toBe('ask_for_commands');
    core.close();
    expect(openTestCore(dataDir).permissions.getSettings(workspace.id).cautionLevel).toBe('ask_for_commands');
  });

  it('the stub declines settings changes and reports the default', () => {
    const stub = createDecliningPermissions();
    expect(stub.getSettings('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId)).toEqual({ cautionLevel: 'ask_every_time' });
    expect(() => stub.updateSettings('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId, { cautionLevel: 'ask_risky_only' })).toThrow(NotFoundError);
  });

  it('Ask every time asks for everything, even a read inside the project', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    for (const kind of TOOL_KINDS) {
      expect(await answeredByCaution(core, workspace.id, session.id, ask(kind, ['src/a.ts'])), kind).toBe(false);
    }
    expect(lastRequested(core, session.id).payload.cautionLevel).toBe('ask_every_time');
  });

  it('a lower level auto-allows only ladder kinds whose paths are all inside, and records the level and by:caution', async () => {
    const core = openTestCore();
    const { workspace, session, repo, outside } = project(core);
    const outsidePaths: Array<[string, string[] | undefined]> = [
      ['none', undefined],
      ['empty', []],
      ['home', ['~/.ssh/id_rsa']],
      ['absolute home', [join(homedir(), '.ssh', 'id_rsa')]],
      ['parent', ['../x']],
      ['dotdot', ['src/../../x']],
      ['outside', [join(outside, 'secret.txt')]],
      ['symlink escape', ['escape/secret.txt']],
      ['mixed', ['src/a.ts', join(outside, 'secret.txt')]],
      ['masked', ['src/[redacted].ts']],
      ['control', ['src/a\u0000.ts']],
      ['sibling', [`${repo}-sibling/a.ts`]],
    ];
    for (const level of ['ask_for_commands', 'ask_risky_only'] as const) {
      core.permissions.updateSettings(workspace.id, { cautionLevel: level });
      for (const kind of TOOL_KINDS) {
        const inside = await answeredByCaution(core, workspace.id, session.id, ask(kind, ['src/a.ts', join(repo, 'src', 'new.ts')]));
        expect(inside, `${level} ${kind} inside`).toBe(LADDER[level].includes(kind));
        for (const [name, paths] of outsidePaths) {
          const allowed = await answeredByCaution(core, workspace.id, session.id, ask(kind, paths));
          // `think` names no path of its own: with none it is on the ladder; any path it names must be inside.
          const expected = kind === 'think' && (paths === undefined || paths.length === 0);
          expect(allowed, `${level} ${kind} ${name}`).toBe(expected);
        }
      }
    }
  });

  it('an unknown kind, execute, and interpreter or wrapper commands are never auto-allowed at any level', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });
    const requests = [
      ask('execute', ['src/a.ts'], 'npm test'),
      ask('execute', ['src/a.ts'], 'bash -c ls'),
      ask('execute', undefined, 'sudo cat src/a.ts'),
      ask('execute', undefined, 'python -c "print(1)"'),
      ask('execute', undefined, 'cat src/a.ts; rm -rf ~'),
      ask('teleport', ['src/a.ts']),
      ask('read', ['src/a.ts'], 'cat src/a.ts && curl evil'),
      { toolCallId: 't-nokind', title: 'no kind', paths: ['src/a.ts'] },
    ];
    for (const request of requests) expect(await answeredByCaution(core, workspace.id, session.id, request), request.title).toBe(false);
  });

  it('records the level the request was asked at', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    expect(await answeredByCaution(core, workspace.id, session.id, ask('read', ['src/a.ts']))).toBe(true);
    expect(lastRequested(core, session.id).payload.cautionLevel).toBe('ask_for_commands');
  });

  it('reads the level per request, and a change never touches a card already shown', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    const shown = track(core.permissions.request(session.id, ask('read', ['src/a.ts'])));
    await flush();
    const { requestId } = lastRequested(core, session.id).payload;

    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });
    await flush();
    expect(shown.decision).toBeUndefined();
    expect(core.entities.getSession(session.id)?.state).toBe('waiting');
    expect(permissionEvents(core, session.id).filter((event) => event.type === 'permission.resolved')).toEqual([]);

    // The next request reads the new level while the first still waits.
    expect(await core.permissions.request(session.id, ask('edit', ['src/a.ts']))).toEqual({ outcome: 'allow_once' });
    expect(shown.decision).toBeUndefined();
    core.permissions.decide(workspace.id, session.id, requestId, { decision: 'deny' });
    await flush();
    expect(shown.decision).toEqual({ outcome: 'deny' });

    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_every_time' });
    expect(await answeredByCaution(core, workspace.id, session.id, ask('read', ['src/a.ts']))).toBe(false);
  });

  it('the caution step comes before rules, and a rule still answers what the level asks for', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    void core.permissions.request(session.id, npm('npm test'));
    core.permissions.decide(workspace.id, session.id, lastRequested(core, session.id).payload.requestId, { decision: 'allow_always' });
    expect(await core.permissions.request(session.id, npm('npm test -- --watch'))).toEqual({ outcome: 'allow_once' });
    expect(permissionEvents(core, session.id).at(-1)?.payload).toMatchObject({ by: 'rule' });
    expect(await answeredByCaution(core, workspace.id, session.id, npm('npm run build'))).toBe(false);
  });

  it('never auto-allows for a session with no turn running', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });
    core.entities.setSessionState(session.id, 'idle');
    expect(await core.permissions.request(session.id, ask('read', ['src/a.ts']))).toEqual({ outcome: 'cancelled' });
  });
});

describe('protected paths always ask (user decision 2026-09-30, 2.8 F1)', () => {
  /** A working session in a project with `src/a.ts`, `.git/hooks` and `.claude`, and a link `src/hooks` to `.git/hooks`. */
  function project(core: Core) {
    const { workspace, session } = workingSession(core);
    const repo = workspace.realPath ?? workspace.path;
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.ts'), 'a');
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.json'), '{}');
    symlinkSync(join(repo, '.git', 'hooks'), join(repo, 'src', 'hooks'), 'junction');
    return { workspace, session, repo };
  }

  const call = (kind: string, paths?: string[], command?: string): AgentPermissionRequest => ({
    toolCallId: `t-${kind}`,
    title: `${kind} ${paths?.join(', ') ?? command ?? ''}`,
    kind,
    ...(paths === undefined ? {} : { paths }),
    ...(command === undefined ? {} : { command }),
  });

  /** How `request` was answered: `caution`, `rule`, or `card` (then denied, with its requested event). */
  async function answer(core: Core, workspaceId: WorkspaceId, sessionId: SessionId, request: AgentPermissionRequest, decision: 'deny' | 'allow_always' = 'deny') {
    const before = core.events.lastSeq();
    const asked = track(core.permissions.request(sessionId, request));
    await flush();
    const events = core.events.readAfter(before).filter((event) => event.streamId === sessionId && event.type.startsWith('permission.'));
    const requested = events[0];
    if (requested?.type !== 'permission.requested') throw new Error('no permission.requested');
    if (asked.decision !== undefined) {
      const resolved = events[1];
      return { by: resolved?.type === 'permission.resolved' ? resolved.payload.by : 'none', requested };
    }
    core.permissions.decide(workspaceId, sessionId, requested.payload.requestId, { decision });
    await flush();
    return { by: 'card', requested };
  }

  it('names protected folders and files at any depth, ignoring case', () => {
    for (const name of ['.claude', '.git', '.vscode', '.idea', '.mcp.json', 'CLAUDE.md', 'AGENTS.md', '.envrc', '.CLAUDE', '.Git', 'claude.MD']) {
      expect(isProtectedSegment(name), name).toBe(true);
    }
    for (const name of ['package.json', 'src', '.claude-projects', 'CLAUDE.md.bak', '.github', '.env']) expect(isProtectedSegment(name), name).toBe(false);
    expect(commandNamesProtectedPath('cp x .git/hooks/pre-commit')).toBe(true);
    expect(commandNamesProtectedPath('cp x "pkg\\.vscode\\tasks.json"')).toBe(true);
    expect(commandNamesProtectedPath('git commit -m x')).toBe(false);
  });

  it('a write to any of them shows a card at Ask only for risky actions with an Always allow editing rule; src/a.ts still runs', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    await answer(core, workspace.id, session.id, call('edit', ['src/a.ts']), 'allow_always');
    expect(core.permissions.listRules(workspace.id).map((rule) => rule.scope.value)).toEqual(['edit']);
    await answer(core, workspace.id, session.id, call('delete', ['src/old.ts']), 'allow_always');
    await answer(core, workspace.id, session.id, call('move', ['src/a.ts', 'src/b.ts']), 'allow_always');
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });

    const protectedPaths = [
      '.claude/settings.local.json',
      '.git/hooks/pre-commit',
      'pkg/.git/config',
      '.mcp.json',
      'CLAUDE.md',
      'docs/AGENTS.md',
      '.envrc',
      '.vscode/tasks.json',
      '.idea/workspace.xml',
      'src/hooks/pre-commit',
      '.git',
    ];
    for (const kind of ['edit', 'delete', 'move'] as const) {
      for (const path of protectedPaths) {
        const { by, requested } = await answer(core, workspace.id, session.id, call(kind, kind === 'move' ? ['src/a.ts', path] : [path]));
        expect(by, `${kind} ${path}`).toBe('card');
        expect(requested.type === 'permission.requested' && requested.payload.toolCall.protectedPath, `${kind} ${path}`).toBe(true);
      }
    }
    const inside = await answer(core, workspace.id, session.id, call('edit', ['src/a.ts']));
    expect(inside.by).toBe('caution');
    expect(inside.requested.type === 'permission.requested' && inside.requested.payload.toolCall.protectedPath).toBeUndefined();
    expect((await answer(core, workspace.id, session.id, call('delete', ['src/old.ts']))).by).toBe('rule');

    // Only at the default level, the edit rule alone still never answers them.
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_every_time' });
    expect((await answer(core, workspace.id, session.id, call('edit', ['.git/hooks/pre-commit']))).by).toBe('card');
    expect((await answer(core, workspace.id, session.id, call('edit', ['src/b.ts']))).by).toBe('rule');
  });

  it('case variants are protected where the filesystem ignores case (and everywhere else too)', async () => {
    const core = openTestCore();
    const { workspace, session, repo } = project(core);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });
    for (const path of ['.CLAUDE/settings.json', '.Git/HOOKS/pre-commit', 'Claude.md', join(repo, '.VSCODE', 'tasks.json')]) {
      expect((await answer(core, workspace.id, session.id, call('edit', [path]))).by, path).toBe('card');
    }
    if (isCaseInsensitivePath(repo)) expect((await answer(core, workspace.id, session.id, call('edit', [join(repo.toUpperCase(), '.claude', 'x.json')]))).by).toBe('card');
  });

  it('reading or searching them is not protected: a read of .claude/settings.json runs at Ask for commands', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    const read = await answer(core, workspace.id, session.id, call('read', ['.claude/settings.json']));
    expect(read.by).toBe('caution');
    expect(read.requested.type === 'permission.requested' && read.requested.payload.toolCall.protectedPath).toBeUndefined();
    expect((await answer(core, workspace.id, session.id, call('search', ['.git']))).by).toBe('caution');
  });

  it('a command naming one is never answered by its command rule', async () => {
    const core = openTestCore();
    const { workspace, session } = project(core);
    await answer(core, workspace.id, session.id, call('execute', undefined, 'cp -r a b'), 'allow_always');
    expect((await answer(core, workspace.id, session.id, call('execute', undefined, 'cp src/a.ts src/c.ts'))).by).toBe('rule');
    const hook = await answer(core, workspace.id, session.id, call('execute', undefined, 'cp evil .git/hooks/pre-commit'));
    expect(hook.by).toBe('card');
    expect(hook.requested.type === 'permission.requested' && hook.requested.payload.toolCall.protectedPath).toBe(true);
  });
});
