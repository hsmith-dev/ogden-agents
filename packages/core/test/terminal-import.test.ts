/** Which of the CLI's turns switching back imports (story 3.3, I/O matrix). */
import { MAX_MESSAGE_LENGTH } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORTED_TURNS, omittedNote, START_MARK, turnsToImport, type AgentTranscriptTurn, type CompletedMessage } from '../src/index.js';

const user = (id: string, text: string): AgentTranscriptTurn => ({ id, role: 'user', text });
const agent = (id: string, text: string): AgentTranscriptTurn => ({ id, role: 'agent', text });
const stored = (...messages: Array<[CompletedMessage['role'], string]>): CompletedMessage[] =>
  messages.map(([role, content], i) => ({ messageId: `msg_${i}`, role, content }));

const chat = stored(['user', 'first question'], ['agent', 're: first question']);
const before = [user('u1', 'first question'), agent('u1', 're: first question')];
const typed = [user('u2', 'typed in the terminal'), agent('u2', 'answered')];

describe('turnsToImport', () => {
  it('imports the turns after the mark: the last turn when the terminal opened', () => {
    expect(turnsToImport(chat, [...before, ...typed], 'u1')).toEqual({ turns: typed, omitted: 0, unaligned: false });
  });

  it('imports nothing when nothing came after the mark (switching back again)', () => {
    expect(turnsToImport(chat, [...before, ...typed], 'u2')).toEqual({ turns: [], omitted: 0, unaligned: false });
  });

  it('imports every turn after the start mark (no record when the terminal opened)', () => {
    expect(turnsToImport(chat, typed, START_MARK).turns).toEqual(typed);
  });

  it('imports a user turn whose reply never came (CLI killed mid-reply)', () => {
    expect(turnsToImport(chat, [...before, user('u2', 'killed')], 'u1').turns).toEqual([user('u2', 'killed')]);
  });

  it('without a mark, lines up after the exchange of the chat’s last user message', () => {
    for (const mark of [undefined, '']) {
      expect(turnsToImport(chat, [...before, ...typed], mark)).toEqual({ turns: typed, omitted: 0, unaligned: false });
    }
    // The newest match, whitespace aside.
    const repeated = [...before, user('u2', ' first question '), agent('u2', 'again'), user('u3', 'new')];
    expect(turnsToImport(chat, repeated).turns).toEqual([user('u3', 'new')]);
  });

  it('a mark the record no longer has (rewritten) lines up as if there were none', () => {
    expect(turnsToImport(chat, [...before, ...typed], 'gone').turns).toEqual(typed);
  });

  it('without a mark or a match, imports nothing and says it is unaligned', () => {
    expect(turnsToImport(chat, typed)).toEqual({ turns: [], omitted: 0, unaligned: true });
    expect(turnsToImport([], typed)).toEqual({ turns: [], omitted: 0, unaligned: true });
  });

  it(`imports at most the newest ${MAX_IMPORTED_TURNS} turns and counts the rest`, () => {
    const many = Array.from({ length: MAX_IMPORTED_TURNS + 5 }, (_, i) => user(`u${i}`, `t${i}`));
    const result = turnsToImport(chat, many, START_MARK);
    expect(result.omitted).toBe(5);
    expect(result.turns).toHaveLength(MAX_IMPORTED_TURNS);
    expect(result.turns[0]).toEqual(user('u5', 't5'));
    expect(omittedNote(5)).toBe('5 earlier terminal messages were not imported');
    expect(omittedNote(1)).toBe('1 earlier terminal message was not imported');
  });

  it('cuts each text at the longest message', () => {
    const long = 'x'.repeat(MAX_MESSAGE_LENGTH + 10);
    expect(turnsToImport(chat, [user('u2', long)], START_MARK).turns[0]!.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });
});
