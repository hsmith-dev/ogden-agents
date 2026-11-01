// @vitest-environment happy-dom
/**
 * 8.7 in a DOM: an agent's reply links the paths and `file:line` targets the
 * server confirmed (and nothing else) to the in-app viewer; a markdown file
 * renders through the same safe renderer, its relative links to confirmed
 * files lead to the viewer and its external ones open in a new tab with no
 * opener; raw HTML and unsafe links stay text, so no href is ever outside
 * http, https, mailto or the viewer route. The viewer shows Show source,
 * Copy path, sizes, and a `?line=` scrolled to and highlighted until the
 * next click. The REST call is a stand-in.
 */
import { API_ROUTES, apiPath, fileSizeWords, WORKSPACE_FILE_BINARY_TEXT, type WorkspaceFolderResponse } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptMessage } from '../src/chat/transcript';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const FILES = apiPath(API_ROUTES.workspaceFiles, { wsId: WS });
const CONTENT = apiPath(API_ROUTES.workspaceFileContent, { wsId: WS });
const LINKS = apiPath(API_ROUTES.workspaceFileLinks, { wsId: WS });

const fake = vi.hoisted(() => ({
  calls: [] as { url: string; body?: unknown }[],
  existing: new Set<string>(),
  folders: {} as Record<string, unknown>,
  files: {} as Record<string, unknown>,
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/http')>()),
  call: async (_auth: unknown, url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { paths: string[] }) : undefined;
    fake.calls.push({ url, ...(body === undefined ? {} : { body }) });
    if (url === LINKS) return { found: body!.paths.filter((path) => fake.existing.has(path)) };
    const [base, query] = url.split('?');
    const path = new URLSearchParams(query ?? '').get('path') ?? '';
    const answer = (base === CONTENT ? fake.files : fake.folders)[path];
    if (answer === undefined) throw new Error(`unexpected call ${url}`);
    return answer;
  },
}));

const { Markdown } = await import('../src/ui/markdown');
const { Message } = await import('../src/chat/transcript-parts');
const { WorkbenchFiles } = await import('../src/workbench/workbench-files');
const { parseFileTarget, resolveRelative, viewerLinks } = await import('../src/workbench/path-links');

afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.existing = new Set();
  fake.folders = {};
  fake.files = {};
});

async function flush() {
  for (let i = 0; i < 6; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** `node` rendered in a memory router (the viewer route exists) with a fresh query client. */
async function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <QueryClientProvider client={client}>{node}</QueryClientProvider> });
  const chat = createRoute({ getParentRoute: () => root, path: '/w/$wsId/s/$sesId' });
  const workbench = createRoute({ getParentRoute: () => root, path: '/w/$wsId/workbench' });
  const router = createRouter({ routeTree: root.addChildren([chat, workbench]), history: createMemoryHistory({ initialEntries: [`/w/${WS}/s/${SES}`] }) });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await flush();
  return { ...view, router };
}

/** Every href in `root`, each one only http, https, mailto or the in-app viewer route. */
function expectOnlySafeHrefs(root: HTMLElement) {
  const hrefs = [...root.querySelectorAll('[href]')].map((element) => element.getAttribute('href')!);
  for (const href of hrefs) expect(href, href).toMatch(new RegExp(`^(?:https?://|mailto:|/w/${WS}/workbench\\?)`));
  return hrefs;
}

const agentMessage = (text: string): TranscriptMessage => ({ messageId: 'm1', role: 'agent', text, streaming: false });

describe('chat replies link confirmed paths to the viewer', () => {
  it('links a confirmed src/a.ts:12 (bare and as a code span) to the viewer at line 12, and leaves every unconfirmed or unsafe one as text', async () => {
    fake.existing = new Set(['src/a.ts', 'README.md', '.git/config']);
    const reply = [
      'See `src/a.ts:12` and src/a.ts:12, also ./README.md.',
      'Not these: src/missing.ts /etc/passwd ../x.ts ~/x.ts .ssh/id_rsa',
      'URLs: https://x.io/a.ts and [js](javascript:alert(1)) and [d](data:text/html,x) and [f](file:///etc/passwd) and [h](//host/a.ts)',
      '<script>alert(1)</script> <img src=x onerror=alert(1)>',
      '[link](src/a.ts#L3)',
    ].join('\n');
    const { container } = await mount(<Message message={agentMessage(reply)} agentName="Claude Code" wsId={WS} sesId={SES} />);
    // One request, for the reply's candidates; the server says which exist.
    const asked = fake.calls.filter((call) => call.url === LINKS);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.body).toEqual({ paths: ['src/a.ts', 'README.md', 'src/missing.ts', '.ssh/id_rsa'], session: SES });
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[data-slot="markdown-path-link"]')];
    expect(links.map((link) => [link.textContent, link.getAttribute('title')])).toEqual([
      ['src/a.ts:12', 'Open src/a.ts at line 12'],
      ['src/a.ts:12', 'Open src/a.ts at line 12'],
      ['./README.md', 'Open README.md'],
      ['link', 'Open src/a.ts at line 3'],
    ]);
    expect(links[0]!.querySelector('code')?.textContent).toBe('src/a.ts:12');
    const href = new URL(links[0]!.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe(`/w/${WS}/workbench`);
    expect(Object.fromEntries(href.searchParams)).toEqual({ path: 'src/a.ts', line: '12', session: SES });
    expect(links.every((link) => link.getAttribute('target') === null)).toBe(true);
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    const hrefs = expectOnlySafeHrefs(container);
    expect(hrefs.filter((each) => each.startsWith('http'))).toEqual(['https://x.io/a.ts']);
  });

  it('asks nothing while a reply streams, and nothing without the chat (paths stay text)', async () => {
    fake.existing = new Set(['src/a.ts']);
    const { container } = await mount(<Message message={{ ...agentMessage('see src/a.ts'), streaming: true }} agentName="Claude Code" wsId={WS} sesId={SES} />);
    expect(fake.calls).toEqual([]);
    expect(container.querySelector('[data-slot="markdown-path-link"]')).toBeNull();
    cleanup();
    const plain = await mount(<Message message={agentMessage('see src/a.ts')} agentName="Claude Code" />);
    expect(fake.calls).toEqual([]);
    expect(plain.container.querySelector('[data-slot="markdown-path-link"]')).toBeNull();
  });

  it('leaves the reply as text when the links request fails', async () => {
    // Another project's links route isn't answered by the stand-in: the request fails.
    const { container } = await mount(<Message message={agentMessage('see src/zzz.ts')} agentName="Claude Code" wsId="ws_bad" sesId={SES} />);
    expect(container.querySelector('[data-slot="markdown-path-link"]')).toBeNull();
    expect(container.textContent).toContain('see src/zzz.ts');
  });
});

describe('markdown files (file variant)', () => {
  const fileLinks = (confirmed: string[]) => viewerLinks(WS, undefined, new Set(confirmed), (destination) => resolveRelative('docs/README.md', destination), false);

  it('renders relative links to confirmed files as viewer links, external ones in a new tab with no opener, and everything else as text', async () => {
    const source = [
      '---',
      'title: hidden',
      '---',
      '# Guide',
      'One line',
      'and the next.',
      '',
      '[a](./src/a.ts#L3) [b](../../etc/passwd) [c](https://ok.io) [d](javascript:x) [e](data:text/html,x) [f](file:///etc/passwd) [g](//host/x) [h](%2e%2e/%2e%2e/x) [i](src\\a.ts) [j](#intro) [k](./missing.ts)',
      'Bare docs/src/a.ts stays text; https://bare.io links.',
      '<script>alert(1)</script><img src=x onerror=alert(1)> ![pic](./img.png)',
    ].join('\n');
    const { container } = await mount(<Markdown source={source} variant="file" links={fileLinks(['docs/src/a.ts', 'docs/img.png'])} />);
    const root = container.querySelector<HTMLElement>('[data-slot="markdown"]')!;
    expect(root.textContent).not.toContain('title: hidden');
    // A soft break is a space, not a line break.
    expect(root.querySelector('br')).toBeNull();
    const paths = [...root.querySelectorAll('[data-slot="markdown-path-link"]')];
    expect(paths.map((link) => [link.textContent, link.getAttribute('title')])).toEqual([['a', 'Open docs/src/a.ts at line 3']]);
    const external = [...root.querySelectorAll<HTMLAnchorElement>('[data-slot="markdown-link"]')];
    expect(external.map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')])).toEqual([
      ['c', 'https://ok.io/', '_blank', 'noopener noreferrer'],
      ['https://bare.io', 'https://bare.io/', '_blank', 'noopener noreferrer'],
    ]);
    // A relative image is never loaded, and isn't a link either.
    expect(root.querySelector('script, img, iframe')).toBeNull();
    for (const text of ['b', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'pic']) expect(root.textContent).toContain(text);
    expectOnlySafeHrefs(root);
  });

  it('keeps the document and chat variants unchanged without links', async () => {
    const { container } = await mount(
      <>
        <Markdown source="[a](./src/a.ts) see src/a.ts https://x.io" variant="document" />
        <Markdown source="[a](./src/a.ts) see src/a.ts" variant="chat" />
      </>,
    );
    expect(container.querySelectorAll('[data-slot="markdown-path-link"]')).toHaveLength(0);
    expect(container.querySelectorAll('[href]')).toHaveLength(0);
  });

  it('parses chat link destinations as candidates', () => {
    expect(parseFileTarget('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 });
  });
});

describe('the viewer (8.7)', () => {
  const folder = (path: string, entries: WorkspaceFolderResponse['entries']): WorkspaceFolderResponse => ({ path, entries, truncated: false });
  const file = (path: string) => ({ name: path.split('/').at(-1)!, path, kind: 'file' as const, protected: false });
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

  it('scrolls ?line= into view and highlights it until the next click; past the end highlights nothing', async () => {
    fake.folders[''] = folder('', [file('a.ts'), file('b.ts')]);
    fake.files['a.ts'] = { kind: 'text', path: 'a.ts', content: lines, size: lines.length, masked: false };
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.getAttribute('data-line') ?? '');
    };
    try {
      await mount(<WorkbenchFiles wsId={WS} path="a.ts" line={12} onSelect={() => undefined} />);
      const highlighted = screen.getAllByTestId('code-line').filter((row) => row.getAttribute('data-highlighted') === 'true');
      expect(highlighted.map((row) => row.getAttribute('data-line'))).toEqual(['12']);
      expect(highlighted[0]!.getAttribute('aria-current')).toBe('location');
      expect(scrolled).toEqual(['12']);
      fireEvent.pointerDown(document.body);
      await flush();
      expect(screen.getAllByTestId('code-line').some((row) => row.getAttribute('data-highlighted') === 'true')).toBe(false);
      cleanup();
      await mount(<WorkbenchFiles wsId={WS} path="a.ts" line={31} onSelect={() => undefined} />);
      expect(screen.getAllByTestId('code-line').some((row) => row.getAttribute('data-highlighted') === 'true')).toBe(false);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('renders a markdown file with Show source, copies the relative path, and names a binary file with its size', async () => {
    fake.folders[''] = folder('', [file('README.md'), file('logo.png')]);
    fake.files['README.md'] = { kind: 'text', path: 'README.md', content: '# Title\n\nSee [a](src/a.ts).\n', size: 26, masked: false };
    fake.files['logo.png'] = { kind: 'binary', path: 'logo.png', size: 2048 };
    fake.existing = new Set(['src/a.ts']);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(<WorkbenchFiles wsId={WS} path="README.md" onSelect={() => undefined} />);
    expect(screen.getByTestId('markdown-rendered').querySelector('h3')?.textContent).toBe('Title');
    const link = screen.getByTestId('markdown-rendered').querySelector('[data-slot="markdown-path-link"]');
    expect(link?.getAttribute('title')).toBe('Open src/a.ts');
    expect(fake.calls.find((call) => call.url === LINKS)?.body).toEqual({ paths: ['src/a.ts'] });
    fireEvent.click(screen.getByTestId('markdown-mode-source'));
    await flush();
    expect(screen.getAllByTestId('code-line-number').map((cell) => cell.textContent)).toEqual(['1', '2', '3']);
    fireEvent.click(screen.getByTestId('markdown-mode-rendered'));
    await flush();
    expect(screen.queryByTestId('code-line')).toBeNull();
    fireEvent.click(screen.getByTestId('copy-path'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('README.md');
    expect(screen.getByTestId('copy-path-status').textContent).toBe('Copied');
    cleanup();
    await mount(<WorkbenchFiles wsId={WS} path="logo.png" onSelect={() => undefined} />);
    expect(screen.getByTestId('file-binary').textContent).toBe(WORKSPACE_FILE_BINARY_TEXT);
    expect(screen.getByTestId('file-size').textContent).toBe(fileSizeWords(2048));
    expect(screen.getByTestId('file-size').textContent).toBe('2 KB');
  });
});
