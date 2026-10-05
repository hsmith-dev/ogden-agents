/// <reference lib="dom" />
/**
 * The "already uses BMad Method" offer in a real browser (story 10.3;
 * CAP-19, E10-R5): a project whose repo has `_bmad/` shows it on its chats
 * page, a plain repo doesn't; Choose features opens the project's BMad
 * Method settings; Not now hides it for good, across a reload; and
 * detecting, turning a piece on and turning it off leave every repo's file
 * tree exactly as it was. Repos are temp fixtures (`fake-bmad-repo.ts`).
 */
import { BMAD_OFFER_CHOOSE, BMAD_OFFER_NOT_NOW, BMAD_OFFER_TEXT, WORKSPACE_SETTINGS_BMAD_ANCHOR, type BmadPiece } from '../../packages/shared/src/bmad.ts';
import { expect, test, type Page } from '@playwright/test';
import { createFakeBmadRepo, type FakeBmadRepo } from '../fixtures/fake-bmad-repo.ts';
import { API_ROUTES } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

/** Planning registered as shipped for this test, so a piece can be turned on and off (story 10.2). */
const AVAILABLE: readonly BmadPiece[] = ['planning'];

/** Adds the project at `path` through the REST API with the tab's own token; its id. */
async function addProject(page: Page, path: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** Opens the project's chats page and waits until its detection has been answered (and rendered). */
async function openChats(page: Page, origin: string, wsId: string): Promise<void> {
  const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${wsId}/bmad/detection`) && response.request().method() === 'GET');
  await page.goto(`${origin}/w/${wsId}`);
  expect((await detected).status()).toBe(200);
  await expect(page.getByTestId('workspace-name')).toBeVisible();
}

test('offered only where the repo has _bmad/; Choose features opens settings; Not now is kept; no repo file changes', async ({ page }) => {
  const repos: FakeBmadRepo[] = [];
  const fixture = (options: Parameters<typeof createFakeBmadRepo>[0]) => {
    const repo = createFakeBmadRepo(options);
    repos.push(repo);
    return repo;
  };
  try {
    const chosen = fixture({ output: true, files: { '.claude/skills/mine/SKILL.md': '# mine\n' } });
    const plain = fixture({ bmad: false });
    const declined = fixture({});
    const before = repos.map((repo) => repo.hash());

    await withChatServer(
      page,
      async ({ server }) => {
        const origin = server.url;
        const chosenId = await addProject(page, chosen.path);
        const plainId = await addProject(page, plain.path);
        const declinedId = await addProject(page, declined.path);
        const offer = page.getByTestId('bmad-offer');

        // A plain repo: no offer.
        await openChats(page, origin, plainId);
        await expect(offer).toHaveCount(0);

        // A repo with _bmad/: the offer, and Choose features opens the BMad Method settings.
        await openChats(page, origin, chosenId);
        await expect(offer).toContainText(BMAD_OFFER_TEXT);
        await expect(offer.getByRole('button', { name: BMAD_OFFER_NOT_NOW })).toBeVisible();
        await offer.getByRole('link', { name: BMAD_OFFER_CHOOSE }).click();
        await expect(page).toHaveURL((url) => url.pathname === `/w/${chosenId}/settings` && url.hash === `#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`);
        expect(page.url().endsWith(`#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`)).toBe(true);

        // A piece on hides the offer; turned off again, the offer is back (nothing was answered).
        const planning = page.getByRole('switch', { name: 'Planning' });
        await expect(planning).toHaveAttribute('aria-checked', 'false');
        await planning.click();
        await expect(planning).toHaveAttribute('aria-checked', 'true');
        await openChats(page, origin, chosenId);
        await expect(offer).toHaveCount(0);
        await page.goto(`${origin}/w/${chosenId}/settings`);
        await planning.click();
        await expect(planning).toHaveAttribute('aria-checked', 'false');
        await openChats(page, origin, chosenId);
        await expect(offer).toBeVisible();

        // Not now hides it at once, and for good: not after a reload either.
        await openChats(page, origin, declinedId);
        await expect(offer).toBeVisible();
        const answered = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${declinedId}/bmad/offer`) && response.request().method() === 'DELETE');
        await offer.getByRole('button', { name: BMAD_OFFER_NOT_NOW }).click();
        await expect(offer).toHaveCount(0);
        expect((await answered).status()).toBe(204);
        const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${declinedId}/bmad/detection`));
        await page.reload();
        expect((await detected).status()).toBe(200);
        await expect(page.getByTestId('workspace-name')).toBeVisible();
        await expect(offer).toHaveCount(0);
        // The other project's offer is its own.
        await openChats(page, origin, chosenId);
        await expect(offer).toBeVisible();
      },
      { extra: { availableBmadPieces: AVAILABLE } },
    );

    expect(repos.map((repo) => repo.hash())).toEqual(before);
  } finally {
    for (const repo of repos) repo.remove();
  }
});
