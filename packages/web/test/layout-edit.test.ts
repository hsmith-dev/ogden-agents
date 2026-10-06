import type { PaneLayoutNode } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { MAX_RATIO, MIN_RATIO, neighbour, nodeAt, withRatio, type PaneBox } from '../src/terminal/layout-edit';

const leaf = (n: number) => ({ type: 'pane' as const, paneId: `pan_01J9Z3K4M5N6P7Q8R9S0T1V2W${n}` as never });
const tree: PaneLayoutNode = { type: 'split', direction: 'row', ratio: 0.5, first: leaf(1), second: { type: 'split', direction: 'column', ratio: 0.5, first: leaf(2), second: leaf(3) } };

describe('layout edits', () => {
  it('sets the ratio of the split at a path, clamped so no pane vanishes', () => {
    expect((withRatio(tree, '', 0.3) as { ratio: number }).ratio).toBe(0.3);
    expect(((withRatio(tree, 's', 0.7) as { second: { ratio: number } }).second).ratio).toBe(0.7);
    expect((withRatio(tree, '', 0) as { ratio: number }).ratio).toBe(MIN_RATIO);
    expect((withRatio(tree, '', 5) as { ratio: number }).ratio).toBe(MAX_RATIO);
    expect(withRatio(leaf(1), '', 0.2)).toEqual(leaf(1));
    expect(nodeAt(tree, 's')?.type).toBe('split');
    expect(nodeAt(tree, 'ff')).toBeUndefined();
  });
});

describe('moving focus by keyboard', () => {
  // 1 on the left, 2 top right, 3 bottom right.
  const boxes: PaneBox[] = [
    { id: 'a', left: 0, top: 0, right: 100, bottom: 100 },
    { id: 'b', left: 100, top: 0, right: 200, bottom: 50 },
    { id: 'c', left: 100, top: 50, right: 200, bottom: 100 },
  ];
  it('goes to the pane on that side that overlaps most, and stays when there is none', () => {
    expect(neighbour(boxes, 'a', 'right')).toBe('b');
    expect(neighbour(boxes, 'b', 'down')).toBe('c');
    expect(neighbour(boxes, 'c', 'up')).toBe('b');
    expect(neighbour(boxes, 'c', 'left')).toBe('a');
    expect(neighbour(boxes, 'a', 'left')).toBeUndefined();
    expect(neighbour(boxes, 'b', 'up')).toBeUndefined();
    expect(neighbour(boxes, 'zzz', 'up')).toBeUndefined();
  });
});
