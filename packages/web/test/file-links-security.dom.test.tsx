// @vitest-environment happy-dom
/**
 * Security probes for 8.7's viewer links: a rendered markdown file and an
 * agent's reply (both untrusted) never produce markup, script, styles or an
 * address outside http, https, mailto and the in-app viewer route; external
 * links open with no opener; relative links never leave the project however
 * they are spelled; the viewer's search (`path`, `line`, `session`) survives
 * the router as written and drops anything malformed; the new patterns run
 * in linear time; a reply asks about at most `MAX_WORKSPACE_FILE_LINKS`
 * paths per request. The REST call is a stand-in.
 */
import { API_ROUTES, apiPath, MAX_WORKSPACE_FILE_LINKS, WorkspaceRelativePath } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptMessage } from '../src/chat/transcript';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const LINKS = apiPath(API_ROUTES.workspaceFileLinks, { wsId: WS });

const fake = vi.hoisted(() => ({ calls: [] as { url: string; body?: { paths: string[]; session?: string } }[], existing: new Set<string>(), all: false }));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/http')>()),
  call: async (_auth: unknown, url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { paths: string[] }) : undefined;
    fake.calls.push({ url, ...(body === undefined ? {} : { body }) });
    if (url === LINKS) return { found: body!.paths.filter((path) => fake.all || fake.existing.has(path)) };
    throw new Error(`unexpected call ${url}`);
  },
}));

const { Markdown } = await import('../src/ui/markdown');
const { pathTokens } = await import('../src/ui/markdown-inline');
const { Message } = await import('../src/chat/transcript-parts');
const { markdownLinkCandidates, parseFileTarget, pathCandidates, resolveRelative, viewerLinks, viewerSearch } = await import('../src/workbench/path-links');
const { workbenchSearch } = await import('../src/router');

afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.existing = new Set();
  fake.all = false;
});

async function flush() {
  for (let i = 0; i < 6; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount(node: ReactNode, validateSearch?: (search: Record<string, unknown>) => object) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <QueryClientProvider client={client}>{node}</QueryClientProvider> });
  const chat = createRoute({ getParentRoute: () => root, path: '/w/$wsId/s/$sesId' });
  const workbench = createRoute({ getParentRoute: () => root, path: '/w/$wsId/workbench', ...(validateSearch === undefined ? {} : { validateSearch }) });
  const router = createRouter({ routeTree: root.addChildren([chat, workbench]), history: createMemoryHistory({ initialEntries: [`/w/${WS}/s/${SES}`] }) });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await flush();
  return { ...view, router };
}

/** No element or attribute that could run script or style the page, and every href safe. */
function expectInert(root: HTMLElement) {
  expect(root.querySelector('script, style, iframe, object, embed, img, math, foreignObject, svg script, svg a, form, input, link, meta, base, video, audio, source')).toBeNull();
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of element.getAttributeNames()) {
      expect(attribute.startsWith('on'), `${element.tagName} ${attribute}`).toBe(false);
      expect(attribute, element.tagName).not.toBe('style');
      expect(attribute, element.tagName).not.toBe('srcdoc');
      expect(attribute, element.tagName).not.toBe('src');
    }
  }
  const anchors = [...root.querySelectorAll('a')];
  // No link inside a link.
  for (const anchor of anchors) expect(anchor.querySelector('a')).toBeNull();
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') ?? '';
    expect(href, href).toMatch(new RegExp(`^(?:https?://[^/\\\\]|mailto:|/w/${WS}/workbench\\?)`));
    if (anchor.getAttribute('target') !== null) expect(anchor.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    if (href.startsWith('http')) expect(anchor.getAttribute('target')).toBe('_blank');
  }
  return anchors.map((anchor) => anchor.getAttribute('href')!);
}

const UNSAFE_DESTINATIONS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  '\tjavascript:alert(1)',
  'java\tscript:alert(1)',
  'java%09script:alert(1)',
  '%6Aavascript:alert(1)',
  '&#106;avascript:alert(1)',
  '<javascript:alert(1)>',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'DATA:text/html;base64,PHNjcmlwdD4=',
  'file:///etc/passwd',
  'FILE://host/share',
  '//evil.example/x',
  '\\\\evil.example\\x',
  '/\\evil.example',
  'https:\\\\evil.example',
  'https:/\\evil.example',
  'https://user:pass@evil.example',
  'https://trusted.example@evil.example',
  'https://evil\u202e.example',
  'https://evil\u200b.example',
  'https://evil.example\u0000x',
  'blob:https://x/1',
  'about:blank',
  'chrome://settings',
  'ws://evil.example',
  'intent://x#Intent;end',
];

const agentMessage = (text: string): TranscriptMessage => ({ messageId: 'm1', role: 'agent', text, streaming: false });

describe('no markup, script or unsafe link from a chat reply or a markdown file', () => {
  it.each(['chat', 'file'] as const)('%s: unsafe link and image destinations are text, raw HTML is text, and no attribute can be injected', async (variant) => {
    // Every path is "confirmed": only the renderer's own rules decide.
    const links = viewerLinks(WS, variant === 'chat' ? SES : undefined, { has: () => true } as unknown as ReadonlySet<string>, variant === 'chat' ? (d) => parseFileTarget(d.trim()) : (d) => resolveRelative('docs/README.md', d), variant === 'chat');
    const source = [
      ...UNSAFE_DESTINATIONS.map((destination, i) => `[l${i}](${destination}) ![i${i}](${destination})`),
      '<a href="javascript:alert(1)">x</a> <img src=x onerror=alert(1)> <svg onload=alert(1)> <style>body{display:none}</style> <iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '[t](https://ok.example "onmouseover=alert(1) style=x") [q](https://ok.example/" onmouseover="alert(1))',
      'https://ok.example/"onmouseover=alert(1) <https://ok.example/a> <javascript:alert(1)> mailto:a@b.example',
      '[src/a.ts](https://ok.example) `src/a.ts` src/a.ts:3 **src/a.ts** [`src/a.ts`](src/a.ts)',
      '```html\n<script>alert(1)</script>\n```',
    ].join('\n');
    const { container } = await mount(<Markdown source={source} variant={variant} links={links} />);
    const root = container.querySelector<HTMLElement>('[data-slot="markdown"]')!;
    const hrefs = expectInert(root);
    // `https:\\evil.example` is a plain https link once the URL parser reads it (shown in full as its title); nothing else of these is followable.
    const external = hrefs.filter((href) => !href.startsWith('/w/'));
    expect(external.filter((href) => href !== 'https://ok.example/' && href !== 'https://ok.example/a' && href !== 'https://ok.example/%22' && href !== 'mailto:a@b.example' && href !== 'https://evil.example/'), external.join('\n')).toEqual([]);
    for (const anchor of root.querySelectorAll('a[target]')) expect(anchor.getAttribute('title')).toBe(anchor.getAttribute('href'));
    // A viewer link's path is always a project path, whatever the destination.
    for (const anchor of root.querySelectorAll('[data-slot="markdown-path-link"]')) expect(WorkspaceRelativePath.safeParse(anchor.getAttribute('data-path')).success).toBe(true);
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  it('a link title or label cannot carry attributes onto the viewer link', async () => {
    const links = viewerLinks(WS, SES, new Set(['src/a.ts']), (d) => parseFileTarget(d.trim().replace(/^<(.*)>$/, '$1')), true);
    const { container } = await mount(<Markdown source={'[x" onclick="alert(1)](src/a.ts) [y](<src/a.ts>) [z](src/a.ts "t" onclick=1)'} variant="chat" links={links} />);
    const root = container.querySelector<HTMLElement>('[data-slot="markdown"]')!;
    expectInert(root);
    const viewer = [...root.querySelectorAll('[data-slot="markdown-path-link"]')];
    expect(viewer.map((a) => a.getAttribute('title'))).toEqual(['Open src/a.ts', 'Open src/a.ts']);
  });

  it('a chat reply rendered through Message with every candidate confirmed stays inert', async () => {
    fake.all = true;
    const reply = [...UNSAFE_DESTINATIONS.map((d) => `[x](${d})`), 'see src/a.ts:12 and ./b.ts#L3 and `c/d.ts`', '<b onclick=alert(1)>hi</b>'].join('\n');
    const { container } = await mount(<Message message={agentMessage(reply)} agentName="Agent" wsId={WS} sesId={SES} />);
    expectInert(container);
    for (const call of fake.calls.filter((each) => each.url === LINKS)) for (const path of call.body!.paths) expect(WorkspaceRelativePath.safeParse(path).success, path).toBe(true);
  });
});

describe('relative links never leave the project', () => {
  const from = 'docs/guide/README.md';
  it.each([
    '/etc/passwd',
    '//host/x',
    '~/x',
    '%7E/x',
    '~user/x',
    '../../../x',
    '../../../../x',
    './../../../x',
    'a/../../../../x',
    '%2e%2e/%2e%2e/%2e%2e/x',
    '%2E%2E%2F%2E%2E%2F%2E%2E%2Fx',
    '.%2e/.%2e/.%2e/x',
    '%2F%2Fhost/x',
    '%2Fetc/passwd',
    '..\\..\\..\\x',
    '%5C..%5Cx',
    'C:/x',
    'c%3A/x',
    'C%3A%5Cx',
    'file:x',
    'x%00.ts',
    '<../../../x>',
    '#L1',
    '?q=../../x',
    '%',
    '%E0%A4%A',
  ])('%s from docs/guide/README.md is never a target outside the project', (href) => {
    const target = resolveRelative(from, href);
    if (target === null) return;
    expect(WorkspaceRelativePath.safeParse(target.path).success).toBe(true);
    expect(target.path.split('/')).not.toContain('..');
    expect(target.path.startsWith('docs/') || !target.path.includes('/') || target.path.split('/').length >= 1).toBe(true);
    // Once decoded, the path has nothing a file system or the router could read as a step up or out.
    expect(target.path).not.toMatch(/^[/~]|[\\:\0]/);
  });

  it('decodes once only: a double-encoded `..` is a literal name, never applied', () => {
    expect(resolveRelative('docs/README.md', '%252e%252e/%252e%252e/x')).toEqual({ path: 'docs/%2e%2e/%2e%2e/x' });
  });

  it('a decoded path with control or bidi characters is never a viewer target (as safeHref refuses them)', () => {
    for (const href of ['%E2%80%AEdm.txt', 'a%0Ab.ts', 'a%09b.ts', 'a%1Bb.ts', 'a%C2%A0b.ts', 'a%E2%80%8Bb.ts', 'a%E2%81%A6b.ts', 'a%7Fb.ts']) {
      expect(resolveRelative('docs/README.md', href), href).toBeNull();
    }
  });

  it('chat candidates are never absolute, home, parent, URL, drive or encoded paths', () => {
    const text = '/etc/passwd ~/x ../x ./../x a/../../x C:/x c:\\x \\\\h\\s file:///x https://h/a.ts %2e%2e/x.ts x/%2e%2e/y.ts //h/a.ts .git/../x.ts';
    for (const path of pathCandidates(text)) {
      expect(WorkspaceRelativePath.safeParse(path).success, path).toBe(true);
      expect(path, path).not.toMatch(/^[/~]|(^|\/)\.\.(\/|$)|%|[\\:]/);
    }
    expect(pathCandidates(text)).not.toContain('h/a.ts');
  });
});

describe('the viewer search built from untrusted text', () => {
  it('drops a malformed line or session and a line without a path', () => {
    for (const line of ['0', '-1', '1.5', '1e3', '0x10', ' 1', '1 ', 'Infinity', 'NaN', '9999999999', '', '١٢']) expect(workbenchSearch({ path: 'a.ts', line }), line).toEqual({ path: 'a.ts' });
    for (const line of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '12' as unknown as number]) {
      const kept = workbenchSearch({ path: 'a.ts', line });
      if (kept.line !== undefined) expect(Number.isSafeInteger(kept.line) && kept.line >= 1, String(line)).toBe(true);
    }
    expect(workbenchSearch({ line: 3 })).toEqual({});
    for (const session of ['ses_x', '../ses', 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3/../x', 'javascript:x', 1, ['ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3']]) expect(workbenchSearch({ path: 'a.ts', session }), String(session)).toEqual({ path: 'a.ts' });
    for (const path of [1, ['a.ts'], { a: 1 }, null, '']) expect(workbenchSearch({ path })).toEqual({});
  });

  it('a viewer link keeps the path, line and session exactly as confirmed through the router (no second decode)', async () => {
    const paths = ['docs/%2e%2e/x.md', 'a&path=.git/config/b.ts', 'a#b/c.ts', 'a+b/c d.ts', '123', 'true', 'null', '[1]', '{a}/b.ts', 'é/ü.ts', 'a?x=1/b.ts', 'a%26b.ts'];
    const { container, router } = await mount(
      <>
        {paths.map((path) => (
          <Markdown key={path} source={`[x](${encodeURIComponent(path).replace(/%2F/g, '/')})`} variant="file" links={viewerLinks(WS, SES, new Set([path]), (d) => resolveRelative('README.md', d), false)} />
        ))}
      </>,
      workbenchSearch,
    );
    const anchors = [...container.querySelectorAll<HTMLAnchorElement>('[data-slot="markdown-path-link"]')];
    expect(anchors.map((a) => a.getAttribute('data-path'))).toEqual(paths);
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href')!;
      await act(() => router.navigate({ href }));
      expect(router.state.location.pathname).toBe(`/w/${WS}/workbench`);
      expect(router.state.location.search, href).toEqual({ path: anchor.getAttribute('data-path'), session: SES });
    }
  });

  it('builds the search from the confirmed target only', () => {
    expect(viewerSearch({ path: 'a.ts', line: 3 }, SES)).toEqual({ path: 'a.ts', line: 3, session: SES });
    expect(parseFileTarget('src/a.ts:99999999999')).toBeNull();
    expect(parseFileTarget('src/a.ts#L0')).toBeNull();
    expect(parseFileTarget('src/a.ts:0')).toBeNull();
  });
});

describe('resource use', () => {
  const time = (fn: () => unknown) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  it('pathCandidates on a long run of dots ending in a letter is linear (no ReDoS in the trailing-dot strip)', () => {
    // A reply's whole text goes through pathCandidates (no line cap): the trailing `/\.+$/` strip is quadratic.
    const elapsed = time(() => pathCandidates(`${'.'.repeat(100_000)}a`));
    expect(elapsed).toBeLessThan(250);
  });

  it('pathTokens, parseFileTarget and markdownLinkCandidates stay linear on adversarial input', () => {
    const n = 200_000;
    expect(time(() => pathTokens(`${'a/'.repeat(n / 2)}:`))).toBeLessThan(250);
    expect(time(() => pathTokens(`a:${'1'.repeat(n)}x`))).toBeLessThan(250);
    expect(time(() => parseFileTarget(`${'a:1'.repeat(n / 3)}x`))).toBeLessThan(250);
    expect(time(() => markdownLinkCandidates('README.md', `[a](${'x'.repeat(n)}`))).toBeLessThan(250);
    expect(time(() => markdownLinkCandidates('README.md', `[a](${'(x'.repeat(n / 2)}`))).toBeLessThan(250);
    expect(time(() => markdownLinkCandidates('README.md', '[]('.repeat(n / 3)))).toBeLessThan(250);
    expect(time(() => markdownLinkCandidates('README.md', `${'['.repeat(n)}`))).toBeLessThan(250);
    expect(time(() => resolveRelative('README.md', `${'a/'.repeat(n / 2)}#L${'1'.repeat(1000)}`))).toBeLessThan(250);
  });

  it('a reply naming thousands of paths asks about at most MAX_WORKSPACE_FILE_LINKS, and requests never carry more', async () => {
    const many = Array.from({ length: 5_000 }, (_, i) => `src/f${i}.ts`).join(' ');
    const messages = Array.from({ length: 5 }, (_, i) => ({ ...agentMessage(`${many} m${i}/x.ts`), messageId: `m${i}` }));
    await mount(
      <>
        {messages.map((message) => (
          <Message key={message.messageId} message={message} agentName="Agent" wsId={WS} sesId={SES} />
        ))}
      </>,
    );
    const asked = fake.calls.filter((call) => call.url === LINKS);
    for (const call of asked) expect(call.body!.paths.length).toBeLessThanOrEqual(MAX_WORKSPACE_FILE_LINKS);
    const distinct = new Set(asked.flatMap((call) => call.body!.paths));
    // Each message offers at most MAX_WORKSPACE_FILE_LINKS; the same paths across messages are asked once.
    expect(distinct.size).toBeLessThanOrEqual(MAX_WORKSPACE_FILE_LINKS);
    expect(asked.length).toBeLessThanOrEqual(2);
  });
});
