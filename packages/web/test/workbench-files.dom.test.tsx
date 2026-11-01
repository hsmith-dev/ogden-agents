// @vitest-environment happy-dom
/**
 * The Workbench's Files panel (AD-36): the root listed, a folder listed only
 * when opened, a file shown read-only with line numbers, a protected row
 * shown as protected with no request for it, and the binary, too large,
 * empty, masked and refused states from the shared texts. The REST call is
 * a stand-in that records every path asked for.
 */
import {
  API_ROUTES,
  apiPath,
  WORKSPACE_FILE_BINARY_TEXT,
  WORKSPACE_FILE_EMPTY_TEXT,
  WORKSPACE_FILE_HARD_LINK_TEXT,
  WORKSPACE_FILE_MASKED_TEXT,
  WORKSPACE_FILE_NONE_SELECTED_TEXT,
  WORKSPACE_FILE_PROTECTED_TEXT,
  WORKSPACE_PATH_HARD_LINK_MESSAGE,
  workspaceFileTooLargeText,
  type WorkspaceFileResponse,
  type WorkspaceFolderResponse,
} from '@ogden-agents/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const FILES = apiPath(API_ROUTES.workspaceFiles, { wsId: WS });
const CONTENT = apiPath(API_ROUTES.workspaceFileContent, { wsId: WS });

const fake = vi.hoisted(() => ({ calls: [] as string[], folders: {} as Record<string, unknown>, files: {} as Record<string, unknown> }));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/http')>()),
  call: async (_auth: unknown, url: string) => {
    fake.calls.push(url);
    const [base, query] = url.split('?');
    const path = new URLSearchParams(query ?? '').get('path') ?? '';
    const table = base === CONTENT ? fake.files : fake.folders;
    const answer = table[path];
    if (answer === undefined) throw new Error(`unexpected call ${url}`);
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));

const { WorkbenchFiles } = await import('../src/workbench/workbench-files');
const { ChatApiError } = await import('../src/api/http');

const folder = (path: string, entries: WorkspaceFolderResponse['entries'], truncated = false): WorkspaceFolderResponse => ({ path, entries, truncated });
const fileEntry = (path: string, isProtected = false) => ({ name: path.split('/').at(-1)!, path, kind: 'file' as const, protected: isProtected });
const folderEntry = (path: string, isProtected = false) => ({ name: path.split('/').at(-1)!, path, kind: 'folder' as const, protected: isProtected });

async function flush() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function Harness({ initial }: { initial?: string }) {
  const [path, setPath] = useState<string | undefined>(initial);
  return <WorkbenchFiles wsId={WS} path={path} onSelect={setPath} />;
}

async function mount(initial?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
  await flush();
}

const contentCalls = () => fake.calls.filter((url) => url.startsWith(CONTENT));

afterEach(() => {
  cleanup();
  fake.calls = [];
  fake.folders = {};
  fake.files = {};
});

describe('Workbench Files', () => {
  it('lists the root, opens a folder only when asked, and shows a file with line numbers', async () => {
    fake.folders[''] = folder('', [folderEntry('src'), fileEntry('README.md')]);
    fake.folders['src'] = folder('src', [fileEntry('src/a.ts')]);
    fake.files['src/a.ts'] = { kind: 'text', path: 'src/a.ts', content: 'const a = 1;\n\nexport { a };\n', size: 28, masked: false } satisfies WorkspaceFileResponse;
    await mount();
    expect(screen.getByTestId('file-none').textContent).toBe(WORKSPACE_FILE_NONE_SELECTED_TEXT);
    expect(fake.calls).toEqual([FILES]);
    const src = screen.getByTestId('file-row-src');
    expect(src.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(src);
    await flush();
    expect(src.getAttribute('aria-expanded')).toBe('true');
    expect(fake.calls).toEqual([FILES, `${FILES}?path=src`]);
    fireEvent.click(screen.getByTestId('file-row-src/a.ts'));
    await flush();
    expect(screen.getByTestId('code-view-path').textContent).toBe('src/a.ts');
    expect(screen.getAllByTestId('code-line-number').map((cell) => cell.textContent)).toEqual(['1', '2', '3']);
    expect(screen.getAllByTestId('code-line').map((row) => row.lastElementChild?.textContent)).toEqual(['const a = 1;', '', 'export { a };']);
    expect(screen.getByTestId('file-row-src/a.ts').getAttribute('aria-current')).toBe('true');
    expect(contentCalls()).toEqual([`${CONTENT}?path=src%2Fa.ts`]);
    // Read-only: nothing to type into.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it("colours a file with 8.3's lazy highlighter, as a diff is, and leaves an unknown language plain", async () => {
    fake.folders[''] = folder('', [fileEntry('a.ts'), fileEntry('notes.txt')]);
    fake.files['a.ts'] = { kind: 'text', path: 'a.ts', content: '// note\nexport const a = "hi";\n', size: 30, masked: false };
    fake.files['notes.txt'] = { kind: 'text', path: 'notes.txt', content: 'export const a = "hi";\n', size: 23, masked: false };
    await mount('a.ts');
    // Plain at once, coloured once the grammar has loaded; the text is kept whole.
    await waitFor(() => expect(screen.getByTestId('code-lines').querySelector('[data-token="keyword"]')).not.toBeNull());
    const tokens = [...screen.getByTestId('code-lines').querySelectorAll('[data-token]')].map((span) => [span.getAttribute('data-token'), span.textContent?.trim(), span.className]);
    expect(tokens).toContainEqual(['comment', '// note', 'text-syntax-comment italic']);
    expect(tokens).toContainEqual(['keyword', 'export', 'text-syntax-keyword']);
    expect(tokens).toContainEqual(['string', '"hi"', 'text-syntax-string']);
    expect(screen.getAllByTestId('code-line').map((row) => row.lastElementChild?.textContent)).toEqual(['// note', 'export const a = "hi";']);
    fireEvent.click(screen.getByTestId('file-row-notes.txt'));
    await flush();
    expect(screen.getAllByTestId('code-line').map((row) => row.lastElementChild?.textContent)).toEqual(['export const a = "hi";']);
    expect(screen.getByTestId('code-lines').querySelector('[data-token]')).toBeNull();
  });

  it('splits CRLF and bare CR line endings, with no stray CR on the last line', async () => {
    fake.folders[''] = folder('', [fileEntry('crlf.txt'), fileEntry('cr.txt')]);
    fake.files['crlf.txt'] = { kind: 'text', path: 'crlf.txt', content: 'one\r\ntwo\r\n', size: 10, masked: false };
    fake.files['cr.txt'] = { kind: 'text', path: 'cr.txt', content: 'a\rb\r', size: 4, masked: false };
    await mount('crlf.txt');
    expect(screen.getAllByTestId('code-line').map((row) => row.lastElementChild?.textContent)).toEqual(['one', 'two']);
    fireEvent.click(screen.getByTestId('file-row-cr.txt'));
    await flush();
    expect(screen.getAllByTestId('code-line').map((row) => row.lastElementChild?.textContent)).toEqual(['a', 'b']);
  });

  it('a protected row shows a lock and, selected, the protected sentence with no request for it', async () => {
    fake.folders[''] = folder('', [folderEntry('.git', true), fileEntry('out', true), fileEntry('a.txt')]);
    await mount();
    expect(screen.getByTestId('file-row-.git').querySelector('[data-testid="file-row-lock"]')).not.toBeNull();
    expect(screen.getByTestId('file-row-.git').getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(screen.getByTestId('file-row-.git'));
    await flush();
    expect(screen.getByTestId('file-protected').textContent).toBe(WORKSPACE_FILE_PROTECTED_TEXT);
    fireEvent.click(screen.getByTestId('file-row-out'));
    await flush();
    expect(screen.getByTestId('file-protected').textContent).toBe(WORKSPACE_FILE_PROTECTED_TEXT);
    expect(fake.calls).toEqual([FILES]);
  });

  it('opens a linked file with its folders open, and shows the binary, too large, empty and masked states', async () => {
    fake.folders[''] = folder('', [folderEntry('docs'), fileEntry('img.png'), fileEntry('big.log'), fileEntry('empty.txt'), fileEntry('.env')]);
    fake.folders['docs'] = folder('docs', [fileEntry('docs/x.md')]);
    fake.files['docs/x.md'] = { kind: 'text', path: 'docs/x.md', content: '# X', size: 3, masked: false };
    fake.files['img.png'] = { kind: 'binary', path: 'img.png', size: 10 };
    fake.files['big.log'] = { kind: 'too_large', path: 'big.log', size: 2_000_000, limit: 1_048_576 };
    fake.files['empty.txt'] = { kind: 'text', path: 'empty.txt', content: '', size: 0, masked: false };
    fake.files['.env'] = { kind: 'text', path: '.env', content: 'A=[redacted]\n', size: 13, masked: true };
    await mount('docs/x.md');
    expect(screen.getByTestId('file-row-docs').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('code-view-path').textContent).toBe('docs/x.md');
    for (const [name, testId, text] of [
      ['img.png', 'file-binary', WORKSPACE_FILE_BINARY_TEXT],
      ['big.log', 'file-too-large', workspaceFileTooLargeText(2_000_000, 1_048_576)],
      ['empty.txt', 'file-empty', WORKSPACE_FILE_EMPTY_TEXT],
    ] as const) {
      fireEvent.click(screen.getByTestId(`file-row-${name}`));
      await flush();
      expect(screen.getByTestId(testId).textContent, name).toBe(text);
    }
    fireEvent.click(screen.getByTestId('file-row-.env'));
    await flush();
    expect(screen.getByTestId('file-masked').textContent).toBe(WORKSPACE_FILE_MASKED_TEXT);
    expect(screen.getByTestId('code-lines').textContent).toContain('A=[redacted]');
  });

  it("a refusal from the server shows the protected sentence or the server's message", async () => {
    fake.folders[''] = folder('', [fileEntry('a.txt'), fileEntry('b.txt')]);
    fake.files['a.txt'] = new ChatApiError("Protected. Ogden doesn't open this file.", 403, 'path_protected');
    fake.files['b.txt'] = new ChatApiError("That isn't there any more. It may have been moved or deleted.", 404, 'not_found');
    await mount('a.txt');
    expect(screen.getByTestId('file-protected').textContent).toBe(WORKSPACE_FILE_PROTECTED_TEXT);
    fireEvent.click(screen.getByTestId('file-row-b.txt'));
    await flush();
    expect(screen.getByTestId('file-error').textContent).toBe("That isn't there any more. It may have been moved or deleted.");
  });

  it('a hard-linked row, and a hard-link refusal from the server, say Ogden does not open hard-linked files, with no request for the row', async () => {
    fake.folders[''] = folder('', [{ ...fileEntry('notes.txt', true), protectedReason: 'hard_link' }, fileEntry('late.txt')]);
    fake.files['late.txt'] = new ChatApiError(WORKSPACE_PATH_HARD_LINK_MESSAGE, 403, 'path_protected');
    await mount('notes.txt');
    expect(screen.getByTestId('file-protected').textContent).toBe(WORKSPACE_FILE_HARD_LINK_TEXT);
    expect(WORKSPACE_FILE_HARD_LINK_TEXT).not.toMatch(/[\u2013\u2014]/);
    fireEvent.click(screen.getByTestId('file-row-late.txt'));
    await flush();
    expect(screen.getByTestId('file-protected').textContent).toBe(WORKSPACE_FILE_HARD_LINK_TEXT);
    expect(fake.calls).toEqual([FILES, `${CONTENT}?path=late.txt`]);
  });
});
