// @vitest-environment happy-dom
/**
 * Unsent line comments' storage (story 8.6), like composer drafts': one
 * entry per project and owner, expiry 7 days after the last change,
 * unreadable entries dropped, blocked storage tolerated, and the owner cap.
 */
import type { LineComment } from '@ogden-agents/shared';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  LINE_COMMENTS_MAX_OWNERS,
  LINE_COMMENTS_TTL_MS,
  lineCommentsKey,
  pruneLineComments,
  readLineComments,
  useLineComments,
  writeLineComments,
  type LineCommentsEnv,
} from '../src/workbench/line-comments';

const PREFIX = 'ogden-agents.line-comments.v1:';

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
  const env: LineCommentsEnv = { storage: () => storage, now: () => clock.now };
  return { env, map, clock };
}

const comment = (id = 'c1'): LineComment => ({ id, path: 'a.ts', side: 'new', start: 58, end: 58, quote: ['+ x'], text: 'Fix it.', createdAt: 1 });

describe('line comments storage (story 8.6)', () => {
  it('keys each project and owner apart', () => {
    expect(lineCommentsKey('ws_1', 'project')).not.toBe(lineCommentsKey('ws_1', 'ses_1'));
    expect(lineCommentsKey('ws_1', 'review:run_1')).not.toBe(lineCommentsKey('ws_2', 'review:run_1'));
  });

  it('keeps comments, forgets them when none are left, and drops them 7 days after the last change', () => {
    const { env, map, clock } = memoryEnv();
    const key = lineCommentsKey('ws_1', 'project');
    writeLineComments(key, [comment()], env);
    expect(readLineComments(key, env)).toEqual([comment()]);
    clock.now += LINE_COMMENTS_TTL_MS - 1;
    writeLineComments(key, [comment(), comment('c2')], env);
    clock.now += LINE_COMMENTS_TTL_MS - 1;
    expect(readLineComments(key, env)).toHaveLength(2);
    clock.now += 2;
    expect(readLineComments(key, env)).toEqual([]);
    expect(map.size).toBe(0);
    writeLineComments(key, [comment()], env);
    writeLineComments(key, [], env);
    expect(map.size).toBe(0);
  });

  it('reads an unreadable or hand-edited entry as none, and prunes it', () => {
    const { env, map } = memoryEnv();
    map.set(`${PREFIX}ws_1:project`, '{nope');
    map.set(`${PREFIX}ws_1:ses_1`, JSON.stringify({ comments: [{ ...comment(), text: 'x'.repeat(5000) }], savedAt: 1_000_000 }));
    expect(readLineComments('ws_1:project', env)).toEqual([]);
    expect(readLineComments('ws_1:ses_1', env)).toEqual([]);
    pruneLineComments(env);
    expect(map.size).toBe(0);
  });

  it('keeps at most the newest owners', () => {
    const { env, map, clock } = memoryEnv();
    for (let index = 0; index <= LINE_COMMENTS_MAX_OWNERS; index++) {
      clock.now += 1;
      writeLineComments(lineCommentsKey('ws_1', `ses_${index}`), [comment()], env);
    }
    expect(map.size).toBe(LINE_COMMENTS_MAX_OWNERS);
    expect(map.has(`${PREFIX}ws_1:ses_0`)).toBe(false);
  });

  it('tolerates storage that throws', () => {
    const env: LineCommentsEnv = {
      storage: () => {
        throw new Error('blocked');
      },
      now: () => 1,
    };
    expect(() => writeLineComments('k', [comment()], env)).not.toThrow();
    expect(readLineComments('k', env)).toEqual([]);
  });

  it('with storage blocked, the hook keeps comments in the page only', () => {
    const env: LineCommentsEnv = {
      storage: () => {
        throw new Error('blocked');
      },
      now: () => 1,
    };
    const { result } = renderHook(() => useLineComments('ws_1:project', env));
    expect(result.current.comments).toEqual([]);
    act(() => void result.current.add(comment()));
    act(() => result.current.update('c1', 'Changed.'));
    expect(result.current.comments).toEqual([{ ...comment(), text: 'Changed.' }]);
    expect(readLineComments('ws_1:project', env)).toEqual([]);
    act(() => result.current.remove('c1'));
    expect(result.current.comments).toEqual([]);
  });
});
