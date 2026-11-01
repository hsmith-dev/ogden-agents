/**
 * A chat's detail level in this browser (epic 26 story 4): the default by
 * Developer mode, a stored choice per chat, a bounded list, unreadable or
 * throwing storage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_DETAIL_KEY,
  CHAT_DETAIL_MAX,
  chatDetailOf,
  defaultChatDetail,
  DETAIL_MENU_WORDS,
  onBeforeChatDetailChange,
  resetChatDetailForTests,
  setChatDetail,
  storeChatDetail,
  type ChatDetailEnv,
} from '../src/chat/detail-level';

function memoryEnv() {
  const map = new Map<string, string>();
  const env: ChatDetailEnv = {
    storage: () => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) }),
  };
  return { env, map };
}

afterEach(() => {
  resetChatDetailForTests();
  vi.unstubAllGlobals();
});

describe('chat detail level', () => {
  it('defaults to Normal, Verbose in Developer mode', () => {
    expect(defaultChatDetail(false)).toBe('normal');
    expect(defaultChatDetail(true)).toBe('verbose');
    expect(chatDetailOf('ses_1', memoryEnv().env)).toBeUndefined();
  });

  it('keeps a choice per chat', () => {
    const { env } = memoryEnv();
    storeChatDetail('ses_1', 'verbose', env);
    storeChatDetail('ses_2', 'normal', env);
    expect(chatDetailOf('ses_1', env)).toBe('verbose');
    expect(chatDetailOf('ses_2', env)).toBe('normal');
    storeChatDetail('ses_1', 'normal', env);
    expect(chatDetailOf('ses_1', env)).toBe('normal');
  });

  it(`keeps at most ${CHAT_DETAIL_MAX} chats, the oldest dropped`, () => {
    const { env, map } = memoryEnv();
    for (let i = 0; i <= CHAT_DETAIL_MAX; i++) storeChatDetail(`ses_${i}`, 'verbose', env);
    expect(JSON.parse(map.get(CHAT_DETAIL_KEY)!)).toHaveLength(CHAT_DETAIL_MAX);
    expect(chatDetailOf('ses_0', env)).toBeUndefined();
    expect(chatDetailOf(`ses_${CHAT_DETAIL_MAX}`, env)).toBe('verbose');
  });

  it('ignores what it cannot read', () => {
    const { env, map } = memoryEnv();
    map.set(CHAT_DETAIL_KEY, 'not json');
    expect(chatDetailOf('ses_1', env)).toBeUndefined();
    map.set(CHAT_DETAIL_KEY, JSON.stringify([['ses_1', 'loud'], ['ses_2', 'verbose'], 7]));
    expect(chatDetailOf('ses_1', env)).toBeUndefined();
    expect(chatDetailOf('ses_2', env)).toBe('verbose');
  });

  it('with storage that throws: no choice is read, and a switch still holds for this page', () => {
    const throwing: ChatDetailEnv = {
      storage: () => ({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    };
    expect(chatDetailOf('ses_1', throwing)).toBeUndefined();
    expect(() => storeChatDetail('ses_1', 'verbose', throwing)).not.toThrow();

    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(chatDetailOf('ses_1')).toBeUndefined();
    setChatDetail('ses_1', 'verbose');
    expect(chatDetailOf('ses_1')).toBe('verbose');
  });

  it('tells the before-change listeners first, then keeps the choice', () => {
    vi.stubGlobal('window', { localStorage: memoryEnv().env.storage() });
    const seen: string[] = [];
    const off = onBeforeChatDetailChange((sesId, next) => seen.push(`${sesId}:${next}:${chatDetailOf(sesId) ?? 'none'}`));
    setChatDetail('ses_1', 'verbose');
    off();
    setChatDetail('ses_1', 'normal');
    expect(seen).toEqual(['ses_1:verbose:none']);
    expect(chatDetailOf('ses_1')).toBe('normal');
  });

  it('names the other level in the menu', () => {
    expect(DETAIL_MENU_WORDS).toEqual({ normal: 'Show every step', verbose: 'Show less detail' });
  });
});
