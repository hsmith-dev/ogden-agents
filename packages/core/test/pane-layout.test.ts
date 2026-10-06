/** The terminal layout's pure operations (epic 16, story 16.4). */
import type { PaneId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { addTab, EMPTY_LAYOUT, isRearrangement, layoutPaneIds, leavesOf, removePane, splitPane, tabOfPane } from '../src/index.js';

const id = (n: number) => `pan_01J9Z3K4M5N6P7Q8R9S0T1V2W${n}` as PaneId;

describe('the layout operations', () => {
  it('adds a tab with one pane and makes it active', () => {
    const layout = addTab(EMPTY_LAYOUT, 't1', 'Terminal 1', id(1));
    expect(layout).toEqual({ tabs: [{ id: 't1', title: 'Terminal 1', root: { type: 'pane', paneId: id(1) } }], activeTabId: 't1' });
  });

  it('splits a pane beside or under, nesting', () => {
    let layout = addTab(EMPTY_LAYOUT, 't1', 'T', id(1));
    layout = splitPane(layout, id(1), id(2), 'row')!;
    layout = splitPane(layout, id(2), id(3), 'column')!;
    expect(layout.tabs[0]!.root).toEqual({
      type: 'split',
      direction: 'row',
      ratio: 0.5,
      first: { type: 'pane', paneId: id(1) },
      second: { type: 'split', direction: 'column', ratio: 0.5, first: { type: 'pane', paneId: id(2) }, second: { type: 'pane', paneId: id(3) } },
    });
    expect(leavesOf(layout.tabs[0]!.root)).toEqual([id(1), id(2), id(3)]);
    expect(splitPane(layout, id(9), id(4), 'row')).toBeUndefined();
  });

  it('closing a pane gives its space to its sibling, drops an empty tab and moves the active tab', () => {
    let layout = addTab(EMPTY_LAYOUT, 't1', 'A', id(1));
    layout = splitPane(layout, id(1), id(2), 'row')!;
    layout = addTab(layout, 't2', 'B', id(3));
    expect(removePane(layout, id(2)).tabs[0]!.root).toEqual({ type: 'pane', paneId: id(1) });
    const without3 = removePane(layout, id(3));
    expect(without3.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(without3.activeTabId).toBe('t1');
    expect(removePane(removePane(without3, id(1)), id(2))).toEqual(EMPTY_LAYOUT);
  });

  it('finds the tab of a pane', () => {
    const layout = splitPane(addTab(addTab(EMPTY_LAYOUT, 't1', 'A', id(1)), 't2', 'B', id(2)), id(2), id(3), 'row')!;
    expect(tabOfPane(layout, id(3))!.id).toBe('t2');
    expect(layoutPaneIds(layout)).toEqual([id(1), id(2), id(3)]);
  });

  it('accepts only a rearrangement of the same panes', () => {
    const current = splitPane(addTab(EMPTY_LAYOUT, 't1', 'A', id(1)), id(1), id(2), 'row')!;
    const resized = { ...current, tabs: [{ ...current.tabs[0]!, title: 'Renamed', root: { ...current.tabs[0]!.root, ratio: 0.3 } }] };
    expect(isRearrangement(current, resized)).toBe(true);
    expect(isRearrangement(current, addTab(current, 't2', 'B', id(3)))).toBe(false);
    expect(isRearrangement(current, removePane(current, id(2)))).toBe(false);
    expect(isRearrangement(current, { ...current, activeTabId: 'nope' })).toBe(false);
    expect(isRearrangement(current, { tabs: [current.tabs[0], current.tabs[0]], activeTabId: 't1' })).toBe(false);
    expect(isRearrangement(current, { tabs: 'x' })).toBe(false);
  });
});
