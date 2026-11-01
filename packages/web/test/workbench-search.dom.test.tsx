// @vitest-environment happy-dom
/**
 * The Workbench's Search panel (8.8): the EXPERIENCE.md sentences before
 * typing, for no match and over the cap; a search only after a pause in
 * typing, its results grouped by file with each line a link to the viewer
 * at that line; File names, Match case and Regex sent as the route reads
 * them; a 501 says Search isn't available, an invalid pattern says so. The
 * REST call is a stand-in that records every URL asked for.
 */
import {
  API_ROUTES,
  apiPath,
  WORKSPACE_SEARCH_CAPPED_TEXT,
  WORKSPACE_SEARCH_EMPTY_TEXT,
  WORKSPACE_SEARCH_INVALID_REGEX_TEXT,
  WORKSPACE_SEARCH_STOPPED_TEXT,
  WORKSPACE_SEARCH_UNAVAILABLE_TEXT,
  workspaceSearchNoMatchText,
  type WorkspaceSearchResponse,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SEARCH = apiPath(API_ROUTES.workspaceFileSearch, { wsId: WS });

const fake = vi.hoisted(() => ({ calls: [] as string[], answer: undefined as unknown as (params: URLSearchParams) => unknown }));

vi.mock('@/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/http')>();
  return {
    ...actual,
    call: async (_auth: unknown, url: string) => {
      fake.calls.push(url);
      const [base, query] = url.split('?');
      if (base !== SEARCH) throw new Error(`unexpected call ${url}`);
      const answer = fake.answer(new URLSearchParams(query));
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
});

const { WorkbenchSearch } = await import('../src/workbench/workbench-search');
const { ChatApiError } = await import('../src/api/http');
const { workbenchSearch } = await import('../src/router');

type State = { q: string; mode: 'text' | 'names'; matchCase: boolean; regex: boolean };

async function flush() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function Harness({ initial, session }: { initial: State; session?: string }) {
  const [state, setState] = useState(initial);
  return <WorkbenchSearch wsId={WS} session={session} {...state} onChange={setState} />;
}

async function mount(initial: Partial<State> = {}, session?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = <Harness initial={{ q: '', mode: 'text', matchCase: false, regex: false, ...initial }} session={session} />;
  const root = createRootRoute({ component: () => <QueryClientProvider client={client}>{node}</QueryClientProvider> });
  const page = createRoute({ getParentRoute: () => root, path: '/w/$wsId/workbench', validateSearch: workbenchSearch });
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [`/w/${WS}/workbench?panel=search`] }) });
  await router.load();
  render(<RouterProvider router={router} />);
  await flush();
}

const answer = (files: WorkspaceSearchResponse['files'], truncated = false): WorkspaceSearchResponse => ({ files, truncated, limit: 500 });
const type = (text: string) => fireEvent.change(screen.getByTestId('search-field'), { target: { value: text } });

afterEach(() => {
  cleanup();
  fake.calls = [];
});

describe('Workbench Search', () => {
  it('says what it does before typing, and asks nothing', async () => {
    fake.answer = () => answer([]);
    await mount();
    expect(screen.getByTestId('search-empty').textContent).toBe(WORKSPACE_SEARCH_EMPTY_TEXT);
    expect(screen.getByLabelText('Search the project')).toBe(screen.getByTestId('search-field'));
    expect(fake.calls).toEqual([]);
  });

  it('searches after a pause in typing, once, and groups the matches by file, each a link to the viewer at its line', async () => {
    fake.answer = () =>
      answer([
        { path: 'src/a.ts', matches: [{ line: 3, column: 9, preview: '  const needle = 1;' }, { line: 7, column: 1, preview: 'needle()' }] },
        { path: 'README.md', matches: [{ line: 1, column: 3, preview: '# needle' }] },
      ]);
    await mount();
    type('n');
    type('nee');
    type('needle');
    expect(fake.calls).toEqual([]);
    await waitFor(() => expect(screen.getAllByTestId('search-file')).toHaveLength(2));
    expect(fake.calls).toEqual([`${SEARCH}?q=needle`]);
    expect(screen.getAllByTestId('search-file-path').map((each) => each.textContent)).toEqual(['src/a.ts', 'README.md']);
    const links = screen.getAllByTestId('search-match');
    expect(links.map((link) => link.textContent)).toEqual(['3  const needle = 1;', '7needle()', '1# needle']);
    const href = new URL(links[0]!.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe(`/w/${WS}/workbench`);
    expect(Object.fromEntries(href.searchParams)).toEqual({ path: 'src/a.ts', line: '3' });
    expect(links[0]!.getAttribute('title')).toBe('Open src/a.ts at line 3');
    // Enter on a focused link is the browser's own: it is a real link.
    expect(links[0]!.tagName).toBe('A');
  });

  it('keeps a worktree chat in each result link', async () => {
    fake.answer = () => answer([{ path: 'a.ts', matches: [{ line: 2, column: 1, preview: 'x' }] }]);
    await mount({ q: 'x' }, SES);
    expect(fake.calls).toEqual([`${SEARCH}?q=x&session=${SES}`]);
    const href = new URL(screen.getByTestId('search-match').getAttribute('href')!, 'http://x');
    expect(Object.fromEntries(href.searchParams)).toEqual({ path: 'a.ts', line: '2', session: SES });
  });

  it('says so when nothing matches, when capped, and when stopped early', async () => {
    fake.answer = () => answer([]);
    await mount({ q: 'invoice' });
    expect(screen.getByTestId('search-no-match').textContent).toBe(workspaceSearchNoMatchText('invoice'));
    cleanup();
    fake.answer = () => answer([{ path: 'a.ts', matches: Array.from({ length: 500 }, (_, i) => ({ line: i + 1, column: 1, preview: 'x' })) }], true);
    await mount({ q: 'x' });
    expect(screen.getByTestId('search-capped').textContent).toBe(WORKSPACE_SEARCH_CAPPED_TEXT);
    expect(screen.getAllByTestId('search-match')).toHaveLength(500);
    cleanup();
    fake.answer = () => answer([{ path: 'a.ts', matches: [{ line: 1, column: 1, preview: 'x' }] }], true);
    await mount({ q: 'x' });
    expect(screen.getByTestId('search-stopped').textContent).toBe(WORKSPACE_SEARCH_STOPPED_TEXT);
  });

  it('sends File names, Match case and Regex as the route reads them; names are links to the file', async () => {
    fake.answer = (params) => (params.get('mode') === 'names' ? answer([{ path: 'src/a.ts', matches: [] }]) : answer([]));
    await mount({ q: 'a.ts' });
    fireEvent.click(screen.getByTestId('search-mode-names'));
    await flush();
    expect(fake.calls.at(-1)).toBe(`${SEARCH}?q=a.ts&mode=names`);
    const name = screen.getByTestId('search-name');
    expect(name.textContent).toBe('src/a.ts');
    expect(Object.fromEntries(new URL(name.getAttribute('href')!, 'http://x').searchParams)).toEqual({ path: 'src/a.ts' });
    fireEvent.click(screen.getByTestId('search-match-case'));
    await flush();
    expect(fake.calls.at(-1)).toBe(`${SEARCH}?q=a.ts&mode=names&matchCase=true`);
    fireEvent.click(screen.getByTestId('search-regex'));
    await flush();
    expect(fake.calls.at(-1)).toBe(`${SEARCH}?q=a.ts&mode=names&matchCase=true&regex=true`);
    expect(screen.getByTestId('search-regex').getAttribute('aria-pressed')).toBe('true');
  });

  it("says Search isn't available on a 501, and shows an invalid pattern's sentence", async () => {
    fake.answer = () => new ChatApiError('Not implemented yet.', 501, 'not_implemented');
    await mount({ q: 'x' });
    expect(screen.getByTestId('search-unavailable').textContent).toBe(WORKSPACE_SEARCH_UNAVAILABLE_TEXT);
    cleanup();
    fake.answer = () => new ChatApiError(WORKSPACE_SEARCH_INVALID_REGEX_TEXT, 400, 'invalid_request');
    await mount({ q: 'add(', regex: true });
    expect(screen.getByTestId('search-error').textContent).toBe(WORKSPACE_SEARCH_INVALID_REGEX_TEXT);
  });

  it('the router keeps a valid search and drops the rest', () => {
    expect(workbenchSearch({ panel: 'search', q: 'needle', mode: 'names', matchCase: true, regex: 'true' })).toEqual({ panel: 'search', q: 'needle', mode: 'names', matchCase: true, regex: true });
    expect(workbenchSearch({ panel: 'search', q: 12 })).toEqual({ panel: 'search', q: '12' });
    expect(workbenchSearch({ panel: 'search', q: 'x'.repeat(201), mode: 'paths', matchCase: 'yes', regex: 1 })).toEqual({ panel: 'search' });
    expect(workbenchSearch({ panel: 'other' })).toEqual({});
  });
});
