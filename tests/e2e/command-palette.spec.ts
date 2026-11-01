/// <reference lib="dom" />
/**
 * The command palette in a real browser (epic 26, story 26.3): Cmd/Ctrl+K in
 * the composer opens it with the field focused, and Esc closes it with focus
 * back in the composer; axe finds nothing on the open palette. A chat in
 * another project is found by a word of its title and opened; New chat opens
 * the draft with the composer focused; Show every step switches the chat's
 * detail level, and the palette then offers Show less detail. With the Board
 * on (a stub ticket store, the project trusted), a ticket is found by its ref
 * and opens on the Board. Outside a project, `g n` opens the palette on "New
 * chat in...", whose Enter opens that project's draft. At 390px the open
 * palette fits the viewport (a screenshot under `test-results/`). Each test
 * runs its own server with the fake agent.
 */
import AxeBuilder from '@axe-core/playwright';
import { basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { composer, send, startChat, withChatServer } from './chat-server.js';
import { sidebarOf, storedToken } from './tab.js';

/** The detail level's storage key (`CHAT_DETAIL_KEY`, packages/web/src/chat/detail-level.ts). */
const CHAT_DETAIL_KEY = 'ogden-agents.chat-detail.v1';

const palette = (page: Page) => page.getByTestId('command-palette');
const field = (page: Page) => page.getByRole('combobox');
const option = (page: Page, name: string | RegExp) => palette(page).getByRole('option', { name });

/** Takes the cursor out of every field, so a single-letter shortcut counts. */
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

async function openPalette(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
}

/** Opens the project at `path` through the REST API with the page's tab token; returns its id and a caller. */
async function openProject(page: Page, path: string) {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${origin}${route}`, {
      method,
      headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${route} returned ${response.status}: ${await response.text()}`);
    return response.json() as Promise<{ workspace: { id: string } }>;
  };
  const wsId = (await call('POST', API_ROUTES.workspaces, { path })).workspace.id;
  return { wsId, call };
}

test('Cmd/Ctrl+K from the composer: Esc returns focus; a chat in another project opens; New chat and Show every step run; axe finds nothing', async ({ page }) => {
  await withChatServer(page, async ({ repo, tempFolder }) => {
    // Project B's chat, named by its first message.
    const otherRepo = tempFolder('ogden-agents-e2e-repo-');
    const other = await startChat(page, otherRepo);
    await send(page, 'Check the invoice totals');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check the invoice totals');
    const chat = await startChat(page, repo);

    // From the composer, and back to it.
    await composer(page).focus();
    await openPalette(page);
    await expect(palette(page).getByRole('group', { name: 'Actions' })).toBeVisible();
    await expect(palette(page).getByRole('group', { name: 'Projects' })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('[data-slot="command-palette"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(composer(page)).toBeFocused();

    // Cmd/Ctrl+K again toggles it closed.
    await openPalette(page);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette(page)).toHaveCount(0);
    await expect(composer(page)).toBeFocused();

    // Show every step: the chat's level switches, and next time the palette offers the other one.
    await openPalette(page);
    await field(page).fill('every step');
    await expect(option(page, 'Show every step')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    expect(await page.evaluate((key) => localStorage.getItem(key), CHAT_DETAIL_KEY)).toContain(chat.sesId);
    await openPalette(page);
    await field(page).fill('detail');
    await expect(option(page, 'Show less detail')).toBeVisible();
    await page.keyboard.press('Escape');

    // A chat in the other project by a word of its title.
    await openPalette(page);
    await field(page).fill('invoice');
    const chats = palette(page).getByRole('group', { name: 'Chats' });
    await expect(chats.getByRole('option')).toHaveCount(1);
    await expect(chats.getByRole('option')).toContainText('Check the invoice totals');
    await expect(chats.getByRole('option')).toContainText(basename(otherRepo));
    await expect(page.getByTestId('command-palette-status')).toHaveText(/\d+ results?/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${other.wsId}/s/${other.sesId}$`));
    await expect(palette(page)).toHaveCount(0);

    // Recent chats on the empty query: the last opened first.
    await blur(page);
    await openPalette(page);
    await expect(palette(page).getByRole('group', { name: 'Recent chats' }).getByRole('option').first()).toContainText('Check the invoice totals');

    // No match.
    await field(page).fill('zzzz');
    await expect(page.getByTestId('command-palette-empty')).toHaveText('Nothing matches “zzzz”.');
    await expect(field(page)).toHaveAttribute('aria-expanded', 'false');
    const emptyAxe = await new AxeBuilder({ page }).include('[data-slot="command-palette"]').analyze();
    expect(emptyAxe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);

    // New chat in this project.
    await field(page).fill('new chat');
    await expect(option(page, 'New chat').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${other.wsId}/new$`));
    await expect(composer(page)).toBeFocused();
  });
});

test('with the Board on, a ticket found by its ref opens on the Board', async ({ page }) => {
  const ticketStore = {
    reads: 0,
    tree: async () => {
      ticketStore.reads++;
      const row = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '', type: 'story', status: '', state: 'planned', blocked_reason: '', epic: 'epic-first' };
      return {
        tickets: [
          { ...row, ref: '1.1', id: 1, title: 'Build the first thing' },
          { ...row, ref: '1.2', id: 2, title: 'Build the second thing' },
        ],
        problems: [],
        folder: 'initiative-demo',
        epics: [],
      };
    },
    find: () => Promise.reject(new Error('not used in this test')),
    mark: () => Promise.reject(new Error('not used in this test')),
    watch: async () => ({ close() {} }),
  };
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));
      await page.goto(`${server.url}/w/${wsId}`);
      await expect(page.getByTestId('workspace-tab-board')).toBeVisible();
      expect(ticketStore.reads).toBe(0);

      await openPalette(page);
      await field(page).fill('1.2');
      const tickets = palette(page).getByRole('group', { name: 'Tickets' });
      await expect(tickets.getByRole('option')).toHaveText(['1.2 Build the second thing']);
      await tickets.getByRole('option').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board/1\\.2$`));
      await expect(palette(page)).toHaveCount(0);
    },
    { extra: { ticketStore, bmadSource }, files: { '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n' } },
  );
});

test('g n on home opens the palette on "New chat in...", and Enter opens that project draft; at 390px it fits', async ({ page }, testInfo) => {
  await withChatServer(page, async ({ server, repo }) => {
    const { wsId } = await openProject(page, repo);
    await page.goto(`${server.url}/`);
    await expect(page.getByTestId('workspace-area')).toBeVisible();
    await expect(sidebarOf(page)).toContainText(basename(repo));
    await blur(page);
    await page.keyboard.press('g');
    await page.keyboard.press('n');
    await expect(palette(page)).toHaveAttribute('data-mode', 'new-chat-in');
    await expect(palette(page)).toContainText('New chat in...');
    await expect(field(page)).toBeFocused();
    await expect(option(page, basename(repo))).toBeVisible();

    // Backspace on the empty field: back to everything; the action goes there again.
    await page.keyboard.press('Backspace');
    await expect(palette(page)).toHaveAttribute('data-mode', 'all');
    await field(page).fill('new chat in');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toHaveAttribute('data-mode', 'new-chat-in');

    // 390px: the field and rows inside the viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = await palette(page).boundingBox();
    const input = await field(page).boundingBox();
    const row = await option(page, basename(repo)).boundingBox();
    for (const box of [panel, input, row]) {
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    }
    await testInfo.attach('command-palette-390', { body: await page.screenshot({ path: 'test-results/command-palette-390.png' }), contentType: 'image/png' });

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/new$`));
    await expect(composer(page)).toBeFocused();
  });
});
