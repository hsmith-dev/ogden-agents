/**
 * The terminal layout's pure operations (epic 16, story 16.4; E16-R4): tabs of
 * split trees of panes. No I/O and no pane here, only ids and shapes; the
 * `Panes` use-cases own the state and call these, and story 16.7 stores the
 * result. A layout never holds output or secrets.
 */
import { PaneLayout, type PaneId, type PaneLayoutNode, type PaneLayoutTab } from '@ogden-agents/shared';

export type SplitDirection = 'row' | 'column';

export const EMPTY_LAYOUT: PaneLayout = { tabs: [], activeTabId: null };

/** The pane ids of a tree, first to last. */
export function leavesOf(node: PaneLayoutNode): PaneId[] {
  return node.type === 'pane' ? [node.paneId] : [...leavesOf(node.first), ...leavesOf(node.second)];
}

/** Every pane id in the layout. */
export function layoutPaneIds(layout: PaneLayout): PaneId[] {
  return layout.tabs.flatMap((tab) => leavesOf(tab.root));
}

/** The tab holding `paneId`. */
export function tabOfPane(layout: PaneLayout, paneId: PaneId): PaneLayoutTab | undefined {
  return layout.tabs.find((tab) => leavesOf(tab.root).includes(paneId));
}

/** A new tab holding `paneId` alone, made active. */
export function addTab(layout: PaneLayout, tabId: string, title: string, paneId: PaneId): PaneLayout {
  return { tabs: [...layout.tabs, { id: tabId, title, root: { type: 'pane', paneId } }], activeTabId: tabId };
}

function splitNode(node: PaneLayoutNode, target: PaneId, added: PaneId, direction: SplitDirection): PaneLayoutNode {
  if (node.type === 'pane') {
    return node.paneId === target ? { type: 'split', direction, ratio: 0.5, first: node, second: { type: 'pane', paneId: added } } : node;
  }
  return { ...node, first: splitNode(node.first, target, added, direction), second: splitNode(node.second, target, added, direction) };
}

/** `added` beside (`row`) or under (`column`) `target`, in the same tab, which becomes active. `undefined` when `target` is in no tab. */
export function splitPane(layout: PaneLayout, target: PaneId, added: PaneId, direction: SplitDirection): PaneLayout | undefined {
  const tab = tabOfPane(layout, target);
  if (tab === undefined) return undefined;
  return { tabs: layout.tabs.map((t) => (t.id === tab.id ? { ...t, root: splitNode(t.root, target, added, direction) } : t)), activeTabId: tab.id };
}

function removeNode(node: PaneLayoutNode, target: PaneId): PaneLayoutNode | undefined {
  if (node.type === 'pane') return node.paneId === target ? undefined : node;
  const first = removeNode(node.first, target);
  const second = removeNode(node.second, target);
  if (first === undefined) return second;
  if (second === undefined) return first;
  return { ...node, first, second };
}

/** `paneId` taken out; its sibling takes its place, and a tab left empty goes. The active tab moves to the last tab when its own went. */
export function removePane(layout: PaneLayout, paneId: PaneId): PaneLayout {
  const tabs: PaneLayoutTab[] = [];
  for (const tab of layout.tabs) {
    const root = removeNode(tab.root, paneId);
    if (root !== undefined) tabs.push({ ...tab, root });
  }
  const active = tabs.some((tab) => tab.id === layout.activeTabId) ? layout.activeTabId : (tabs.at(-1)?.id ?? null);
  return { tabs, activeTabId: active };
}

/** Whether `proposed` is the same panes as `current`, each exactly once, in a valid shape: only the arrangement (ratios, tab names and order, the active tab, which pane sits where) may change. */
export function rearrangement(current: PaneLayout, proposed: unknown): PaneLayout | undefined {
  const parsed = PaneLayout.safeParse(proposed);
  if (!parsed.success) return undefined;
  const layout = parsed.data;
  const ids = layoutPaneIds(layout);
  const before = layoutPaneIds(current);
  if (ids.length !== before.length || new Set(ids).size !== ids.length || !before.every((id) => ids.includes(id))) return undefined;
  if (new Set(layout.tabs.map((tab) => tab.id)).size !== layout.tabs.length) return undefined;
  const active = layout.activeTabId === null ? layout.tabs.length === 0 : layout.tabs.some((tab) => tab.id === layout.activeTabId);
  return active ? layout : undefined;
}

/** Whether `proposed` is a rearrangement of `current` (see {@link rearrangement}). */
export const isRearrangement = (current: PaneLayout, proposed: unknown): boolean => rearrangement(current, proposed) !== undefined;
