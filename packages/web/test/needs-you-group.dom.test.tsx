// @vitest-environment happy-dom
/**
 * The Needs you group in a DOM (epic 26, E26-R1): "Show N more" shows the
 * rest and "Show fewer" folds them again; `]` and `[` move focus between the
 * visible rows and stop at the ends; a click marks the row last opened. The
 * router is a stand-in.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, hash, ...props }: { children?: ReactNode; to: string; params?: Record<string, string>; hash?: string }) => (
    <a href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to) + (hash === undefined ? '' : `#${hash}`)} {...props}>
      {children}
    </a>
  ),
}));

const { NeedsYouGroup } = await import('../src/shell/needs-you-group');
const { lastNeedsYouOpened, markNeedsYouOpened, resetNeedsYouOpened } = await import('../src/shell/needs-you-target');
const { SidebarProvider } = await import('../src/ui/sidebar');
const { TooltipProvider } = await import('../src/ui/tooltip');

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `req_${i}`, kind: 'permission' as const, wsId: 'ws_a', sesId: `ses_${i}`, workspaceName: 'Letterpress', chatName: `Chat ${i}`, text: `Claude Code wants to run test ${i}` }));

const mount = (n: number) =>
  render(
    <TooltipProvider>
      <SidebarProvider>
        <NeedsYouGroup items={items(n)} />
      </SidebarProvider>
    </TooltipProvider>,
  );
const rows = () => screen.getAllByTestId('needs-you-item');

afterEach(() => {
  cleanup();
  resetNeedsYouOpened();
});

describe('Needs you group', () => {
  it('8 rows: 5 show, then "Show 3 more"; pressed, all 8 and "Show fewer"', () => {
    mount(8);
    expect(rows()).toHaveLength(5);
    const more = screen.getByTestId('needs-you-more');
    expect(more.textContent).toBe('Show 3 more');
    fireEvent.click(more);
    expect(rows()).toHaveLength(8);
    expect(more.textContent).toBe('Show fewer');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(more);
    expect(rows()).toHaveLength(5);
  });

  it('] and [ move focus between rows; at the ends nothing moves', () => {
    mount(3);
    rows()[1]!.focus();
    fireEvent.keyDown(rows()[1]!, { key: ']' });
    expect(document.activeElement).toBe(rows()[2]);
    fireEvent.keyDown(rows()[2]!, { key: ']' });
    expect(document.activeElement).toBe(rows()[2]);
    fireEvent.keyDown(rows()[2]!, { key: '[' });
    fireEvent.keyDown(rows()[1]!, { key: '[' });
    expect(document.activeElement).toBe(rows()[0]);
    fireEvent.keyDown(rows()[0]!, { key: '[' });
    expect(document.activeElement).toBe(rows()[0]);
    // A layout that types brackets with AltGr (Ctrl+Alt) or Shift still moves; a Cmd chord does not.
    fireEvent.keyDown(rows()[0]!, { key: ']', ctrlKey: true, altKey: true });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(rows()[1]!, { key: ']', shiftKey: true });
    expect(document.activeElement).toBe(rows()[2]);
    fireEvent.keyDown(rows()[2]!, { key: '[', metaKey: true });
    expect(document.activeElement).toBe(rows()[2]);
  });

  it('every row has the rail width, so the mark moving changes only its colour', () => {
    mount(2);
    fireEvent.click(rows()[0]!);
    for (const row of rows()) expect(row.className).toMatch(/border-l-\(length:--rail-row\)/);
    expect(rows()[0]!.className).toMatch(/\bborder-l-signal\b/);
    expect(rows()[1]!.className).toMatch(/\bborder-l-transparent\b/);
  });

  it('a click marks the row last opened, which keeps the signal rail', () => {
    mount(3);
    fireEvent.click(rows()[1]!);
    expect(lastNeedsYouOpened()).toBe('req_1');
    expect(rows()[1]!.getAttribute('data-last-opened')).toBe('true');
    act(() => markNeedsYouOpened('req_2'));
    expect(rows()[1]!.hasAttribute('data-last-opened')).toBe(false);
    expect(rows()[2]!.className).toMatch(/\bborder-l-signal\b/);
  });
});
