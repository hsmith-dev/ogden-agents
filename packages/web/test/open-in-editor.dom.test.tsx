// @vitest-environment happy-dom
/**
 * Open in editor in a DOM (AD-39; story 8.10): with no editor found (or a
 * server without the launcher, 501) every button is disabled with
 * `EDITOR_NONE_FOUND_TEXT` as its described reason; found, a click sends the
 * workspace-relative path and line (never a program) and says `Opened in VS
 * Code` for a moment, announced; a refusal says `Couldn't open` with its
 * reason announced. A path link's `Cmd`/`Ctrl`+click opens the file at its
 * line instead of following the link. Settings, Projects, Editor saves the
 * choice on change. The REST call is a stand-in.
 */
import { API_ROUTES, apiPath, EDITOR_NONE_FOUND_TEXT, EDITOR_UNAVAILABLE_MESSAGE, type EditorsResponse } from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const OPEN = apiPath(API_ROUTES.workspaceFileOpenInEditor, { wsId: WS });

const fake = vi.hoisted(() => ({
  calls: [] as { url: string; method: string; body?: unknown }[],
  editors: undefined as unknown,
  open: undefined as unknown,
}));

vi.mock('@/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/http')>();
  return {
    ...actual,
    call: async (_auth: unknown, url: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      fake.calls.push({ url, method: init.method ?? 'GET', ...(body === undefined ? {} : { body }) });
      const answer = url === API_ROUTES.editors ? (init.method === 'PUT' ? { ...(fake.editors as EditorsResponse), defaultEditorId: (body as { editorId: string }).editorId, chosenEditorId: (body as { editorId: string }).editorId } : fake.editors) : url === OPEN ? fake.open : undefined;
      if (answer === undefined) throw new Error(`unexpected call ${url}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
});

const { OpenInEditorButton, editorPathOf } = await import('../src/workbench/open-in-editor');
const { ToolCalls } = await import('../src/chat/tool-call-row');
const { PathLink } = await import('../src/workbench/path-links');
const { EditorChoiceSection } = await import('../src/settings/editor-settings');
const { ChatApiError } = await import('../src/api/http');

const FOUND: EditorsResponse = { editors: [{ id: 'vscode', name: 'VS Code' }, { id: 'cursor', name: 'Cursor' }], defaultEditorId: 'vscode', chosenEditorId: null };
const NONE: EditorsResponse = { editors: [], defaultEditorId: null, chosenEditorId: null };

afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.editors = undefined;
  fake.open = undefined;
});

async function flush() {
  for (let i = 0; i < 6; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <QueryClientProvider client={client}>{node}</QueryClientProvider> });
  const workbench = createRoute({ getParentRoute: () => root, path: '/w/$wsId/workbench' });
  const router = createRouter({ routeTree: root.addChildren([workbench]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  await router.load();
  render(<RouterProvider router={router} />);
  await flush();
  return router;
}

const opens = () => fake.calls.filter((call) => call.url === OPEN);

describe('Open in editor', () => {
  it('is disabled with the none-found reason when no editor is found, or the server has no launcher (501)', async () => {
    for (const editors of [NONE, new ChatApiError('Not implemented', 501, 'not_implemented')]) {
      fake.editors = editors;
      await mount(<OpenInEditorButton wsId={WS} session={undefined} target={{ path: 'src/a.ts', line: 12 }} />);
      const button = screen.getByTestId('open-in-editor');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      const reason = document.getElementById(button.getAttribute('aria-describedby')!);
      expect(reason?.textContent).toBe(EDITOR_NONE_FOUND_TEXT);
      fireEvent.click(button);
      await flush();
      expect(opens()).toEqual([]);
      cleanup();
      fake.calls = [];
    }
  });

  it('opens the path at its line (in the chat named) and says Opened in VS Code, announced', async () => {
    fake.editors = FOUND;
    fake.open = { editorId: 'vscode', editorName: 'VS Code' };
    await mount(<OpenInEditorButton wsId={WS} session={SES} target={{ path: 'src/a.ts', line: 12 }} />);
    const button = screen.getByTestId('open-in-editor');
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(button.textContent).toBe('Open in editor: src/a.ts');
    fireEvent.click(button);
    await flush();
    expect(opens()).toEqual([{ url: OPEN, method: 'POST', body: { path: 'src/a.ts', line: 12, session: SES } }]);
    expect(button.textContent).toBe('Opened in VS Code: src/a.ts');
    expect(screen.getByTestId('open-in-editor-status').textContent).toBe('Opened in VS Code');
  });

  it("says Couldn't open with the server's reason when the editor is unavailable", async () => {
    fake.editors = FOUND;
    fake.open = new ChatApiError(EDITOR_UNAVAILABLE_MESSAGE, 409, 'editor_unavailable');
    await mount(<OpenInEditorButton wsId={WS} session={undefined} target={{ path: 'src/a.ts' }} />);
    fireEvent.click(screen.getByTestId('open-in-editor'));
    await flush();
    expect(opens()).toEqual([{ url: OPEN, method: 'POST', body: { path: 'src/a.ts' } }]);
    expect(screen.getByTestId('open-in-editor').textContent).toBe("Couldn't open: src/a.ts");
    expect(screen.getByTestId('open-in-editor-status').textContent).toBe(EDITOR_UNAVAILABLE_MESSAGE);
  });

  it('Cmd/Ctrl+click on a path link opens the file at its line and stays on the page; a plain click follows the link', async () => {
    fake.editors = FOUND;
    fake.open = { editorId: 'vscode', editorName: 'VS Code' };
    const router = await mount(
      <PathLink wsId={WS} session={undefined} target={{ path: 'src/a.ts', line: 7 }}>
        src/a.ts:7
      </PathLink>,
    );
    const link = screen.getByText('src/a.ts:7');
    fireEvent.click(link, { metaKey: true });
    await flush();
    expect(opens()).toEqual([{ url: OPEN, method: 'POST', body: { path: 'src/a.ts', line: 7 } }]);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByTestId('path-link-editor-status').textContent).toBe('Opened in VS Code');
    fireEvent.click(link, { ctrlKey: true });
    await flush();
    expect(opens()).toHaveLength(2);
    fireEvent.click(link);
    await flush();
    expect(opens()).toHaveLength(2);
    expect(router.state.location.pathname).toBe(`/w/${WS}/workbench`);
  });

  it('a path link with no editor found stays on the page on Cmd+click and says why (nothing is sent)', async () => {
    fake.editors = NONE;
    const router = await mount(
      <PathLink wsId={WS} session={undefined} target={{ path: 'src/a.ts', line: 7 }}>
        src/a.ts:7
      </PathLink>,
    );
    fireEvent.click(screen.getByText('src/a.ts:7'), { metaKey: true });
    await flush();
    expect(opens()).toEqual([]);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByTestId('path-link-editor-status').textContent).toBe(EDITOR_NONE_FOUND_TEXT);
  });

  it("a chat edit row's absolute path under the chat's folder opens relative to it; one outside it has no button", async () => {
    fake.editors = FOUND;
    fake.open = { editorId: 'vscode', editorName: 'VS Code' };
    const edit = (id: string, path: string) => ({ toolCallId: id, title: `Edit ${path}`, kind: 'edit' as const, status: 'completed' as const, diffs: [{ path, oldText: 'a\n', newText: 'b\n' }] });
    await mount(<ToolCalls calls={[edit('e1', '/repo/src/a.ts'), edit('e2', '/elsewhere/b.ts'), edit('e3', '/repo/../etc/passwd')]} detail="verbose" chat={{ wsId: WS, sesId: SES, roots: ['/repo/'] }} />);
    const buttons = screen.getAllByTestId('diff-open-in-editor');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Open in editor: src/a.ts');
    fireEvent.click(buttons[0]!);
    await flush();
    expect(opens()).toEqual([{ url: OPEN, method: 'POST', body: { path: 'src/a.ts', line: 1, session: SES } }]);
  });
});

describe('editorPathOf', () => {
  it('keeps a relative path, makes an absolute one under a root relative (POSIX and Windows separators), and refuses the rest', () => {
    expect(editorPathOf('src/a.ts')).toBe('src/a.ts');
    expect(editorPathOf('../a.ts')).toBeUndefined();
    expect(editorPathOf('/repo/src/a.ts', ['/repo'])).toBe('src/a.ts');
    expect(editorPathOf('/repository/a.ts', ['/repo'])).toBeUndefined();
    expect(editorPathOf('/repo/./a.ts', ['/repo'])).toBeUndefined();
    expect(editorPathOf('/repo/src/a.ts', [])).toBeUndefined();
    expect(editorPathOf('C:\\w\\src\\a.ts', ['C:\\w'])).toBe('src/a.ts');
    expect(editorPathOf('C:\\w\\..\\x.ts', ['C:\\w\\'])).toBeUndefined();
  });
});

describe('Settings, Projects, Editor', () => {
  it('lists the editors found with the default checked, and saves a choice on change', async () => {
    fake.editors = FOUND;
    await mount(<EditorChoiceSection />);
    expect(screen.getByRole('radiogroup', { name: 'Open files in' })).toBeTruthy();
    expect(screen.getByTestId('editor-option-vscode').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('editor-option-cursor'));
    await flush();
    expect(fake.calls.filter((call) => call.method === 'PUT')).toEqual([{ url: API_ROUTES.editors, method: 'PUT', body: { editorId: 'cursor' } }]);
    expect(screen.getByTestId('editor-option-cursor').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('editor-settings-status').textContent).toBe('Saved: files open in Cursor.');
  });

  it('says none was found when the list is empty', async () => {
    fake.editors = NONE;
    await mount(<EditorChoiceSection />);
    expect(screen.getByTestId('editor-settings-none').textContent).toBe(EDITOR_NONE_FOUND_TEXT);
  });
});
