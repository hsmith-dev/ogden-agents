/**
 * Chat names (backlog story 2): the first user message that isn't a Deny
 * reason names a chat once, whoever sent it; the user's name is normalized,
 * capped, and cleared by a blank one; each change is one `session.renamed`;
 * a rename never moves a chat; older chats are named from their first
 * message at a server start.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { autoChatName, CHAT_NAME_MAX, chatName, CoreEvent, NEW_CHAT_NAME, normalizeChatName, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

function setup() {
  const core = openTestCore();
  const repo = join(tempDir(), 'repo');
  mkdirSync(repo);
  const workspace = core.entities.ensureWorkspace(repo);
  const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
  const renames = () => core.events.readAfter(0).filter((event) => event.type === 'session.renamed' && event.streamId === session.id);
  const say = (content: string, origin?: 'deny_reason' | 'terminal', role: 'user' | 'agent' = 'user') =>
    core.sessionEvents.completeMessage(session.id, { messageId: `msg_${Math.random()}`, role, content, ...(origin === undefined ? {} : { origin }) });
  return { core, workspace, session, renames, say };
}

describe('the rules a name follows (shared)', () => {
  it('strips control and invisible characters, collapses white space and trims; blank is none', () => {
    expect(normalizeChatName('  Fix\tthe\r\nlogin\u0007 bug‮  ')).toBe('Fix the login bug');
    expect(normalizeChatName('a​b c')).toBe('ab c');
    expect(normalizeChatName(' \n\t ')).toBeNull();
    expect(normalizeChatName(null)).toBeNull();
    expect(normalizeChatName('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('an automatic name is one line, at most 60 characters, cut at a word with an ellipsis', () => {
    expect(autoChatName('Short one')).toBe('Short one');
    const long = autoChatName('word '.repeat(40))!;
    expect([...long].length).toBeLessThanOrEqual(60);
    expect(long.endsWith('word…')).toBe(true);
    expect([...autoChatName('x'.repeat(200))!].length).toBe(60);
    expect(autoChatName('   ')).toBeNull();
  });

  it('a chat shows the user’s name, else the automatic one, else New chat', () => {
    expect(chatName({ title: 'Mine', autoTitle: 'Auto' })).toBe('Mine');
    expect(chatName({ title: null, autoTitle: 'Auto' })).toBe('Auto');
    expect(chatName({ title: null })).toBe(NEW_CHAT_NAME);
  });
});

describe('automatic names (criterion 1)', () => {
  it('the first user message names the chat once, without moving it', () => {
    const { core, session, renames, say } = setup();
    expect(core.entities.getSession(session.id)?.autoTitle).toBeUndefined();
    say('Hello there', undefined, 'agent');
    expect(renames()).toEqual([]);
    say('  Fix the\nlogin bug  ');
    say('Something else');
    const stored = core.entities.getSession(session.id)!;
    expect(stored.autoTitle).toBe('Fix the login bug');
    expect(stored.updatedAt).toBe(session.updatedAt);
    expect(renames().map((event) => CoreEvent.parse(event).payload)).toEqual([{ sessionId: session.id, title: null, autoTitle: 'Fix the login bug', cause: 'auto' }]);
  });

  it('an API key in the first message is redacted from the name', () => {
    const { core, session, say } = setup();
    say('Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 for this');
    expect(core.entities.getSession(session.id)?.autoTitle).toBe('Use [redacted] for this');
  });

  it('a Deny reason never names a chat; a message from the terminal does', () => {
    const { core, session, say } = setup();
    say('Not that file', 'deny_reason');
    expect(core.entities.getSession(session.id)?.autoTitle).toBeUndefined();
    say('Typed in the terminal', 'terminal');
    expect(core.entities.getSession(session.id)?.autoTitle).toBe('Typed in the terminal');
  });

  it('a chat created with an automatic name keeps it', () => {
    const { core, workspace } = setup();
    const planning = core.entities.createSession({ workspaceId: workspace.id, kind: 'planning', autoTitle: '  Create a\nPRD ' });
    expect(planning.autoTitle).toBe('Create a PRD');
    core.sessionEvents.completeMessage(planning.id, { messageId: 'msg_1', role: 'user', content: '/bmad-prd' });
    expect(core.entities.getSession(planning.id)?.autoTitle).toBe('Create a PRD');
    const created = core.events.readAfter(0).find((event) => event.type === 'session.created' && event.streamId === planning.id);
    expect(CoreEvent.parse(created)).toMatchObject({ payload: { session: { autoTitle: 'Create a PRD' } } });
  });
});

describe('renaming (criteria 2, 4, 5, 6)', () => {
  it('stores the normalized name with one event, and the same name again appends nothing', () => {
    const { core, session, renames, say } = setup();
    say('First message');
    const renamed = core.entities.setSessionTitle(session.id, '  Auth\u0007   work ');
    expect(renamed.title).toBe('Auth work');
    expect(core.entities.getSession(session.id)).toMatchObject({ title: 'Auth work', updatedAt: session.updatedAt });
    core.entities.setSessionTitle(session.id, 'Auth work');
    expect(renames().map((event) => CoreEvent.parse(event).payload).at(-1)).toEqual({ sessionId: session.id, title: 'Auth work', autoTitle: 'First message', cause: 'user' });
    expect(renames()).toHaveLength(2);
  });

  it('a blank name clears it, and the automatic name shows again', () => {
    const { core, session, say } = setup();
    say('First message');
    core.entities.setSessionTitle(session.id, 'Mine');
    const cleared = core.entities.setSessionTitle(session.id, '   ');
    expect(cleared.title).toBeNull();
    expect(chatName(cleared)).toBe('First message');
    expect(core.entities.setSessionTitle(session.id, null).title).toBeNull();
  });

  it('refuses a name over 80 characters, storing nothing', () => {
    const { core, session, renames } = setup();
    expect(() => core.entities.setSessionTitle(session.id, 'x'.repeat(CHAT_NAME_MAX + 1))).toThrow(ValidationError);
    expect(core.entities.setSessionTitle(session.id, `  ${'x'.repeat(CHAT_NAME_MAX)}  `).title).toHaveLength(CHAT_NAME_MAX);
    expect(renames()).toHaveLength(1);
    expect(() => core.entities.setSessionTitle('ses_missing' as SessionId, 'x')).toThrow(NotFoundError);
  });
});

describe('older chats (criterion 7)', () => {
  it('a chat from before chat names is named from its first user message at a start, once', () => {
    const { core, workspace, session } = setup();
    // As stored before chat names: the messages are there, the chat has no automatic name.
    const old = (content: string, origin?: 'deny_reason') =>
      core.sessionEvents.appendSessionEvent(session.id, { type: 'session.message_completed', payload: { messageId: `msg_${content}`, role: 'user', content, ...(origin === undefined ? {} : { origin }) } });
    old('Not this', 'deny_reason');
    old('The real ask');
    expect(core.entities.getSession(session.id)?.autoTitle).toBeUndefined();
    const empty = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    expect(core.entities.backfillAutoTitles().map((named) => named.id)).toEqual([session.id]);
    expect(core.entities.getSession(session.id)?.autoTitle).toBe('The real ask');
    expect(core.entities.getSession(empty.id)?.autoTitle).toBeUndefined();
    expect(core.entities.backfillAutoTitles()).toEqual([]);
  });

  it('an older session.created without the automatic name still reads', () => {
    const { session } = setup();
    const { autoTitle: _none, ...older } = session;
    expect(CoreEvent.parse({ type: 'session.created', id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 1, at: session.createdAt, workspaceId: session.workspaceId, streamId: session.id, payload: { session: older } })).toBeTruthy();
  });
});
