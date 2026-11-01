/**
 * The command palette's matching (epic 26 story 3; EXPERIENCE.md Command
 * palette): a query matches a name ignoring case and gaps. A contiguous run
 * of the query scores first (at the very start best, then at a word start,
 * then anywhere, earlier better); else its letters in order, closer together
 * better. Pure, so the order rules are unit-tested.
 */

/** At most this many results show (EXPERIENCE.md Command palette). */
export const PALETTE_RESULT_CAP = 50;

export interface TextMatch {
  /** Higher is better. */
  score: number;
  /** The matched letters' positions in the text, ascending. */
  indices: number[];
}

const isWordStart = (text: string, index: number) => index === 0 || /[\s\-_./:]/.test(text[index - 1]!);

/** How `query` matches `text`, or `undefined` when it does not. An empty query matches everything with no letters marked. */
export function matchText(query: string, text: string): TextMatch | undefined {
  const needle = query.trim().toLowerCase();
  if (needle === '') return { score: 0, indices: [] };
  const haystack = text.toLowerCase();
  const range = (start: number, length: number) => Array.from({ length }, (_, i) => start + i);

  // A contiguous run: the best placed one wins.
  let best: TextMatch | undefined;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const score = at === 0 ? 3000 : isWordStart(text, at) ? 2000 - at : 1000 - at;
    if (best === undefined || score > best.score) best = { score, indices: range(at, needle.length) };
  }
  if (best !== undefined) return best;

  // The letters in order, gaps (spaces in the query too) ignored.
  const letters = needle.replace(/\s+/g, '');
  const indices: number[] = [];
  let from = 0;
  for (const letter of letters) {
    const at = haystack.indexOf(letter, from);
    if (at === -1) return undefined;
    indices.push(at);
    from = at + 1;
  }
  const spread = indices.at(-1)! - indices[0]! + 1 - indices.length;
  const starts = indices.filter((index) => isWordStart(text, index)).length;
  return { score: Math.max(1, 500 + starts * 20 - spread - indices[0]!), indices };
}

/** What a ranked item needs: its group, its name and other words it answers to. */
export interface RankableItem<G extends string = string> {
  group: G;
  label: string;
  keywords?: readonly string[] | undefined;
}

export interface RankedItem<T> {
  item: T;
  /** The label's matched letters (none when only a keyword matched). */
  indices: number[];
}

/** How an item matches: by its label, else by a keyword (ranked lower, nothing marked). */
function matchItem(query: string, item: RankableItem): TextMatch | undefined {
  const byLabel = matchText(query, item.label);
  if (byLabel !== undefined) return byLabel;
  let best: number | undefined;
  for (const keyword of item.keywords ?? []) {
    const match = matchText(query, keyword);
    if (match !== undefined && (best === undefined || match.score > best)) best = match.score;
  }
  return best === undefined ? undefined : { score: best / 10, indices: [] };
}

/**
 * The results: groups in `order` (a group not in it is left out), within a
 * group best first (ties keep the given order), at most `cap` in all. An
 * empty query keeps every item in its given order.
 */
export function rankItems<T extends RankableItem>(query: string, items: readonly T[], order: readonly T['group'][], cap = PALETTE_RESULT_CAP): RankedItem<T>[] {
  const results: RankedItem<T>[] = [];
  for (const group of order) {
    const scored: { item: T; match: TextMatch; index: number }[] = [];
    items.forEach((item, index) => {
      if (item.group !== group) return;
      const match = matchItem(query, item);
      if (match !== undefined) scored.push({ item, match, index });
    });
    scored.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
    for (const { item, match } of scored) {
      if (results.length >= cap) return results;
      results.push({ item, indices: match.indices });
    }
  }
  return results;
}
