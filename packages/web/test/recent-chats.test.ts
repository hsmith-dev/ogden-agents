/**
 * Recent chats (epic 26 story 3): the chats opened in this browser, newest
 * first, once each, at most 20 kept; storage that throws or holds anything
 * else leaves the list empty and nothing breaks.
 */
import { describe, expect, it } from 'vitest';
import { RECENT_CHATS_KEY, RECENT_CHATS_MAX, recentChats, recordRecentChat } from '../src/palette/recent-chats';

function memory() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  return { values, env: () => storage };
}

describe('recent chats', () => {
  it('newest first, a chat opened again moves to the front once', () => {
    const { env } = memory();
    for (const id of ['1', '2', '3', '2']) recordRecentChat('ws_a', `ses_${id}`, env);
    expect(recentChats(env)).toEqual([
      { wsId: 'ws_a', sesId: 'ses_2' },
      { wsId: 'ws_a', sesId: 'ses_3' },
      { wsId: 'ws_a', sesId: 'ses_1' },
    ]);
  });

  it(`keeps at most ${RECENT_CHATS_MAX}, the oldest dropped`, () => {
    const { env } = memory();
    for (let i = 0; i < RECENT_CHATS_MAX + 5; i++) recordRecentChat('ws_a', `ses_${i}`, env);
    const kept = recentChats(env);
    expect(kept).toHaveLength(RECENT_CHATS_MAX);
    expect(kept[0]!.sesId).toBe(`ses_${RECENT_CHATS_MAX + 4}`);
    expect(kept.at(-1)!.sesId).toBe('ses_5');
  });

  it('storage that throws: an empty list, and recording does not throw', () => {
    const throwing = () => ({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => recordRecentChat('ws_a', 'ses_1', throwing)).not.toThrow();
    expect(recentChats(throwing)).toEqual([]);
    const noStorage = () => {
      throw new Error('SecurityError');
    };
    expect(() => recordRecentChat('ws_a', 'ses_1', noStorage)).not.toThrow();
    expect(recentChats(noStorage)).toEqual([]);
  });

  it('anything else in storage reads as empty, and bad entries are skipped', () => {
    const { values, env } = memory();
    values.set(RECENT_CHATS_KEY, 'not json');
    expect(recentChats(env)).toEqual([]);
    values.set(RECENT_CHATS_KEY, JSON.stringify({ a: 1 }));
    expect(recentChats(env)).toEqual([]);
    values.set(RECENT_CHATS_KEY, JSON.stringify([['ws_a', 'ses_1'], 7, ['ws_b'], ['ws_b', 'ses_2']]));
    expect(recentChats(env)).toEqual([
      { wsId: 'ws_a', sesId: 'ses_1' },
      { wsId: 'ws_b', sesId: 'ses_2' },
    ]);
  });
});
