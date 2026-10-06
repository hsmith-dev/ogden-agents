import type { PaneLayout, PaneLayoutNode } from '@ogden-agents/shared';

/**
 * Small pure edits of a layout tree the page makes before it asks the server
 * to arrange it (epic 16, story 16.4). A node is addressed by a path of `f`
 * (first child) and `s` (second child) from the tab's root; `''` is the root.
 */

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
/** How far an arrow key moves a divider. */
export const RATIO_STEP = 0.05;

export const clampRatio = (ratio: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

/** `root` with the split at `path` at `ratio`. */
export function withRatio(root: PaneLayoutNode, path: string, ratio: number): PaneLayoutNode {
  if (root.type === 'pane') return root;
  if (path === '') return { ...root, ratio: clampRatio(ratio) };
  const [head, ...rest] = path;
  return head === 'f' ? { ...root, first: withRatio(root.first, rest.join(''), ratio) } : { ...root, second: withRatio(root.second, rest.join(''), ratio) };
}

/** The split at `path`, if there is one. */
export function nodeAt(root: PaneLayoutNode, path: string): PaneLayoutNode | undefined {
  let node: PaneLayoutNode = root;
  for (const step of path) {
    if (node.type === 'pane') return undefined;
    node = step === 'f' ? node.first : node.second;
  }
  return node;
}

/** The layout with one tab's root replaced. */
export function withTabRoot(layout: PaneLayout, tabId: string, root: PaneLayoutNode): PaneLayout {
  return { ...layout, tabs: layout.tabs.map((tab) => (tab.id === tabId ? { ...tab, root } : tab)) };
}

export function withTabTitle(layout: PaneLayout, tabId: string, title: string): PaneLayout {
  return { ...layout, tabs: layout.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)) };
}

export const withActiveTab = (layout: PaneLayout, tabId: string): PaneLayout => ({ ...layout, activeTabId: tabId });

export type FocusDirection = 'left' | 'right' | 'up' | 'down';

/** The rectangle of a pane on screen, for moving focus. */
export interface PaneBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The pane that focus moves to from `from` in `direction`: among the panes
 * wholly on that side, the one that overlaps `from` most across the other axis,
 * then the nearest. `undefined` when there is none (focus stays).
 */
export function neighbour(boxes: readonly PaneBox[], from: string, direction: FocusDirection): string | undefined {
  const origin = boxes.find((box) => box.id === from);
  if (origin === undefined) return undefined;
  let best: { id: string; overlap: number; distance: number } | undefined;
  for (const box of boxes) {
    if (box.id === from) continue;
    const horizontal = direction === 'left' || direction === 'right';
    const beyond = direction === 'left' ? box.right <= origin.left + 1 : direction === 'right' ? box.left >= origin.right - 1 : direction === 'up' ? box.bottom <= origin.top + 1 : box.top >= origin.bottom - 1;
    if (!beyond) continue;
    const overlap = horizontal ? Math.min(box.bottom, origin.bottom) - Math.max(box.top, origin.top) : Math.min(box.right, origin.right) - Math.max(box.left, origin.left);
    if (overlap <= 0) continue;
    const distance = direction === 'left' ? origin.left - box.right : direction === 'right' ? box.left - origin.right : direction === 'up' ? origin.top - box.bottom : box.top - origin.bottom;
    if (best === undefined || overlap > best.overlap || (overlap === best.overlap && distance < best.distance)) best = { id: box.id, overlap, distance };
  }
  return best?.id;
}

/** The longest name a pane or tab may have (the server's own limit). */
export const MAX_NAME_LENGTH = 80;
