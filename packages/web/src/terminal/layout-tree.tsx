import type { PaneLayoutNode } from '@ogden-agents/shared';
import { useRef, useState, type ReactNode } from 'react';
import { clampRatio, MAX_RATIO, MIN_RATIO, RATIO_STEP } from './layout-edit';

/**
 * A tab's split tree (epic 16, story 16.4): each split puts its two children
 * side by side (`row`) or stacked (`column`) at its ratio, with a divider the
 * user drags with the mouse or moves with the arrow keys (a `separator` that
 * takes focus). A drag shows at once and is saved when it ends; a key press
 * is saved each time.
 */

export interface LayoutTreeProps {
  node: PaneLayoutNode;
  /** Draws one pane. */
  renderPane: (paneId: string) => ReactNode;
  /** Saves a split's new ratio. */
  onRatio: (path: string, ratio: number) => void;
  path?: string;
}

export function LayoutTree({ node, renderPane, onRatio, path = '' }: LayoutTreeProps) {
  if (node.type === 'pane') return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{renderPane(node.paneId)}</div>;
  return <Split node={node} path={path} renderPane={renderPane} onRatio={onRatio} />;
}

function Split({ node, path, renderPane, onRatio }: LayoutTreeProps & { node: Extract<PaneLayoutNode, { type: 'split' }>; path: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const row = node.direction === 'row';
  const ratio = dragging ?? node.ratio;
  const percent = Math.round(ratio * 100);

  const ratioAt = (event: React.PointerEvent): number | undefined => {
    const rect = box.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return undefined;
    return clampRatio(row ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height);
  };

  return (
    <div ref={box} data-testid="layout-split" data-direction={node.direction} className={`flex min-h-0 min-w-0 flex-1 ${row ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%` }}>
        <LayoutTree node={node.first} path={`${path}f`} renderPane={renderPane} onRatio={onRatio} />
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-label={row ? 'Resize terminals side by side' : 'Resize terminals one above the other'}
        aria-valuenow={percent}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        data-testid="layout-divider"
        className={`shrink-0 touch-none bg-border hover:bg-accent focus-visible:bg-accent ${row ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(node.ratio);
        }}
        onPointerMove={(event) => {
          if (dragging === undefined) return;
          const next = ratioAt(event);
          if (next !== undefined) setDragging(next);
        }}
        onPointerUp={(event) => {
          if (dragging === undefined) return;
          const next = ratioAt(event) ?? dragging;
          setDragging(undefined);
          if (next !== node.ratio) onRatio(path, next);
        }}
        onKeyDown={(event) => {
          const less = row ? 'ArrowLeft' : 'ArrowUp';
          const more = row ? 'ArrowRight' : 'ArrowDown';
          if (event.key !== less && event.key !== more) return;
          event.preventDefault();
          event.stopPropagation();
          const next = clampRatio(node.ratio + (event.key === more ? RATIO_STEP : -RATIO_STEP));
          if (next !== node.ratio) onRatio(path, next);
        }}
      />
      <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - ratio} 1 0%` }}>
        <LayoutTree node={node.second} path={`${path}s`} renderPane={renderPane} onRatio={onRatio} />
      </div>
    </div>
  );
}
