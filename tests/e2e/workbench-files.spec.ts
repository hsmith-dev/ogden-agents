/// <reference lib="dom" />
/**
 * The Workbench's Files panel (AD-36) in a real browser: from a project's
 * Chats page, the Workbench tab lists the fixture project, and selecting
 * `src/a.ts` shows its lines read-only with line numbers, at desktop and
 * phone widths with no sideways scroll; a protected row shows the protected
 * sentence and no content request is made for it.
 *
 * 8.7: README.md renders as Markdown with Show source; a fake agent reply
 * naming `src/a.ts:12` links it (an unconfirmed path stays text), and the
 * link opens the file with line 12 highlighted and in view; `.env` is
 * masked, a 2 MB file and a binary one say so with their sizes; axe finds
 * nothing and a 390px page has no sideways scroll.
 *
 * 8.8: `g s` opens Search; typing a fixture word lists the tracked file and
 * not the ignored one, and its result opens the viewer at that line; axe
 * finds nothing on the panel and a 390px page has no sideways scroll.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { API_ROUTES } from '../support.js';
import { send, startChat, withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const SOURCE = 'const a = 1;\n\nexport function add(b: number): number {\n  return a + b;\n}\n';

/** Adds the folder `repo` as a project through the REST API. */
async function addProject(page: Page, repo: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await storedToken(page)}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** Nothing scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** The lines shown, as text, and their numbers. */
async function shownLines(page: Page) {
  const rows = page.getByTestId('code-line');
  return {
    numbers: await page.getByTestId('code-line-number').allTextContents(),
    text: await rows.evaluateAll((elements) => elements.map((element) => element.lastElementChild?.textContent ?? '')),
  };
}

test('the Workbench tab lists the project and shows src/a.ts read-only with line numbers; a protected row is never requested', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const contentRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/files/content')) contentRequests.push(request.url());
      });

      await page.goto(`${server.url}/w/${wsId}`);
      await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Workbench' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench$`));
      await expect(page.getByRole('heading', { name: 'Workbench', level: 1 })).toBeVisible();
      await expect(page.getByTestId('workbench-panel-files')).toHaveAttribute('aria-current', 'page');

      // The tree: folders first, the protected one with its lock.
      const tree = page.getByTestId('file-tree');
      await expect(tree.getByTestId('file-row-.git')).toHaveAttribute('data-protected', 'true');
      await expect(tree.getByTestId('file-row-README.md')).toBeVisible();

      // A protected row: the sentence, and no content request.
      await tree.getByTestId('file-row-.git').click();
      await expect(page.getByTestId('file-protected')).toHaveText("Protected. Ogden doesn't open this file.");
      expect(contentRequests).toEqual([]);

      // The file: open its folder, then select it.
      await tree.getByTestId('file-row-src').click();
      await tree.getByTestId('file-row-src/a.ts').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?path=src%2Fa\\.ts$`));
      await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts');
      await expect(page.getByTestId('code-line')).toHaveCount(5);
      expect(await shownLines(page)).toEqual({ numbers: ['1', '2', '3', '4', '5'], text: SOURCE.slice(0, -1).split('\n') });
      expect(contentRequests).toHaveLength(1);
      // Read-only: nothing to type into in the viewer.
      await expect(page.getByTestId('code-view').getByRole('textbox')).toHaveCount(0);
      await expectNoSidewaysScroll(page);

      // At phone width, after a reload (the selection is in the URL), the same lines and no sideways scroll.
      await page.setViewportSize({ width: 375, height: 740 });
      await page.reload();
      await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts');
      await expect(page.getByTestId('file-row-src/a.ts')).toHaveAttribute('aria-current', 'true');
      expect((await shownLines(page)).numbers).toEqual(['1', '2', '3', '4', '5']);
      await expectNoSidewaysScroll(page);
    },
    { files: { 'src/a.ts': SOURCE, 'README.md': '# Fixture\n', '.git/config': '[core]\n\tbare = false\n' } },
  );
});

const LONG = Array.from({ length: 60 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join('\n') + '\n';

test('README renders with Show source; a reply naming src/a.ts:12 links it, opening line 12 highlighted; .env masked, 2 MB and binary named; axe clean at 390px', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId } = await startChat(page, repo);

      // The reply names a file that exists, at a line, and one that doesn't.
      await send(page, 'reply-with Look at `src/a.ts:12` and src/missing.ts:3 for the bug.');
      const reply = page.getByTestId('message-agent').last();
      const link = reply.getByRole('link', { name: 'src/a.ts:12' });
      await expect(link).toHaveAttribute('title', 'Open src/a.ts at line 12');
      await expect(reply).toContainText('src/missing.ts:3');
      await expect(reply.getByRole('link')).toHaveCount(1);
      const href = new URL((await link.getAttribute('href'))!, server.url);
      expect(href.pathname).toBe(`/w/${wsId}/workbench`);
      expect(href.searchParams.get('path')).toBe('src/a.ts');
      expect(href.searchParams.get('line')).toBe('12');

      await link.click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?`));
      await expect(page.getByTestId('code-view-path')).toHaveText('src/a.ts');
      const target = page.locator('[data-testid="code-line"][data-line="12"]');
      await expect(target).toHaveAttribute('data-highlighted', 'true');
      await expect(target).toBeInViewport();
      await expect(page.locator('[data-testid="code-line"][data-highlighted="true"]')).toHaveCount(1);
      // Until the next click.
      await page.getByTestId('code-view-path').click();
      await expect(page.locator('[data-testid="code-line"][data-highlighted="true"]')).toHaveCount(0);

      // README.md: rendered, then its numbered source.
      await page.goto(`${server.url}/w/${wsId}/workbench?path=README.md`);
      const rendered = page.getByTestId('markdown-rendered');
      await expect(rendered.getByRole('heading', { name: 'Fixture' })).toBeVisible();
      await expect(rendered.locator('script, img')).toHaveCount(0);
      await expect(rendered.getByRole('link', { name: 'the source' })).toHaveAttribute('title', 'Open src/a.ts at line 3');
      await expect(rendered.getByRole('link', { name: 'docs' })).toHaveAttribute('target', '_blank');
      await expect(rendered).toContainText('escape');
      await expect(rendered.getByRole('link', { name: 'escape' })).toHaveCount(0);
      await page.getByTestId('markdown-mode-source').click();
      await expect(page.getByTestId('code-line-number').first()).toHaveText('1');
      await expect(page.getByTestId('code-lines')).toContainText('# Fixture');
      await page.getByTestId('markdown-mode-rendered').click();

      // .env masked, the 2 MB file capped, the binary named with its size.
      await page.goto(`${server.url}/w/${wsId}/workbench?path=.env`);
      await expect(page.getByTestId('file-masked')).toBeVisible();
      await expect(page.getByTestId('code-lines')).not.toContainText('E2E_ENV_SECRET_8c1d');
      await page.goto(`${server.url}/w/${wsId}/workbench?path=big.log`);
      await expect(page.getByTestId('file-too-large')).toHaveText('This file is too large to show here (2 MB, limit 1 MB).');
      await page.goto(`${server.url}/w/${wsId}/workbench?path=logo.png`);
      await expect(page.getByTestId('file-binary')).toHaveText("Binary file. Ogden doesn't show its contents.");
      await expect(page.getByTestId('file-size')).toHaveText('16 bytes');

      // Axe on the viewer, and a phone width with no sideways scroll, on the rendered README and the linked line.
      await page.setViewportSize({ width: 390, height: 844 });
      for (const at of ['path=README.md', 'path=src%2Fa.ts&line=12']) {
        await page.goto(`${server.url}/w/${wsId}/workbench?${at}`);
        await expect(page.getByTestId('code-view-path')).toBeVisible();
        const axe = await new AxeBuilder({ page }).include('[data-testid="workbench-files"]').analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`), at).toEqual([]);
        await expectNoSidewaysScroll(page);
      }
    },
    {
      files: {
        'src/a.ts': LONG,
        'README.md': '# Fixture\n\nRead [the source](./src/a.ts#L3), the [docs](https://example.com/docs) and [escape](../../etc/passwd).\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n',
        '.env': 'API_TOKEN=E2E_ENV_SECRET_8c1d\n',
        'big.log': 'x'.repeat(2 * 1024 * 1024),
        'logo.png': 'PNG\u0000\u0000\u0000\u0000IHDR12345',
        '.git/config': '[core]\n',
      },
    },
  );
});

test('g s opens Search; a word is found in the tracked file and not the ignored one, and its result opens the viewer at its line; axe clean at 390px', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const wsId = await addProject(page, repo);
      const searches: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/files/search')) searches.push(request.url());
      });
      await page.goto(`${server.url}/w/${wsId}/workbench`);
      await expect(page.getByTestId('workbench-panel-files')).toHaveAttribute('aria-current', 'page');
      await page.locator('body').click();
      await page.keyboard.press('g');
      await page.keyboard.press('s');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?panel=search$`));
      await expect(page.getByTestId('workbench-panel-search')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('search-empty')).toHaveText('Search text or file names in this project.');

      const field = page.getByLabel('Search the project');
      await expect(field).toBeFocused();
      await field.pressSequentially('zebraword');
      const results = page.getByTestId('search-results');
      await expect(results.getByTestId('search-file')).toHaveCount(1);
      await expect(results.getByTestId('search-file-path')).toHaveText('src/a.ts');
      await expect(results).not.toContainText('dist/');
      // Typing replaced the history entry, and the search is in the address.
      await expect(page).toHaveURL(/q=zebraword/);
      const searchCount = searches.length;
      expect(searchCount).toBeGreaterThanOrEqual(1);
      expect(searchCount).toBeLessThanOrEqual(3);

      // Axe on the panel, and a phone width with no sideways scroll.
      await page.setViewportSize({ width: 390, height: 844 });
      const axe = await new AxeBuilder({ page }).include('[data-testid="workbench-search"]').analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
      await expectNoSidewaysScroll(page);

      // Enter on the result opens the viewer at the line, highlighted.
      await results.getByTestId('search-match').first().focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/workbench\\?path=src%2Fa\\.ts&line=3$`));
      await expect(page.locator('[data-testid="code-line"][data-line="3"]')).toHaveAttribute('data-highlighted', 'true');
      await expectNoSidewaysScroll(page);

      // File names: the ignored file isn't listed either.
      await page.goto(`${server.url}/w/${wsId}/workbench?panel=search&q=a.&mode=names`);
      await expect(page.getByTestId('search-name')).toHaveText(['src/a.ts']);
      // Regex, run by the bundled server's worker.
      await page.goto(`${server.url}/w/${wsId}/workbench?panel=search&q=${encodeURIComponent('zebra\\w+ =')}&regex=true`);
      await expect(page.getByTestId('search-match')).toHaveCount(1);
      await expect(page.getByTestId('search-file-path')).toHaveText('src/a.ts');
    },
    { files: { '.gitignore': 'dist/\n', 'src/a.ts': 'const a = 1;\n\nexport const zebraword = a;\n', 'dist/a.js': 'export const zebraword = 1;\n', '.git/config': '[core]\n' } },
  );
});
