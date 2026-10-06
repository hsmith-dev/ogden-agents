import type { Pane, PaneLayoutNode, PaneStatus } from '@ogden-agents/shared';

/** What the page calls each status (plain words; the status is a guess, and the page says so). */
export const STATUS_WORDS: Readonly<Record<PaneStatus, string>> = {
  working: 'Working',
  needs_attention: 'Needs attention',
  idle: 'Idle',
  exited: 'Ended',
};

/** The status a tab shows: needs attention if any of its panes does, else working if any is, else idle (all ended: ended). */
export function statusOfTab(root: PaneLayoutNode, panes: ReadonlyMap<string, Pane>): PaneStatus | undefined {
  const statuses: PaneStatus[] = [];
  const walk = (node: PaneLayoutNode) => {
    if (node.type === 'pane') {
      const pane = panes.get(node.paneId);
      if (pane !== undefined) statuses.push(pane.status);
    } else {
      walk(node.first);
      walk(node.second);
    }
  };
  walk(root);
  if (statuses.length === 0) return undefined;
  for (const status of ['needs_attention', 'working', 'idle'] as const) if (statuses.includes(status)) return status;
  return 'exited';
}
