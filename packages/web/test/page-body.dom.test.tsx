// @vitest-environment happy-dom
/**
 * The page body's scroll box contains what is absolutely positioned in it
 * (backlog 10, bug): a hidden "In progress" label laid out against the page
 * stretched the document, and the wheel scrolled the whole app into blank
 * space. The layout itself is proven in `tests/e2e/chat-scroll.spec.ts`;
 * here, the classes: positioned by default, and the terminal peek's own
 * placement still wins over it.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { conversationProps } from '../src/terminal/terminal-pane';
import { PageBody } from '../src/ui/page';

afterEach(cleanup);

const scrollBox = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-slot="page-body"]')!;
const classes = (element: HTMLElement) => element.className.split(/\s+/);

describe('PageBody', () => {
  it('is a positioned scroll box', () => {
    const { container } = render(<PageBody>Hello</PageBody>);
    expect(classes(scrollBox(container))).toEqual(expect.arrayContaining(['relative', 'overflow-y-auto']));
  });

  it('keeps the terminal peek over the terminal (absolute; at xl beside it, positioned too) and hidden when closed', () => {
    const open = render(<PageBody {...conversationProps(true, true)}>Hello</PageBody>);
    const peek = classes(scrollBox(open.container));
    expect(peek).toEqual(expect.arrayContaining(['absolute', 'xl:relative', 'xl:inset-auto']));
    expect(peek).not.toContain('relative');
    cleanup();
    const closed = render(<PageBody {...conversationProps(true, false)}>Hello</PageBody>);
    expect(classes(scrollBox(closed.container))).toContain('hidden');
  });
});
