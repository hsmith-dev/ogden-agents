// @vitest-environment happy-dom
/**
 * The diff viewer (story 8.3): a section per file with its sticky header,
 * the first 20 open and the rest collapsed, the file list's jump, the
 * Inline | Side by side switch remembered in this browser and Inline below
 * `lg`, labelled tables and rows, binary and too-large files, `n` / `p` /
 * `j` / `k`, and the slots later stories fill.
 */
import { DIFF_BINARY_TEXT, DIFF_TOO_LARGE_TEXT, SIDE_BY_SIDE_NARROW_TEXT, type ChangedFile } from '@ogden-agents/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { DIFF_LAYOUT_KEY, resetDiffLayoutForTests } from '../src/ui/diff/layout';
import { diffTexts } from '../src/ui/diff/line-diff';
import { DiffFileList, DiffViewer, type DiffFileData, type DiffViewerHandle } from '../src/ui/diff-viewer';

const changed = (path: string, overrides: Partial<ChangedFile> = {}): ChangedFile => ({ path, change: 'changed', additions: 1, deletions: 1, binary: false, tooLarge: false, ...overrides });
const fileOf = (path: string, before = 'one\ntwo\nthree\n', after = 'one\nTWO\nthree\n'): DiffFileData => ({ file: changed(path), hunks: diffTexts(before, after) });

let wide = true;
const mediaListeners = new Set<() => void>();
beforeEach(() => {
  wide = true;
  localStorage.clear();
  resetDiffLayoutForTests();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return wide;
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mediaListeners.clear();
});

const sections = () => screen.getAllByTestId('diff-file');

describe('the diff viewer (story 8.3)', () => {
  it('gives each file a section with its path, change word and counts, and a labelled table whose rows say what they are', () => {
    render(<DiffViewer files={[fileOf('src/a.ts'), { file: changed('docs/new.md', { change: 'added', additions: 2, deletions: 0 }), hunks: diffTexts(null, 'a\nb\n') }]} label="Changes" />);
    expect(sections().map((section) => section.getAttribute('data-diff-file'))).toEqual(['src/a.ts', 'docs/new.md']);
    const header = sections()[1]!.querySelector('[data-slot="diff-file-header"]')!;
    expect(header.textContent).toContain('docs/new.md');
    expect(header.textContent).toContain('Added');
    expect(header.textContent).toContain('+2 -0');
    const table = screen.getByRole('table', { name: 'Changes in src/a.ts' });
    expect(within(table).getByText('Lines 1 to 3')).toBeTruthy();
    const removed = table.querySelector('[data-kind="remove"]')!;
    expect(removed.textContent).toContain('Removed line 2: two');
    expect(removed.querySelector('[data-slot="diff-sign"]')!.textContent).toBe('-');
    expect(removed.getAttribute('data-line-old')).toBe('2');
    const added = table.querySelector('[data-kind="add"]')!;
    expect(added.textContent).toContain('Added line 2: TWO');
    expect(added.querySelector('[data-slot="diff-sign"]')!.textContent).toBe('+');
    // Lines wrap: no horizontal scroll anywhere in the viewer.
    expect(added.querySelector('[data-slot="diff-code"]')!.className).toContain('whitespace-pre-wrap');
  });

  it('opens the first 20 of 25 files and lists the other 5 collapsed with their headers; the chevron opens one', () => {
    render(<DiffViewer files={Array.from({ length: 25 }, (_, index) => fileOf(`f${index}.txt`))} label="Changes" />);
    expect(sections()).toHaveLength(25);
    expect(sections().filter((section) => section.getAttribute('data-open') === 'true')).toHaveLength(20);
    expect(screen.getAllByRole('table')).toHaveLength(20);
    const last = sections()[24]!;
    const toggle = within(last).getByRole('button', { name: 'f24.txt' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(last).getByRole('table')).toBeTruthy();
  });

  it('shows a binary file and a too-large one by their words, the too-large with its counts', () => {
    render(<DiffViewer files={[{ file: changed('logo.png', { binary: true }), hunks: [] }, { file: changed('big.json', { tooLarge: true, additions: 9000, deletions: 12 }), hunks: [] }]} label="Changes" />);
    expect(sections()[0]!.textContent).toContain(DIFF_BINARY_TEXT);
    expect(sections()[1]!.textContent).toContain(DIFF_TOO_LARGE_TEXT);
    expect(sections()[1]!.textContent).toContain('+9000 -12');
  });

  it('parts hunks by their unchanged lines', () => {
    const before = Array.from({ length: 30 }, (_, index) => `l${index + 1}`);
    const after = before.map((line) => (line === 'l2' || line === 'l28' ? `${line}!` : line));
    render(<DiffViewer files={[fileOf('x.txt', before.join('\n'), after.join('\n'))]} label="Changes" />);
    expect(screen.getByText('19 unchanged lines')).toBeTruthy();
  });

  it('the file list jumps: it opens a collapsed file and moves focus to its header', async () => {
    const files = Array.from({ length: 22 }, (_, index) => fileOf(`f${index}.txt`));
    const viewer = createRef<DiffViewerHandle>();
    const onJump = vi.fn();
    render(
      <>
        <DiffFileList items={files.map(({ file }) => ({ path: file.path, jumpable: true }))} onSelect={(path) => viewer.current?.jumpTo(path)} data-testid="list" />
        <DiffViewer ref={viewer} files={files} label="Changes" onJump={onJump} />
      </>,
    );
    const scrolled = vi.fn();
    const real = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = real;
    });
    await act(async () => fireEvent.click(within(screen.getByTestId('list')).getByRole('button', { name: /f21\.txt/ })));
    const section = sections()[21]!;
    expect(section.getAttribute('data-open')).toBe('true');
    expect(scrolled).toHaveBeenCalled();
    expect(document.activeElement).toBe(within(section).getByRole('button', { name: 'f21.txt' }));
    expect(onJump).toHaveBeenCalledWith('f21.txt');
  });

  it('switches to Side by side and remembers it; below lg it shows Inline with the reason', () => {
    const { unmount } = render(<DiffViewer files={[fileOf('src/a.ts')]} label="Changes" />);
    expect(screen.getByTestId('diff-viewer').getAttribute('data-layout')).toBe('inline');
    fireEvent.click(screen.getByTestId('diff-layout-split'));
    expect(screen.getByTestId('diff-viewer').getAttribute('data-layout')).toBe('split');
    expect(localStorage.getItem(DIFF_LAYOUT_KEY)).toBe('split');
    // The changed line pair sits on one row, removed beside added.
    const row = screen.getByRole('table').querySelector('[data-kind="change"]')!;
    expect(row.textContent).toContain('Removed line 2: two');
    expect(row.textContent).toContain('Added line 2: TWO');
    unmount();

    resetDiffLayoutForTests();
    wide = false;
    render(<DiffViewer files={[fileOf('src/a.ts')]} label="Changes" />);
    expect(screen.getByTestId('diff-viewer').getAttribute('data-layout')).toBe('inline');
    expect(screen.getByTestId('diff-layout-narrow').textContent).toBe(SIDE_BY_SIDE_NARROW_TEXT);
    // A wider window brings Side by side back.
    act(() => {
      wide = true;
      for (const listener of mediaListeners) listener();
    });
    expect(screen.getByTestId('diff-viewer').getAttribute('data-layout')).toBe('split');
  });

  it('in Side by side an unchanged line is labelled with each side its own number', () => {
    localStorage.setItem(DIFF_LAYOUT_KEY, 'split');
    // One line added above: the unchanged "b" is old line 2 and new line 3.
    render(<DiffViewer files={[fileOf('x.txt', 'a\nb\n', 'a\nnew\nb\n')]} label="Changes" />);
    const row = [...screen.getByRole('table').querySelectorAll('[data-kind="context"]')].at(-1)!;
    const [before, after] = row.querySelectorAll('[data-slot="diff-code"]');
    expect(before!.textContent).toBe('Unchanged line 2: b');
    expect(after!.textContent).toBe('Unchanged line 3: b');
  });

  it('a layout switch gives the tab stop back to the first row, never an unrelated line', () => {
    render(<DiffViewer files={[fileOf('src/a.ts')]} label="Changes" />);
    const viewer = screen.getByTestId('diff-viewer');
    const stops = () => [...viewer.querySelectorAll('[data-diff-nav]')].filter((row) => row.getAttribute('tabindex') === '0');
    const line = viewer.querySelectorAll<HTMLElement>('[data-diff-nav="line"]')[2]!;
    line.focus();
    expect(stops()).toEqual([line]);
    fireEvent.click(screen.getByTestId('diff-layout-split'));
    expect(stops()).toEqual([viewer.querySelector('[data-diff-nav="hunk"]')]);
    expect(viewer.querySelectorAll('[data-current]')).toHaveLength(1);
  });

  it('layout inline has no toolbar and stays inline whatever was chosen', () => {
    localStorage.setItem(DIFF_LAYOUT_KEY, 'split');
    render(<DiffViewer files={[fileOf('src/a.ts')]} layout="inline" label="Changes" />);
    expect(screen.queryByTestId('diff-layout')).toBeNull();
    expect(screen.getByTestId('diff-viewer').getAttribute('data-layout')).toBe('inline');
  });

  it('n and p move between hunks, j and k between lines, with one roving tab stop', () => {
    const before = Array.from({ length: 30 }, (_, index) => `l${index + 1}`);
    const after = before.map((line) => (line === 'l2' || line === 'l28' ? `${line}!` : line));
    render(<DiffViewer files={[fileOf('x.txt', before.join('\n'), after.join('\n'))]} label="Changes" />);
    const viewer = screen.getByTestId('diff-viewer');
    const hunks = viewer.querySelectorAll<HTMLElement>('[data-diff-nav="hunk"]');
    expect([...viewer.querySelectorAll('[data-diff-nav]')].filter((row) => row.getAttribute('tabindex') === '0')).toEqual([hunks[0]]);
    hunks[0]!.focus();
    fireEvent.keyDown(hunks[0]!, { key: 'n' });
    expect(document.activeElement).toBe(hunks[1]);
    expect(hunks[1]!.getAttribute('data-current')).toBe('true');
    expect(hunks[1]!.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(hunks[1]!, { key: 'p' });
    expect(document.activeElement).toBe(hunks[0]);
    fireEvent.keyDown(hunks[0]!, { key: 'j' });
    expect((document.activeElement as HTMLElement).getAttribute('data-line-new')).toBe('1');
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect((document.activeElement as HTMLElement).getAttribute('data-line-old')).toBe('2');
    fireEvent.keyDown(document.activeElement!, { key: 'k' });
    expect((document.activeElement as HTMLElement).getAttribute('data-line-new')).toBe('1');
  });

  it('renders the hunk, file and line slots where later stories put their actions and comments', () => {
    render(
      <DiffViewer
        files={[fileOf('src/a.ts')]}
        label="Changes"
        fileActions={(file) => <button type="button">Open {file.path}</button>}
        hunkActions={(_file, hunk) => <button type="button">Revert {hunk.id}</button>}
        lineAfter={(_file, line) => (line.kind === 'add' ? <span data-testid="after">comment on {line.newLine}</span> : null)}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open src/a.ts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revert h0' })).toBeTruthy();
    expect(screen.getByTestId('after').textContent).toBe('comment on 2');
  });
});
