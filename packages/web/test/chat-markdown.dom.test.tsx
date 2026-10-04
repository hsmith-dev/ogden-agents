// @vitest-environment happy-dom
/**
 * Agent replies in the chat render as Markdown (backlog story 2), in a DOM:
 * the shared renderer's `chat` variant shows headings, lists, task lists,
 * tables, code with its language and Copy, quotes and rules as elements;
 * raw HTML stays text; only http, https and mailto links are followable,
 * opening in a new tab with no opener and their full address on hover and
 * focus; images are never loaded; paths stay text; a streaming reply is
 * parsed at most every 100 ms, an open fence shows the rest as code, and a
 * huge or hostile reply renders quickly. A user's message stays as typed.
 */
import type { TranscriptMessage } from '../src/chat/transcript';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { Markdown, MAX_MARKDOWN_LENGTH, STREAMING_RENDER_MS, safeHref } = await import('../src/ui/markdown');
const { Message } = await import('../src/chat/transcript-parts');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const chat = (source: string, streaming = false) => {
  const { container, rerender } = render(<Markdown source={source} variant="chat" streaming={streaming} />);
  return { root: container.querySelector<HTMLElement>('[data-slot="markdown"]')!, rerender };
};

/** The text a reader sees: without the address hints, which show only on hover and focus. */
const visible = (root: HTMLElement) => {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const hint of copy.querySelectorAll('[data-slot="markdown-link-address"]')) hint.remove();
  return copy.textContent;
};

const agentMessage = (text: string, extra: Partial<TranscriptMessage> = {}): TranscriptMessage => ({ messageId: 'm1', role: 'agent', text, streaming: false, ...extra });

describe('agent replies as Markdown (chat variant)', () => {
  it('renders headings, emphasis, lists, task lists, code, tables, quotes and rules as elements with no markers left', () => {
    const { root } = chat(
      [
        '# Plan',
        'Some *soft* and **strong** text with `npm test`.',
        'A second line.',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '2. second',
        '',
        '- [ ] open task',
        '- [x] done task',
        '',
        '```ts',
        'const a = "<b>";',
        '```',
        '',
        '| Name | Count |',
        '| :--- | ----: |',
        '| a \\| b | 1 |',
        '| c |',
        '',
        '> quoted',
        '',
        '---',
      ].join('\n'),
    );
    expect(root.querySelector('h3')?.textContent).toBe('Plan');
    expect(root.querySelector('em')?.textContent).toBe('soft');
    expect(root.querySelector('strong')?.textContent).toBe('strong');
    expect(root.querySelector('p code')?.textContent).toBe('npm test');
    // A soft break is a line break in the chat.
    expect(root.querySelector('p br')).not.toBeNull();
    expect([...root.querySelectorAll('ol > li')].map((item) => item.textContent)).toEqual(['first', 'second']);
    const tasks = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(tasks.map((task) => [task.checked, task.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
    expect(tasks[0]!.closest('li')?.textContent).toBe('open task');
    expect(root.querySelector('pre code')?.textContent).toBe('const a = "<b>";');
    expect(root.querySelector('[data-slot="code-language"]')?.textContent).toBe('ts');
    expect([...root.querySelectorAll('th')].map((cell) => `${cell.textContent}:${cell.getAttribute('scope')}`)).toEqual(['Name:col', 'Count:col']);
    expect([...root.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent))).toEqual([
      ['a | b', '1'],
      ['c', ''],
    ]);
    expect(root.querySelector('th:last-child')?.className).toContain('text-right');
    expect(root.querySelector('blockquote')?.textContent).toBe('quoted');
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.textContent).not.toMatch(/\*\*|^#|```|\| :---/m);
  });

  it('keeps raw HTML, scripts, handlers and entities as text: no element the agent wrote is created', () => {
    const { root } = chat(
      [
        '<script>window.hacked = true</script>',
        '',
        '<img src=x onerror="window.hacked = true"> <iframe src="/x"></iframe> <svg onload=alert(1)>',
        '',
        '&lt;b&gt; and &#106;avascript:alert(1)',
        '',
        '<a href="javascript:alert(1)">raw link</a>',
      ].join('\n'),
    );
    expect(root.querySelector('script, img, iframe, a, object, embed, svg')).toBeNull();
    expect(root.querySelectorAll('[src], [onerror], [href]')).toHaveLength(0);
    expect(root.textContent).toContain('<script>window.hacked = true</script>');
    expect(root.textContent).toContain('&lt;b&gt; and &#106;avascript:alert(1)');
    expect((window as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('follows only http, https and mailto links: a new tab, no opener, the full address on hover and focus', () => {
    const { root } = chat(
      [
        '[docs](https://example.com/a?b=1#c "Title") and [mail](mailto:dev@example.com) and <https://auto.example.com/x>.',
        'See https://bare.example.com/path_(x). Or (https://paren.example.com).',
        '[js](javascript:alert(1)) [JS](JaVaScRiPt:alert(1)) [data](data:text/html,<b>x</b>) [file](file:///etc/passwd)',
        '[rel](src/app.ts) [abs](/Users/me/notes.md) [ctrl](https://exa\u0000mple.com) [vb](vbscript:x)',
        'A path: /Users/me/project/src/index.ts and C:\\repo\\a.ts and ./docs/readme.md stay text.',
      ].join('\n'),
    );
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/a?b=1#c',
      'mailto:dev@example.com',
      'https://auto.example.com/x',
      'https://bare.example.com/path_(x)',
      'https://paren.example.com/',
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      const hint = root.querySelector(`#${CSS.escape(link.getAttribute('aria-describedby')!)}`);
      expect(hint?.textContent).toBe(link.getAttribute('href'));
      expect(hint?.className).toContain('group-hover/link:block');
      expect(hint?.className).toContain('group-focus-visible/link:block');
    }
    expect(links[0]!.firstChild?.textContent).toBe('docs');
    // The autolink's brackets and a sentence's period and parenthesis stay outside.
    expect(visible(root)).toContain('docs and mail and https://auto.example.com/x.');
    expect(visible(root)).toContain('See https://bare.example.com/path_(x). Or (https://paren.example.com).');
    // Unsafe links are their text only.
    expect(visible(root)).toContain('js JS data file');
    expect(visible(root)).toContain('rel abs ctrl vb');
    expect(visible(root)).toContain('/Users/me/project/src/index.ts and C:\\repo\\a.ts and ./docs/readme.md');
  });

  it('decides a link address by URL protocol only', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('<https://example.com/a b>')).toBeNull();
    expect(safeHref('HTTPS://EXAMPLE.com')).toBe('https://example.com/');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    for (const unsafe of ['javascript:alert(1)', ' javascript:x', 'java\tscript:x', 'data:text/html,x', 'file:///etc', 'blob:https://x/y', 'ftp://x', '//evil.com', 'evil.com', '/abs', 'rel/a.md', 'https://', '']) {
      expect(safeHref(unsafe), unsafe).toBeNull();
    }
  });

  it('never loads an image: a web address becomes a labelled link, anything else its alt text', () => {
    const { root } = chat('![diagram](https://example.com/d.png) ![local](./d.png) ![](https://example.com/e.png) ![x](javascript:alert(1))');
    expect(root.querySelector('img, picture, source')).toBeNull();
    const links = [...root.querySelectorAll('a')];
    expect(links.map((link) => [link.firstChild?.textContent, link.getAttribute('href')])).toEqual([
      ['Image: diagram', 'https://example.com/d.png'],
      ['Image: untitled', 'https://example.com/e.png'],
    ]);
    expect(visible(root)).toBe('Image: diagram local Image: untitled x');
  });

  it('copies a code block exactly, says so, and is reachable by keyboard', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { root } = chat('```bash\n  npm install\n\techo "<done>"\n```');
    const copy = screen.getByRole('button', { name: 'Copy bash code' });
    const pre = root.querySelector('pre')!;
    expect(pre.tabIndex).toBe(0);
    expect(pre.getAttribute('aria-label')).toBe('bash code');
    expect(pre.className).toContain('overflow-x-auto');
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith('  npm install\n\techo "<done>"');
    expect(copy.textContent).toBe('Copied');
    expect(screen.getByRole('status').textContent).toBe('Copied');

    writeText.mockRejectedValueOnce(new Error('denied'));
    cleanup();
    chat('```\nplain\n```');
    const plain = screen.getByRole('button', { name: 'Copy code' });
    await act(async () => {
      fireEvent.click(plain);
    });
    expect(plain.textContent).toBe("Couldn't copy");
    expect(document.querySelector('[data-slot="code-language"]')?.textContent).toBe('');
  });

  it('a language label is only a plain name', () => {
    const { root } = chat('```<img src=x onerror=alert(1)>\nx\n```\n\n```' + 'a'.repeat(40) + '\ny\n```');
    expect([...root.querySelectorAll('[data-slot="code-language"]')].map((label) => label.textContent)).toEqual(['', '']);
    expect(root.querySelector('img')).toBeNull();
  });

  it('while streaming, an open fence shows the rest as code and the text is parsed at most every 100 ms', () => {
    vi.useFakeTimers();
    const { root, rerender } = chat('Intro\n\n```py\nprint(1)\n# not a heading', true);
    expect(root.querySelector('pre code')?.textContent).toBe('print(1)\n# not a heading');
    expect(root.querySelector('h3')).toBeNull();
    // A burst of updates inside the window is held back, then the latest is shown.
    rerender(<Markdown source={'Intro\n\n```py\nprint(1)\n# not a heading\nprint(2)'} variant="chat" streaming />);
    rerender(<Markdown source={'Intro\n\n```py\nprint(1)\n# not a heading\nprint(2)\n```\n\nDone.'} variant="chat" streaming />);
    expect(root.textContent).not.toContain('Done.');
    act(() => {
      vi.advanceTimersByTime(STREAMING_RENDER_MS);
    });
    expect(root.querySelector('pre code')?.textContent).toBe('print(1)\n# not a heading\nprint(2)');
    expect(root.lastElementChild?.textContent).toBe('Done.');
    // The final text shows at once when streaming ends.
    rerender(<Markdown source={'Intro\n\n```py\nprint(1)\n```\n\nFinal.'} variant="chat" streaming={false} />);
    expect(root.lastElementChild?.textContent).toBe('Final.');
  });

  it('a huge or hostile reply renders quickly; past the cap the rest is plain text', () => {
    const timed = (source: string) => {
      const started = performance.now();
      const { root } = chat(source);
      const took = performance.now() - started;
      const text = root.textContent;
      const rest = root.querySelector('[data-slot="markdown-rest"]');
      cleanup();
      return { took, text, rest };
    };
    const bound = process.platform === 'win32' ? 8_000 : 3_000;
    // Every line differs, so no line is served from the render cache.
    const lines = (count: number, line: (index: number) => string) => Array.from({ length: count }, (_, index) => line(index)).join('\n');
    expect(timed(lines(50, (index) => `${index}${'['.repeat(3_990)}`)).took).toBeLessThan(bound);
    expect(timed(lines(25, (index) => `${index}${'|'.repeat(3_990)}\n${'|-'.repeat(1_995)}`)).took).toBeLessThan(bound);
    expect(timed(lines(50, (index) => `${index}${'https://a.b/'.repeat(330)}`)).took).toBeLessThan(bound);
    expect(timed(lines(50, (index) => `${index}${'![a](https://x/'.repeat(260)}`)).took).toBeLessThan(bound);
    expect(timed(lines(50, (index) => `${index}${'**a_b'.repeat(790)}`)).took).toBeLessThan(bound);
    const huge = timed(`${'Some **bold** text and `code` with https://example.com.\n'.repeat(20_000)}`);
    expect(huge.took).toBeLessThan(bound);
    expect(huge.rest?.textContent?.length).toBe(20_000 * 56 - MAX_MARKDOWN_LENGTH);
  });
});

describe('the chat transcript', () => {
  it("renders an agent's reply, typed or from the terminal, as Markdown under its name", () => {
    render(<Message message={agentMessage('## Done\n\n- **one**')} agentName="Claude Code" />);
    const message = screen.getByTestId('message-agent');
    expect(message.querySelector('[data-slot="markdown"][data-variant="chat"] h4')?.textContent).toBe('Done');
    expect(message.querySelector('li strong')?.textContent).toBe('one');
    expect(message.textContent).toBe('Claude CodeDoneone');
  });

  it("keeps a user's message as typed, Markdown markers and line breaks included", () => {
    const text = '# not a heading\n**not bold** [x](https://example.com)';
    render(
      <>
        <Message message={{ messageId: 'u1', role: 'user', text, streaming: false }} agentName="Claude Code" />
        <Message message={{ messageId: 'u2', role: 'user', text, streaming: false, origin: 'terminal' }} agentName="Claude Code" />
      </>,
    );
    const [typed, fromTerminal] = screen.getAllByTestId('message-user');
    for (const message of [typed!, fromTerminal!]) {
      expect(message.textContent).toBe(text);
      expect(message.querySelector('h3, strong, a, [data-slot="markdown"]')).toBeNull();
      expect(message.querySelector('p')?.className).toContain('whitespace-pre-wrap');
    }
  });
});
