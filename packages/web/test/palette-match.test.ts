/**
 * The command palette's matching (epic 26 story 3): case and gaps ignored, a
 * contiguous run before scattered letters (the start best, then a word
 * start), groups kept in their order with the best first inside each, and
 * at most 50 results.
 */
import { describe, expect, it } from 'vitest';
import { matchText, PALETTE_RESULT_CAP, rankItems } from '../src/palette/palette-match';

describe('matchText', () => {
  it('ignores case and marks the matched letters', () => {
    expect(matchText('INVOICE', 'Fix the invoice total')).toEqual({ score: expect.any(Number), indices: [8, 9, 10, 11, 12, 13, 14] });
    expect(matchText('', 'anything')).toEqual({ score: 0, indices: [] });
  });

  it('ignores gaps: the letters in order still match, spaces in the query too', () => {
    expect(matchText('nwcht', 'New chat')?.indices).toEqual([0, 2, 4, 5, 7]);
    expect(matchText('new  ch', 'New chat')?.indices).toEqual([0, 1, 2, 4, 5]);
    expect(matchText('xyz', 'New chat')).toBeUndefined();
    expect(matchText('tahc', 'chat')).toBeUndefined();
  });

  it('a run at the start beats one at a word start, which beats one inside a word, which beats scattered letters', () => {
    const start = matchText('set', 'Settings: Agents')!.score;
    const word = matchText('set', 'Reset settings')!.score;
    const inside = matchText('set', 'Asset')!.score;
    const scattered = matchText('set', 'Select theme')!.score;
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    // The word-start run is the one marked, not the earlier inside one.
    expect(matchText('set', 'Reset settings')?.indices).toEqual([6, 7, 8]);
  });

  it('matches a ticket by its ref', () => {
    expect(matchText('1.2', '1.2 Build the second thing')?.indices).toEqual([0, 1, 2]);
  });
});

describe('rankItems', () => {
  const item = (group: string, label: string, keywords?: string[]) => ({ group, label, keywords });

  it('keeps the groups in the order given, best first inside each, ties in the given order', () => {
    const items = [item('actions', 'Settings: Notes'), item('chats', 'Write notes'), item('chats', 'Notes app'), item('projects', 'Notebook'), item('chats', 'Other notes')];
    const ranked = rankItems('note', items, ['chats', 'projects', 'actions']);
    expect(ranked.map((each) => each.item.label)).toEqual(['Notes app', 'Write notes', 'Other notes', 'Notebook', 'Settings: Notes']);
  });

  it('leaves out a group not in the order, and items that do not match', () => {
    const ranked = rankItems('a', [item('files', 'a.ts'), item('chats', 'alpha'), item('chats', 'zzz')], ['chats']);
    expect(ranked.map((each) => each.item.label)).toEqual(['alpha']);
  });

  it('an empty query keeps every item of the ordered groups in the given order', () => {
    const ranked = rankItems('  ', [item('projects', 'B'), item('actions', 'X'), item('projects', 'A')], ['actions', 'projects']);
    expect(ranked.map((each) => each.item.label)).toEqual(['X', 'B', 'A']);
  });

  it('a keyword matches after any label match, with nothing marked', () => {
    const ranked = rankItems('appearance', [item('actions', 'Theme: Dark', ['Appearance']), item('actions', 'Settings: Appearance')], ['actions']);
    expect(ranked.map((each) => [each.item.label, each.indices.length])).toEqual([
      ['Settings: Appearance', 10],
      ['Theme: Dark', 0],
    ]);
  });

  it('stops at 50 results', () => {
    const items = Array.from({ length: 80 }, (_, i) => item(i % 2 === 0 ? 'chats' : 'actions', `chat ${i}`));
    const ranked = rankItems('chat', items, ['chats', 'actions']);
    expect(PALETTE_RESULT_CAP).toBe(50);
    expect(ranked).toHaveLength(50);
    expect(ranked.filter((each) => each.item.group === 'chats')).toHaveLength(40);
  });
});
