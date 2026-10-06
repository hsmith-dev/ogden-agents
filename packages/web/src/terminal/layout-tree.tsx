import type { PaneLayoutNode } from '@ogden-agents/shared';
import { useRef, useState, type ReactNode } from 'react';
import { clampRatio, MAX_RATIO, MIN_RATIO, RATIO_STEP } from './layout-edit';

/**
 * A tab's split tree (epic 16, story 16.4), drawn as a FLAT list of panes
 * placed by rectangle, never as nested boxes: a split or a close changes where
 * the panes sit, not where they are in the page's tree, so React keeps every
 * pane (its xterm and its socket) mounted. Each split has a divider the user
 * drags with the mouse or moves with the arrow keys (a `separator` that takes
 * focus). A drag shows at once and is saved when it ends; a key press is saved
 * each time.
 */

/** A rectangle as fractions of the stage. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SplitLine {
  /** The split's path from the root (`f` first child, `s` second). */
  path: string;
  direction: 'row' | 'column';
  ratio: number;
  /** The split's own rectangle. */
  rect: Rect;
}

/** Where each pane and each split sit, for a tree filling the unit square. `ratios` replaces a split's ratio (a drag in progress). */
export function placeTree(node: PaneLayoutNode, ratios: ReadonlyMap<string, number> = new Map()): { panes: Map<string, Rect>; splits: SplitLine[] } {
  const panes = new Map<string, Rect>();
  const splits: SplitLine[] = [];
  const walk = (current: PaneLayoutNode, rect: Rect, path: string) => {
    if (current.type === 'pane') {
      panes.set(current.paneId, rect);
      return;
    }
    const ratio = ratios.get(path) ?? current.ratio;
    splits.push({ path, direction: current.direction, ratio, rect });
    if (current.direction === 'row') {
      walk(current.first, { ...rect, w: rect.w * ratio }, `${path}f`);
      walk(current.second, { x: rect.x + rect.w * ratio, y: rect.y, w: rect.w * (1 - ratio), h: rect.h }, `${path}s`);
    } else {
      walk(current.first, { ...rect, h: rect.h * ratio }, `${path}f`);
      walk(current.second, { x: rect.x, y: rect.y + rect.h * ratio, w: rect.w, h: rect.h * (1 - ratio) }, `${path}s`);
    }
  };
  walk(node, { x: 0, y: 0, w: 1, h: 1 }, '');
  return { panes, splits };
}

const percent = (fraction: number) => `${fraction * 100}%`;

export interface LayoutStageProps {
  node: PaneLayoutNode;
  /** Draws one pane. */
  renderPane: (paneId: string) => ReactNode;
  /** Saves a split's new ratio. */
  onRatio: (path: string, ratio: number) => void;
  /** The ids of the panes to draw, in a steady order (the keys of the flat list). */
  paneIds: readonly string[];
}

export function LayoutStage({ node, renderPane, onRatio, paneIds }: LayoutStageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ path: string; ratio: number } | undefined>(undefined);
  const { panes, splits } = placeTree(node, drag === undefined ? undefined : new Map([[drag.path, drag.ratio]]));

  /** The ratio a pointer at `event` means for `split`: its position within the split's own rectangle. */
  const ratioAt = (event: React.PointerEvent, split: SplitLine): number | undefined => {
    const bounds = stage.current?.getBoundingClientRect();
    if (bounds === undefined || bounds.width === 0 || bounds.height === 0) return undefined;
    const row = split.direction === 'row';
    const start = (row ? split.rect.x * bounds.width : split.rect.y * bounds.height) + (row ? bounds.left : bounds.top);
    const size = row ? split.rect.w * bounds.width : split.rect.h * bounds.height;
    return size === 0 ? undefined : clampRatio(((row ? event.clientX : event.clientY) - start) / size);
  };

  return (
    <div ref={stage} data-testid="layout-stage" className="relative min-h-0 min-w-0 flex-1">
      {paneIds.map((paneId) => {
        const rect = panes.get(paneId);
        // A pane not in this tab's tree (another tab's) is not drawn: its terminal is not connected.
        return rect === undefined ? null : (
          <div key={paneId} className="absolute flex min-h-0 min-w-0 flex-col p-0.5" style={{ left: percent(rect.x), top: percent(rect.y), width: percent(rect.w), height: percent(rect.h) }}>
            {renderPane(paneId)}
          </div>
        );
      })}
      {splits.map((split) => {
        const row = split.direction === 'row';
        const live = split.ratio;
        return (
          <div
            key={split.path}
            role="separator"
            tabIndex={0}
            aria-orientation={row ? 'vertical' : 'horizontal'}
            aria-label={row ? 'Resize terminals side by side' : 'Resize terminals one above the other'}
            aria-valuenow={Math.round(live * 100)}
            aria-valuemin={Math.round(MIN_RATIO * 100)}
            aria-valuemax={Math.round(MAX_RATIO * 100)}
            data-testid="layout-divider"
            className={`absolute z-10 touch-none bg-border hover:bg-accent focus-visible:bg-accent ${row ? 'w-1 -translate-x-1/2 cursor-col-resize' : 'h-1 -translate-y-1/2 cursor-row-resize'}`}
            style={
              row
                ? { left: percent(split.rect.x + split.rect.w * live), top: percent(split.rect.y), height: percent(split.rect.h) }
                : { top: percent(split.rect.y + split.rect.h * live), left: percent(split.rect.x), width: percent(split.rect.w) }
            }
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDrag({ path: split.path, ratio: split.ratio });
            }}
            onPointerMove={(event) => {
              if (drag?.path !== split.path) return;
              const next = ratioAt(event, split);
              if (next !== undefined) setDrag({ path: split.path, ratio: next });
            }}
            onPointerUp={(event) => {
              if (drag?.path !== split.path) return;
              const next = ratioAt(event, split) ?? drag.ratio;
              setDrag(undefined);
              // A click without a move is not a change.
              if (Math.abs(next - nodeRatio(node, split.path)) >= 0.005) onRatio(split.path, next);
            }}
            onPointerCancel={() => setDrag(undefined)}
            onLostPointerCapture={() => setDrag(undefined)}
            onKeyDown={(event) => {
              const less = row ? 'ArrowLeft' : 'ArrowUp';
              const more = row ? 'ArrowRight' : 'ArrowDown';
              if (event.key !== less && event.key !== more) return;
              event.preventDefault();
              event.stopPropagation();
              const next = clampRatio(nodeRatio(node, split.path) + (event.key === more ? RATIO_STEP : -RATIO_STEP));
              if (next !== nodeRatio(node, split.path)) onRatio(split.path, next);
            }}
          />
        );
      })}
    </div>
  );
}

/** The saved ratio of the split at `path`. */
function nodeRatio(root: PaneLayoutNode, path: string): number {
  let node: PaneLayoutNode = root;
  for (const step of path) {
    if (node.type === 'pane') return 0.5;
    node = step === 'f' ? node.first : node.second;
  }
  return node.type === 'split' ? node.ratio : 0.5;
}
