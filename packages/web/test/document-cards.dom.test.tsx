// @vitest-environment happy-dom
/**
 * Document cards (story 4.7), in a DOM: the card shows the file name and
 * its path in mono, the next step as the ink button and Open as an outline
 * one (Open only without a next step); the next step starts a planning
 * session on the next skill with the document's path as the idea and hands
 * it on, or says why inline; Open shows the side sheet titled with the file
 * name, the document rendered, a 404 or error state, the cut notice, and
 * Esc closes it with focus back on Open. The Markdown subset renders
 * headings, lists, code, emphasis, quotes and rules as elements, and keeps
 * `<script>`, raw HTML and `javascript:` links as text, never markup or
 * links; frontmatter is hidden. The REST calls go to a fake `tabAuth.fetch`.
 */
import { DOCUMENT_NEXT_FAILED, DOCUMENT_NOT_FOUND_TEXT, DOCUMENT_OPEN_LABEL, DOCUMENT_TRUNCATED_TEXT, type Session } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SESSION: Session = {
  id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4' as Session['id'],
  workspaceId: WS as Session['workspaceId'],
  kind: 'planning',
  state: 'idle',
  driver: 'ui',
  permissionMode: 'ask',
  title: null,
  adapterRefs: {},
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const PATH = '_bmad-output/specs/spec-x.md';
const NEXT = { skill: 'bmad-ticket', label: 'Turn this spec into tickets' };

const state = vi.hoisted(() => ({
  start: undefined as unknown,
  document: undefined as unknown,
  calls: [] as string[],
  bodies: [] as unknown[],
}));

const reply = (answer: unknown): Promise<Response> => {
  if (answer === 'pending') return new Promise(() => {});
  const failure = answer as { status?: number; message?: string; code?: string };
  if (typeof failure.status === 'number') {
    return Promise.resolve(new Response(JSON.stringify({ error: { code: failure.code ?? 'not_found', message: failure.message } }), { status: failure.status }));
  }
  return Promise.resolve(Response.json(answer, { status: 200 }));
};

vi.mock('@/auth/tab-token', () => ({
  tabAuth: {
    fetch: async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      state.calls.push(`${method} ${path}`);
      if (path.endsWith('/planning-sessions')) {
        state.bodies.push(JSON.parse(String(init.body)));
        return reply(state.start);
      }
      if (path.includes('/documents?')) return reply(state.document);
      return new Response('{}', { status: 404 });
    },
  },
}));

const { DocumentCard } = await import('../src/planning/document-card');
const { Markdown, splitCodeSpans } = await import('../src/ui/markdown');

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>), client };
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  state.start = { session: SESSION };
  state.document = { document: { path: PATH, content: '---\ntitle: Hidden\n---\n# The spec\n\nIt is **bold**.\n', truncated: false } };
  state.calls = [];
  state.bodies = [];
});
afterEach(() => cleanup());

describe('DocumentCard (story 4.7)', () => {
  it('shows the file name, its path in mono, the next step as the ink button and Open as outline', () => {
    mount(<DocumentCard wsId={WS} path={PATH} next={NEXT} onStarted={() => {}} />);
    const card = screen.getByRole('region', { name: 'Document spec-x.md' });
    expect(screen.getByTestId('document-card-name').textContent).toBe('spec-x.md');
    expect(screen.getByTestId('document-card-path').textContent).toBe(PATH);
    expect(screen.getByTestId('document-card-path').className).toContain('font-mono');
    const next = screen.getByRole('button', { name: NEXT.label });
    expect(next.className).toContain('bg-primary');
    const open = screen.getByRole('button', { name: DOCUMENT_OPEN_LABEL });
    expect(open.className).toContain('border');
    expect(open.className).not.toContain('bg-primary');
    expect(card.contains(next)).toBe(true);
    // Nothing is fetched until the user acts.
    expect(state.calls).toEqual([]);
  });

  it('without a next step shows Open only', () => {
    mount(<DocumentCard wsId={WS} path={PATH} next={null} onStarted={() => {}} />);
    expect(screen.queryByTestId('document-card-next')).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([DOCUMENT_OPEN_LABEL]);
  });

  it('the next step starts a planning session on the next skill with the path as the idea, and hands it on', async () => {
    const onStarted = vi.fn();
    mount(<DocumentCard wsId={WS} path={PATH} next={NEXT} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole('button', { name: NEXT.label }));
    await settle();
    expect(state.bodies).toEqual([{ skill: 'bmad-ticket', idea: PATH }]);
    expect(state.calls).toEqual([`POST /api/v1/workspaces/${WS}/planning-sessions`]);
    expect(onStarted).toHaveBeenCalledWith(SESSION);
  });

  it('a refused start says why inline, and nothing is handed on', async () => {
    state.start = { status: 409, code: 'feature_off', message: 'Planning is off for this project.' };
    const onStarted = vi.fn();
    mount(<DocumentCard wsId={WS} path={PATH} next={NEXT} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole('button', { name: NEXT.label }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Planning is off for this project.');
    expect(onStarted).not.toHaveBeenCalled();
    cleanup();

    // A refusal without a message says the card's own words, not the Plan page's.
    state.start = { status: 500 };
    mount(<DocumentCard wsId={WS} path={PATH} next={NEXT} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole('button', { name: NEXT.label }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(`${DOCUMENT_NEXT_FAILED} (error 500).`);
  });

  it('a failed refetch keeps the text it had, with a quiet line above it', async () => {
    const { client } = mount(<DocumentCard wsId={WS} path={PATH} next={null} onStarted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: DOCUMENT_OPEN_LABEL }));
    await settle();
    expect(screen.queryByTestId('document-sheet-refetch-error')).toBeNull();
    state.document = { status: 404, message: 'gone' };
    await act(async () => {
      await client.refetchQueries();
    });
    await settle();
    expect(screen.getByTestId('document-sheet-refetch-error').textContent).toBe(DOCUMENT_NOT_FOUND_TEXT);
    expect(screen.getByTestId('document-sheet-content').querySelector('h3')?.textContent).toBe('The spec');
  });

  it('Open shows the sheet titled with the file name and the document rendered; Esc closes it and focus returns to Open', async () => {
    mount(<DocumentCard wsId={WS} path={PATH} next={NEXT} onStarted={() => {}} />);
    const open = screen.getByRole('button', { name: DOCUMENT_OPEN_LABEL });
    fireEvent.click(open);
    await settle();
    const sheet = screen.getByRole('dialog', { name: 'spec-x.md' });
    expect(state.calls).toEqual([`GET /api/v1/workspaces/${WS}/documents?path=${encodeURIComponent(PATH)}`]);
    expect(screen.getByTestId('document-sheet-path').textContent).toBe(PATH);
    const content = screen.getByTestId('document-sheet-content');
    expect(content.querySelector('h3')?.textContent).toBe('The spec');
    expect(content.querySelector('strong')?.textContent).toBe('bold');
    // The frontmatter is hidden.
    expect(content.textContent).not.toContain('Hidden');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('a missing document says it is not there any more; another failure says why; a cut one says so', async () => {
    state.document = { status: 404, message: 'gone' };
    mount(<DocumentCard wsId={WS} path={PATH} next={null} onStarted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: DOCUMENT_OPEN_LABEL }));
    await settle();
    expect(screen.getByTestId('document-sheet-error').textContent).toBe(DOCUMENT_NOT_FOUND_TEXT);
    cleanup();

    state.document = { status: 400, code: 'invalid_request', message: "That isn't a Markdown document in this project's output folder." };
    mount(<DocumentCard wsId={WS} path={PATH} next={null} onStarted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: DOCUMENT_OPEN_LABEL }));
    await settle();
    expect(screen.getByTestId('document-sheet-error').textContent).toBe("That isn't a Markdown document in this project's output folder.");
    cleanup();

    state.document = { document: { path: PATH, content: '# Long', truncated: true } };
    mount(<DocumentCard wsId={WS} path={PATH} next={null} onStarted={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: DOCUMENT_OPEN_LABEL }));
    await settle();
    expect(screen.getByTestId('document-sheet-truncated').textContent).toBe(DOCUMENT_TRUNCATED_TEXT);
  });
});

describe('Markdown (story 4.7)', () => {
  const md = (source: string) => {
    const { container } = render(<Markdown source={source} />);
    return container.querySelector('[data-slot="markdown"]')!;
  };

  it('renders headings, paragraphs, lists, code, emphasis, quotes and rules as elements', () => {
    const root = md(
      [
        '# Title',
        '## Section',
        '',
        'A *soft* and **strong** line',
        'continued with `code`.',
        '',
        '- one',
        '- two',
        '  - nested',
        '',
        '3. three',
        '4. four',
        '',
        '```ts',
        'const a = "<b>";',
        '```',
        '',
        '> quoted **text**',
        '',
        '---',
        '',
        'After.',
      ].join('\n'),
    );
    expect([...root.querySelectorAll('h3, h4')].map((heading) => heading.textContent)).toEqual(['Title', 'Section']);
    expect(root.querySelector('em')?.textContent).toBe('soft');
    expect(root.querySelector('strong')?.textContent).toBe('strong');
    expect(root.querySelector('p code')?.textContent).toBe('code');
    expect([...root.querySelectorAll('ul > li')].map((item) => item.textContent)).toEqual(['one', 'twonested', 'nested']);
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelector('pre code')?.textContent).toBe('const a = "<b>";');
    expect(root.querySelector('blockquote strong')?.textContent).toBe('text');
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.lastElementChild?.textContent).toBe('After.');
  });

  it('keeps <script>, raw HTML and links as text: no markup, no href, nothing to follow', () => {
    const root = md(
      [
        '<script>window.hacked = true</script>',
        '',
        '<img src=x onerror="window.hacked = true">',
        '',
        '[click me](javascript:alert(1)) and [site](https://example.com) and ![alt text](javascript:x)',
        '',
        '<a href="javascript:alert(1)">raw link</a>',
      ].join('\n'),
    );
    expect(root.querySelector('script, img, a, iframe')).toBeNull();
    expect(root.querySelectorAll('[href], [src], [onerror]')).toHaveLength(0);
    expect(root.textContent).toContain('<script>window.hacked = true</script>');
    expect(root.textContent).toContain('<img src=x onerror="window.hacked = true">');
    expect(root.textContent).toContain('click me and site and alt text');
    expect(root.textContent).not.toContain('javascript:alert(1)) and');
    expect(root.textContent).toContain('<a href="javascript:alert(1)">raw link</a>');
    expect((window as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('gives each heading level its own element, and shows nothing for a heading with no text', () => {
    const root = md('# One\n## Two\n### Three\n#### Four\n#\n## ##\n### Closed ###\n#hashtag');
    expect([...root.querySelectorAll('h3, h4, h5, h6')].map((heading) => `${heading.tagName}:${heading.textContent}`)).toEqual([
      'H3:One',
      'H4:Two',
      'H5:Three',
      'H6:Four',
      'H5:Closed',
    ]);
    expect(root.textContent).toContain('#hashtag');
  });

  it('a quote stops at a following heading, fence, rule or list item; a plain line continues it', () => {
    const root = md('> quoted\nlazy line\n# Heading\n> again\n- item\n> third\n---\n> fourth\n```\ncode\n```');
    const quotes = [...root.querySelectorAll('blockquote')];
    expect(quotes.map((quote) => quote.textContent)).toEqual(['quoted\nlazy line', 'again', 'third', 'fourth']);
    expect(root.querySelector('h3')?.textContent).toBe('Heading');
    expect(root.querySelector('ul > li')?.textContent).toBe('item');
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.querySelector('pre code')?.textContent).toBe('code');
  });

  it('finds code spans by a linear scan: a run closes on the same length only, an unclosed run is text', () => {
    expect(splitCodeSpans('a `b` c')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'code', value: 'b' },
      { kind: 'text', value: ' c' },
    ]);
    expect(splitCodeSpans('``a`b``')).toEqual([{ kind: 'code', value: 'a`b' }]);
    expect(splitCodeSpans('`` ` ``')).toEqual([{ kind: 'code', value: '`' }]);
    expect(splitCodeSpans('`open and ```x```')).toEqual([
      { kind: 'text', value: '`open and ' },
      { kind: 'code', value: 'x' },
    ]);
    expect(splitCodeSpans('no code')).toEqual([{ kind: 'text', value: 'no code' }]);
  });

  it('hostile long lines render quickly: backtick runs, padded headings and list markers', () => {
    const timed = (source: string) => {
      const started = performance.now();
      const root = md(source);
      const took = performance.now() - started;
      cleanup();
      return { took, text: root.textContent };
    };
    const ticks = timed(`x${'`'.repeat(3999)}`);
    expect(ticks.took).toBeLessThan(1_500);
    expect(ticks.text).toBe(`x${'`'.repeat(3999)}`);
    expect(timed(`${`x${'`'.repeat(3999)}\n`.repeat(250)}`).took).toBeLessThan(3_000);
    expect(timed(`# a${' \t'.repeat(50_000)}x`).took).toBeLessThan(1_500);
    expect(timed(`-${' '.repeat(100_000)}\r`).took).toBeLessThan(1_500);
    expect(timed(`- a${' '.repeat(100_000)}\r`).took).toBeLessThan(1_500);
  });

  it('hides a leading frontmatter block only', () => {
    expect(md('---\ntitle: x\nstatus: draft\n---\n\nBody').textContent).toBe('Body');
    expect(md('Body\n\n---\n\nmore').querySelector('hr')).not.toBeNull();
    // An unclosed block is not frontmatter: it shows (as a rule and text).
    expect(md('---\ntitle: x').textContent).toContain('title: x');
  });

  it('survives deep nesting and a huge document without blowing up', () => {
    expect(md(`${'>'.repeat(200)} deep`).textContent).toContain('deep');
    expect(md('*a_b`'.repeat(5000)).textContent?.length).toBeGreaterThan(0);
    expect(md('x\n'.repeat(20_000)).textContent?.length).toBeGreaterThan(0);
    // Unclosed openers on long lines stay fast: a match is looked for within a line, and a very long line is plain text.
    const started = performance.now();
    md(`${' _a *b `c'.repeat(440)}\n`.repeat(200));
    md(' _a'.repeat(300_000));
    // A quadratic parser would take minutes; Windows runners took 3.2 s to 3.3 s for this linear work (CI runs
    // 37208501103 and 37210509147, windows-latest Node 24), so the bound there is wider.
    expect(performance.now() - started).toBeLessThan(process.platform === 'win32' ? 8_000 : 3_000);
  });
});
