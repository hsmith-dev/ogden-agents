/**
 * Composer drafts' storage policy (backlog story 6): expiry, size and count
 * caps, unreadable entries, blocked storage, and clearing only what was sent.
 */
import { describe, expect, it } from 'vitest';
import {
  chatDraftKey,
  clearDraftIfUnchanged,
  DRAFT_MAX_CHARS,
  DRAFT_MAX_COUNT,
  DRAFT_TTL_MS,
  newChatDraftKey,
  pruneDrafts,
  readDraft,
  writeDraft,
  type DraftEnv,
} from '../src/chat/drafts';

const PREFIX = 'ogden-agents.draft.v1:';

function memoryEnv(start = 1_000_000) {
  const map = new Map<string, string>();
  const clock = { now: start };
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  const env: DraftEnv = { storage: () => storage, now: () => clock.now };
  return { env, map, clock };
}

describe('composer drafts', () => {
  it('keys a chat and a project new-chat composer apart', () => {
    expect(chatDraftKey('ws_1', 'ses_1')).not.toBe(newChatDraftKey('ws_1'));
    expect(chatDraftKey('ws_1', 'ses_1')).not.toBe(chatDraftKey('ws_2', 'ses_1'));
  });

  it('keeps, reads back and forgets a draft', () => {
    const { env, map } = memoryEnv();
    writeDraft('a', 'hello', env);
    expect(readDraft('a', env)).toBe('hello');
    expect(readDraft('b', env)).toBe('');
    writeDraft('a', '   ', env);
    expect(readDraft('a', env)).toBe('');
    expect(map.size).toBe(0);
  });

  it('does not rewrite unchanged text, so viewing a draft does not extend it', () => {
    const { env, map, clock } = memoryEnv();
    writeDraft('a', 'hello', env);
    const first = map.get(`${PREFIX}a`);
    clock.now += 1000;
    writeDraft('a', 'hello', env);
    expect(map.get(`${PREFIX}a`)).toBe(first);
  });

  it('expires a draft after 7 days and removes it', () => {
    const { env, map, clock } = memoryEnv();
    writeDraft('a', 'old', env);
    clock.now += DRAFT_TTL_MS;
    expect(readDraft('a', env)).toBe('old');
    clock.now += 1;
    expect(readDraft('a', env)).toBe('');
    expect(map.size).toBe(0);
  });

  it('does not store a draft over the size cap, and forgets the older stored version', () => {
    const { env } = memoryEnv();
    writeDraft('a', 'short', env);
    writeDraft('a', 'x'.repeat(DRAFT_MAX_CHARS + 1), env);
    expect(readDraft('a', env)).toBe('');
    writeDraft('a', 'x'.repeat(DRAFT_MAX_CHARS), env);
    expect(readDraft('a', env)).toHaveLength(DRAFT_MAX_CHARS);
  });

  it('keeps at most the newest drafts beyond the count cap', () => {
    const { env, clock } = memoryEnv();
    for (let i = 0; i <= DRAFT_MAX_COUNT; i++) {
      clock.now += 1;
      writeDraft(`k${i}`, `text ${i}`, env);
    }
    expect(readDraft('k0', env)).toBe('');
    expect(readDraft('k1', env)).toBe('text 1');
    expect(readDraft(`k${DRAFT_MAX_COUNT}`, env)).toBe(`text ${DRAFT_MAX_COUNT}`);
  });

  it('prunes expired and unreadable entries, and leaves other keys alone', () => {
    const { env, map, clock } = memoryEnv();
    writeDraft('old', 'old', env);
    clock.now += DRAFT_TTL_MS + 1;
    writeDraft('new', 'new', env);
    map.set(`${PREFIX}junk`, 'not json');
    map.set(`${PREFIX}shape`, JSON.stringify({ text: 3 }));
    map.set('ogden-agents.sidebar-collapsed', '[]');
    pruneDrafts(env);
    expect([...map.keys()].sort()).toEqual([`${PREFIX}new`, 'ogden-agents.sidebar-collapsed']);
    expect(readDraft('junk', env)).toBe('');
  });

  it('clears after a send only when the draft is still what was sent', () => {
    const { env } = memoryEnv();
    writeDraft('a', 'sent text', env);
    clearDraftIfUnchanged('a', 'sent text', env);
    expect(readDraft('a', env)).toBe('');
    writeDraft('a', 'sent text and more', env);
    clearDraftIfUnchanged('a', 'sent text', env);
    expect(readDraft('a', env)).toBe('sent text and more');
  });

  it('works without storage, or with storage that throws', () => {
    const none: DraftEnv = { storage: () => undefined, now: () => 0 };
    const boom = () => {
      throw new Error('blocked');
    };
    const throwing: DraftEnv = {
      storage: () => ({ getItem: boom, setItem: boom, removeItem: boom, key: boom, length: 1 }),
      now: () => 0,
    };
    for (const env of [none, throwing]) {
      expect(() => writeDraft('a', 'x', env)).not.toThrow();
      expect(readDraft('a', env)).toBe('');
      expect(() => clearDraftIfUnchanged('a', 'x', env)).not.toThrow();
      expect(() => pruneDrafts(env)).not.toThrow();
    }
  });

  it('expires a draft dated more than a day ahead of the clock', () => {
    const { env, map, clock } = memoryEnv();
    map.set(`${PREFIX}future`, JSON.stringify({ text: 'later', savedAt: clock.now + 2 * 24 * 60 * 60 * 1000 }));
    map.set(`${PREFIX}soon`, JSON.stringify({ text: 'soon', savedAt: clock.now + 60_000 }));
    expect(readDraft('future', env)).toBe('');
    expect(readDraft('soon', env)).toBe('soon');
    expect(map.has(`${PREFIX}future`)).toBe(false);
  });
});
