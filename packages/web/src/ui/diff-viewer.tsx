import { DIFF_FILES_OPEN, FILE_CHANGE_WORDS, SIDE_BY_SIDE_NARROW_TEXT, type FileChange } from '@ogden-agents/shared';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { DiffFile, type DiffSlots } from './diff/diff-file';
import { DIFF_LAYOUT_WORDS, setDiffLayout, useDiffLayout, useWideEnough, type DiffLayout } from './diff/layout';
import type { DiffFileData } from './diff/parse-unified';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';
import { Text } from './typography';
import { cn } from './utils';

/**
 * The diff viewer (story 8.3; DESIGN.md and EXPERIENCE.md Diff viewer): one
 * component for chat edit rows, Changes and Review. Per file a section with
 * a sticky header; the first {@link DIFF_FILES_OPEN} files open, the rest
 * listed collapsed. `layout="choice"` adds the toolbar's Inline | Side by
 * side switch (remembered in this browser; Side by side from `lg`, Inline
 * below with a line saying why); `layout="inline"` is Inline with no
 * toolbar (a chat edit row). Lines always wrap: the viewer never scrolls
 * sideways. With focus inside, `n` / `p` move between hunks and `j` / `k`
 * between lines (one roving tab stop; the focused row has `data-current`).
 * The tab stop row's line actions (8.6's Comment button) are tab stops too,
 * and `c` on a focused line clicks its (last) one; `C` clicks it with Shift
 * (a range from the last focused line).
 *
 * Slots for later stories: `fileActions`, `hunkActions`, `lineAfter`, `lineActions`.
 */

export type { DiffFileData } from './diff/parse-unified';
export type { DiffSlots } from './diff/diff-file';

/** What a page holding the viewer can ask of it. */
export interface DiffViewerHandle {
  /** Opens `path`'s section, scrolls to it and moves focus to its header. */
  jumpTo(path: string): void;
}

export interface DiffViewerProps extends DiffSlots {
  files: readonly DiffFileData[];
  /** `choice` (default): the layout switch; `inline`: Inline only, no toolbar. */
  layout?: 'choice' | 'inline';
  /** The viewer's accessible name. */
  label: string;
  /** Called with a file's path when focus or a jump moves to it. */
  onJump?: (path: string) => void;
  ref?: Ref<DiffViewerHandle>;
  className?: string;
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

/** The buttons of a row's line actions. */
const lineActionButtons = (row: HTMLElement): HTMLElement[] => [...row.querySelectorAll<HTMLElement>('[data-slot="diff-line-action"] button')];

/** A row's line actions as tab stops (`on`) or not. */
function setActionStops(row: HTMLElement, on: boolean): void {
  for (const button of lineActionButtons(row)) button.tabIndex = on ? 0 : -1;
}

export function DiffViewer({ files, layout = 'choice', label, onJump, ref, className, fileActions, hunkActions, lineAfter, lineActions }: DiffViewerProps) {
  const stored = useDiffLayout();
  const wide = useWideEnough();
  const effective: DiffLayout = layout === 'inline' || !wide ? 'inline' : stored;
  const root = useRef<HTMLDivElement>(null);
  // Files whose open state the user flipped from the default (the first DIFF_FILES_OPEN open).
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const [jump, setJump] = useState<{ path: string } | undefined>(undefined);
  const lastPath = useRef<string | undefined>(undefined);

  const isOpen = useCallback((path: string, index: number) => (index < DIFF_FILES_OPEN) !== flipped.has(path), [flipped]);
  const toggle = (path: string) =>
    setFlipped((was) => {
      const next = new Set(was);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  // The roving tab stop, kept on the DOM so a focus move touches only the old and new rows.
  const stop = useRef<HTMLElement | null>(null);
  const stopLayout = useRef<DiffLayout>(effective);
  const moveStop = (row: HTMLElement | null) => {
    if (stop.current === row) return;
    if (stop.current !== null) {
      stop.current.tabIndex = -1;
      delete stop.current.dataset.current;
      setActionStops(stop.current, false);
    }
    stop.current = row;
    if (row !== null) {
      row.tabIndex = 0;
      row.dataset.current = 'true';
      setActionStops(row, true);
    }
  };
  useLayoutEffect(() => {
    // A layout switch renumbers the rows, and a collapsed file's rows are gone: the stop goes back to the first row.
    const keep = stop.current !== null && stop.current.isConnected && stopLayout.current === effective;
    stopLayout.current = effective;
    if (keep) return;
    stop.current = null;
    moveStop(root.current?.querySelector<HTMLElement>('[data-diff-nav]') ?? null);
  }, [files, flipped, effective]);
  // A render may have put new line actions in the stop's row: they are tab stops too.
  useLayoutEffect(() => {
    if (stop.current !== null && stop.current.isConnected) setActionStops(stop.current, true);
  });

  const announce = (path: string) => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    onJump?.(path);
  };

  useImperativeHandle(ref, () => ({
    jumpTo(path: string) {
      const index = files.findIndex((entry) => entry.file.path === path);
      if (index < 0) return;
      if (!isOpen(path, index)) toggle(path);
      setJump({ path });
    },
  }));

  useEffect(() => {
    if (jump === undefined || root.current === null) return;
    const section = [...root.current.querySelectorAll<HTMLElement>('[data-diff-file]')].find((element) => element.dataset.diffFile === jump.path);
    setJump(undefined);
    if (section === undefined) return;
    section.scrollIntoView?.({ block: 'start' });
    section.querySelector<HTMLElement>('[data-slot="diff-file-toggle"]')?.focus({ preventScroll: true });
    announce(jump.path);
    // `announce` reads the latest `onJump`; only a new jump runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    const key = event.key;
    if (key === 'c' || key === 'C') {
      const row = event.target instanceof HTMLElement && event.target.matches('[data-diff-nav="line"]') ? event.target : null;
      const button = row === null ? undefined : lineActionButtons(row).at(-1);
      if (button === undefined) return;
      event.preventDefault();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: key === 'C' }));
      return;
    }
    if (key !== 'j' && key !== 'k' && key !== 'n' && key !== 'p') return;
    const container = root.current;
    if (container === null) return;
    const rows = [...container.querySelectorAll<HTMLElement>(key === 'n' || key === 'p' ? '[data-diff-nav="hunk"]' : '[data-diff-nav="line"]')];
    if (rows.length === 0) return;
    const current = (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>('[data-diff-nav]') ?? null;
    const forward = key === 'j' || key === 'n';
    let next: HTMLElement | undefined;
    if (current === null) next = forward ? rows[0] : rows[rows.length - 1];
    else if (forward) next = rows.find((row) => row !== current && (current.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    else next = rows.findLast((row) => row !== current && (current.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING) !== 0);
    if (next === undefined) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView?.({ block: 'nearest' });
  };

  const onFocus = (event: { target: EventTarget }) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-diff-key]') : null;
    if (row === null) return;
    moveStop(row);
    if (row.dataset.diffPath !== undefined) announce(row.dataset.diffPath);
  };

  const slots = { fileActions, hunkActions, lineAfter, lineActions };
  const narrow = layout === 'choice' && stored === 'split' && !wide;
  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      className={cn('flex min-w-0 flex-col gap-2', className)}
      data-testid="diff-viewer"
      data-layout={effective}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {layout === 'choice' ? (
        <div className="flex flex-wrap items-center gap-2" data-slot="diff-toolbar">
          <ToggleGroup
            type="single"
            aria-label="Layout"
            value={stored}
            onValueChange={(value) => {
              if (value === 'inline' || value === 'split') setDiffLayout(value);
            }}
            data-testid="diff-layout"
          >
            {(['inline', 'split'] as const).map((value) => (
              <ToggleGroupItem key={value} value={value} data-testid={`diff-layout-${value}`}>
                {DIFF_LAYOUT_WORDS[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {narrow ? (
            <Text variant="caption" data-testid="diff-layout-narrow">
              {SIDE_BY_SIDE_NARROW_TEXT}
            </Text>
          ) : null}
        </div>
      ) : null}
      {files.map((data, index) => (
        <DiffFile key={`${data.file.path}\0${index}`} data={data} open={isOpen(data.file.path, index)} onToggle={() => toggle(data.file.path)} layout={effective} slots={slots} />
      ))}
    </div>
  );
}

/** One entry of a file list: its path, and its change and counts when the diff has them. */
export interface DiffFileListItem {
  path: string;
  change?: FileChange;
  additions?: number;
  deletions?: number;
  /** Whether the viewer has this file, so selecting it jumps there. */
  jumpable: boolean;
}

/** The clickable file list beside or above a viewer: each file with a diff is a button that jumps to it. */
export function DiffFileList({ items, onSelect, className, ...props }: { items: readonly DiffFileListItem[]; onSelect: (path: string) => void; className?: string; 'data-testid'?: string }) {
  return (
    <ul className={cn('m-0 flex list-none flex-col gap-1 p-0', className)} {...props}>
      {items.map((item) => {
        const details = (
          <>
            <span className="min-w-0 font-mono text-mono-compact [overflow-wrap:anywhere]">{item.path}</span>
            {item.change === undefined ? null : <span className="shrink-0 text-caption text-muted-foreground">{FILE_CHANGE_WORDS[item.change]}</span>}
            {item.additions === undefined || item.deletions === undefined ? null : (
              <span className="shrink-0 font-mono text-mono-compact tabular-nums">
                <span className="text-syntax-string">+{item.additions}</span> <span className="text-syntax-number">-{item.deletions}</span>
              </span>
            )}
          </>
        );
        return (
          <li key={item.path} className="min-w-0" data-testid="diff-file-list-item" data-path={item.path}>
            {item.jumpable ? (
              <button type="button" className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 rounded-sm text-left text-foreground hover:underline" onClick={() => onSelect(item.path)}>
                {details}
              </button>
            ) : (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-foreground">{details}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
