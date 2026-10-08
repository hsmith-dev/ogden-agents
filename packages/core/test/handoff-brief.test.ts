/**
 * Handoff (user decision 2026-10-04): the brief Ogden builds from a chat's own
 * events for the agent the chat continues with. No model, no agent: a pure
 * function over events.
 */
import type { AgentId, CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { buildHandoffBrief, DEFAULT_HANDOFF_BUDGET_CHARS, HANDOFF_HEADER, agentDescriptorProblems, handoffBudget, isUsageLimit } from '../src/index.js';
import { testDescriptor } from './helpers.js';

let seq = 0;
const at = '2026-10-04T10:00:00.000Z';
const base = () => ({ id: `evt_${++seq}`, seq, workspaceId: 'ws_1', streamId: 'ses_1', at });
const created = (agentId?: string): CoreEvent =>
  ({
    ...base(),
    type: 'session.created',
    payload: { session: { id: 'ses_1', workspaceId: 'ws_1', kind: 'chat', state: 'idle', driver: 'ui', permissionMode: 'ask', machineId: null, ...(agentId === undefined ? {} : { agentId }), title: null, adapterRefs: {}, createdAt: at, updatedAt: at } },
  }) as CoreEvent;
const message = (role: 'user' | 'agent', content: string, origin?: 'deny_reason'): CoreEvent =>
  ({ ...base(), type: 'session.message_completed', payload: { messageId: `msg_${seq}`, role, content, ...(origin === undefined ? {} : { origin }) } }) as CoreEvent;
const tool = (toolCallId: string, title: string, status: string, paths?: string[]): CoreEvent =>
  ({
    ...base(),
    type: 'session.tool_call',
    payload: { sessionId: 'ses_1', toolCallId, title, kind: 'edit', status, ...(paths === undefined ? {} : { diffs: paths.map((path) => ({ path, oldText: 'secret contents', newText: 'new contents' })) }) },
  }) as CoreEvent;
const changed = (agentId: string, previous: string): CoreEvent =>
  ({ ...base(), type: 'session.agent_changed', payload: { sessionId: 'ses_1', agentId, previous, brief: 'x', resumes: false } }) as CoreEvent;

const names: Record<string, string> = { 'first-agent': 'First Agent', 'second-agent': 'Second Agent' };
const agentName = (agentId: AgentId | undefined) => names[agentId ?? 'first-agent'] ?? 'Someone';
const brief = (events: CoreEvent[], options: { sinceSeq?: number; maxChars?: number } = {}) =>
  buildHandoffBrief({ events, projectPath: '/repo', agentName, fromName: 'First Agent', maxChars: options.maxChars ?? 10_000, sinceSeq: options.sinceSeq });

describe('the handoff brief', () => {
  it('says where, the original goal, what changed and the conversation, labelled by who wrote each message', () => {
    const text = brief([
      created('first-agent'),
      message('user', 'Add a booking form to the app.'),
      tool('t1', 'Edit src/form.ts', 'completed', ['/repo/src/form.ts']),
      tool('t2', 'Run npm test', 'failed'),
      message('agent', 'I added the form; the tests fail.'),
      message('user', 'I denied "rm -rf": no', 'deny_reason'),
    ]);
    expect(text.startsWith(HANDOFF_HEADER)).toBe(true);
    expect(text).toContain('until now this chat was with First Agent');
    expect(text).toContain('Project folder: /repo');
    expect(text).toContain('Original goal: Add a booking form to the app.');
    expect(text).toContain('Files changed: src/form.ts');
    expect(text).toContain('Actions taken: Edit src/form.ts');
    expect(text).not.toContain('Run npm test');
    expect(text).toContain('User: Add a booking form to the app.\nFirst Agent: I added the form; the tests fail.');
    // Names only: never a file's contents.
    expect(text).not.toContain('secret contents');
  });

  it('leaves out permission requests and calls still running, and says when there is no conversation yet', () => {
    const pending = { ...base(), type: 'permission.requested', payload: { sessionId: 'ses_1', requestId: 'preq_1', toolCall: { toolCallId: 't9', title: 'Run deploy', kind: 'execute' }, alwaysAllowScope: null, cautionLevel: 'ask_every_time' } } as CoreEvent;
    const text = brief([created('first-agent'), pending, tool('t3', 'Run deploy', 'pending')]);
    expect(text).not.toContain('deploy');
    expect(text).toContain('Conversation: nothing yet.');
  });

  it('masks API keys, tokens and named secrets in every part', () => {
    const key = `sk-ant-api03-${'a'.repeat(40)}`;
    const text = brief([
      created('first-agent'),
      message('user', `Use ${key} and GITHUB_TOKEN=ghp_${'b'.repeat(36)} please`),
      tool('t1', `Run curl -H "Authorization: Bearer ${'c'.repeat(30)}"`, 'completed'),
      message('agent', 'password: hunter2hunter2'),
    ]);
    expect(text).not.toContain(key);
    expect(text).not.toMatch(/ghp_b{36}|c{30}|hunter2hunter2/);
    expect(text).toContain('[redacted]');
    expect(text).toContain('password: [redacted]');
  });

  it('masks the goal before cutting it, and the other common secret shapes', () => {
    const token = `ghp_${'q'.repeat(36)}`;
    const text = brief([
      created('first-agent'),
      message('user', `${'x'.repeat(980)} ${token}`),
      tool('t1', 'Run psql postgres://me:Sup3rS3cret@db/x --password Hunter2pass', 'completed'),
      message('agent', '{"password": "correct horse battery"} export DB_PASS=abcd1234 sk_live_abcdefghijkl12'),
    ]);
    expect(text).not.toMatch(/ghp_q{4}|Sup3rS3cret|Hunter2pass|correct horse|abcd1234|sk_live_/);
  });

  it('masks in linear time, however the text repeats', () => {
    const started = Date.now();
    brief([created('first-agent'), message('user', 'token.'.repeat(20_000)), message('agent', 'x-token-'.repeat(15_000))], { maxChars: 200_000 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('keeps the newest messages whole within the budget, cuts older ones to a first line, then counts the rest', () => {
    const events = [created('first-agent')];
    for (let i = 0; i < 40; i++) events.push(message(i % 2 === 0 ? 'user' : 'agent', `Message ${i} heading\n${'detail '.repeat(40)}`));
    const text = brief(events, { maxChars: 3_000 });
    expect(text.length).toBeLessThanOrEqual(3_000);
    expect(text).toContain(`Message 39 heading\n${'detail '.repeat(40).trimEnd()}`);
    expect(text).toMatch(/older messages? cut to a first line/);
    expect(text).toMatch(/\d+ earlier messages? left out/);
    // The oldest is only the original goal now, not in the conversation.
    expect(text.slice(text.indexOf('Conversation'))).not.toContain('Message 0 heading');
    // Oldest first: an older heading comes before the newest message.
    expect(text.indexOf('Message 39')).toBeGreaterThan(text.lastIndexOf('heading', text.indexOf('Message 39') - 1));
  });

  it('never passes the budget, even for one message longer than all of it', () => {
    const text = brief([created('first-agent'), message('user', `goal\n${'x'.repeat(50_000)}END`)], { maxChars: 2_000 });
    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text).toContain('[shortened: only the end is kept]');
    expect(text.endsWith('END')).toBe(true);
  });

  it('for an agent coming back, covers only what happened since it left, labelling the other agent', () => {
    const before = [created('first-agent'), message('user', 'Original ask'), message('agent', 'Old answer')];
    const left = changed('second-agent', 'first-agent');
    const events = [...before, left, message('user', 'New ask'), message('agent', 'Second answer')];
    const text = buildHandoffBrief({ events, projectPath: '/repo', agentName, fromName: 'Second Agent', sinceSeq: left.seq, maxChars: 10_000 });
    expect(text).toContain('you are back in this chat. It went on with Second Agent');
    expect(text).toContain('Original goal: Original ask');
    expect(text).toContain('User: New ask\nSecond Agent: Second answer');
    expect(text).not.toContain('Old answer');
  });
});

describe('the descriptor fields', () => {
  const agent = { displayName: 'Test Agent', permissionModes: ['ask'] as const };
  it('budgets a brief per agent, within the hard cap', () => {
    expect(handoffBudget({})).toBe(DEFAULT_HANDOFF_BUDGET_CHARS);
    expect(handoffBudget({ handoffBudgetChars: 5_000 })).toBe(5_000);
    expect(agentDescriptorProblems(testDescriptor('test-agent', agent, { handoffBudgetChars: 10 }))).toEqual([expect.stringMatching(/handoff budget/)]);
    expect(agentDescriptorProblems(testDescriptor('test-agent', agent, { handoffBudgetChars: 500_000 }))).toEqual([expect.stringMatching(/handoff budget/)]);
  });

  it('matches only its own usage-limit patterns, and refuses a stateful pattern', () => {
    const descriptor = { usageLimitPatterns: [/usage limit reached/i] };
    expect(isUsageLimit(descriptor, 'Claude AI usage limit reached|123')).toBe(true);
    expect(isUsageLimit(descriptor, 'the agent failed on purpose')).toBe(false);
    expect(isUsageLimit({}, 'usage limit reached')).toBe(false);
    expect(agentDescriptorProblems(testDescriptor('test-agent', agent, { usageLimitPatterns: [/limit/g] }))).toEqual([expect.stringMatching(/g or y flag/)]);
  });
});
