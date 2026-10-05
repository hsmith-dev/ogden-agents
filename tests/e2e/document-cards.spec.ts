/// <reference lib="dom" />
/**
 * Document cards and the next suggested step in a real browser (story 4.7,
 * E4-R6), on the real read-only catalog (4.4's label mapping) with
 * `stubSetupCatalog`'s setup status (the output folder `_bmad-output`) and
 * the fake ACP agent: a planning session on the spec skill whose agent
 * writes a spec into the output folder shows one document card with Open
 * and "Turn this spec into tickets"; Open shows the spec in a side sheet
 * (rendered, its frontmatter hidden) and Esc closes it with focus back on
 * Open; the card survives a reload; the button opens a new planning
 * session whose first message names the document. A write outside the
 * output folder, and the same write in a plain chat, show no card. No real
 * `claude` or `uv` runs. The skills are the server's verified pinned copy's
 * (entry 4.12: only those get labels and next steps).
 */
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, verifiedCopySource } from '../support.js';
import { send, withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const SKILL = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

/** BMad Method's `_bmad/` as a set-up project has it. */
const SET_UP = { '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n' };

/** A module record as BMad Method's installer leaves it, with a `SKILL.md` per skill it lists (the `plan-and-board.spec.ts` pattern). */
function moduleFiles(code: string, skills: readonly [name: string, description: string][]): Record<string, string> {
  const files: Record<string, string> = {
    [`.claude/skills/bmod-${code}/bmod.toml`]: `[bmod]\ncode = "${code}"\nversion = "7.0.0"\nskills = [${skills.map(([name]) => `"${name}"`).join(', ')}]\n`,
    [`.claude/skills/bmod-${code}/SKILL.md`]: SKILL(`bmod-${code}`, `The ${code} module.`),
  };
  for (const [name, description] of skills) files[`.claude/skills/${name}/SKILL.md`] = SKILL(name, description);
  return files;
}

/** The project at `repo`, opened through the REST API with the connected tab's token. */
async function openProject(page: import('@playwright/test').Page, repo: string) {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${await response.text()}`);
    return response.json() as Promise<Record<string, { id: string }>>;
  };
  const wsId = (await call('POST', API_ROUTES.workspaces, { path: repo })).workspace!.id;
  return { wsId, call };
}

/** The project's skills: a module record and the spec and ticket skills. */
const SKILL_FILES = moduleFiles('method', [
  ['bmad-spec', 'Spec from SKILL.md.'],
  ['bmad-ticket', 'Tickets from SKILL.md.'],
]);

const SPEC = '_bmad-output/specs/spec-x.md';
const NEXT_LABEL = 'Turn this spec into tickets';

test('a planning session that writes a spec shows one document card with Open and the next step, which survives a reload and starts the next session on the document', async ({ page }) => {
  const verified = await verifiedCopySource(SKILL_FILES);
  try {
    await withChatServer(
      page,
      async ({ server, repo }) => {
        const { wsId, call } = await openProject(page, repo);
        await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning'] });
        const sesId = (await call('POST', apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), { skill: 'bmad-spec' })).session!.id;
        await page.goto(`${server.url}/w/${wsId}/s/${sesId}`);
        await expect(page.getByTestId('message-agent')).toContainText('command=/bmad-spec');
        await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

        // A write outside the output folder: no card.
        await send(page, 'write-doc src/notes.md');
        await expect(page.getByTestId('message-agent').last()).toHaveText(/Wrote src\/notes\.md\./);

        // The spec, written twice: one card.
        await send(page, `write-doc ${SPEC}`);
        await expect(page.getByTestId('message-agent').last()).toHaveText(/Wrote _bmad-output\/specs\/spec-x\.md\./);
        await send(page, `write-doc ${SPEC}`);
        await expect(page.getByTestId('message-agent')).toHaveCount(4);
        const card = page.getByRole('region', { name: 'Document spec-x.md' });
        await expect(card).toBeVisible();
        await expect(page.getByTestId('document-card')).toHaveCount(1);
        await expect(card.getByTestId('document-card-path')).toHaveText(SPEC);
        await expect(card.getByRole('button', { name: 'Open' })).toBeVisible();
        await expect(card.getByRole('button', { name: NEXT_LABEL })).toBeVisible();

        // Open: the spec in a side sheet, rendered, its frontmatter hidden; Esc closes it and focus returns to Open.
        await card.getByRole('button', { name: 'Open' }).click();
        const sheet = page.getByRole('dialog', { name: 'spec-x.md' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('heading', { name: 'Written by the fake agent' })).toBeVisible();
        await expect(sheet.locator('strong')).toHaveText('small');
        await expect(sheet.getByTestId('document-sheet-content')).not.toContainText('title:');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(card.getByRole('button', { name: 'Open' })).toBeFocused();

        // The card survives a reload.
        await page.reload();
        await expect(page.getByTestId('document-card')).toHaveCount(1);
        await expect(page.getByRole('region', { name: 'Document spec-x.md' }).getByRole('button', { name: NEXT_LABEL })).toBeVisible();

        // The next step: a new planning session whose first message names the document.
        await page.getByRole('button', { name: NEXT_LABEL }).click();
        await expect(page).not.toHaveURL(new RegExp(`/s/${sesId}$`));
        await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
        await expect(page.getByTestId('message-user').first()).toHaveText(`/bmad-ticket ${SPEC}`);
        await expect(page.getByTestId('message-agent')).toContainText(`command=/bmad-ticket ${SPEC} primed=0`);

        // A plain chat writing into the output folder: no card.
        const chatId = (await call('POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { kind: 'chat' })).session!.id;
        await page.goto(`${server.url}/w/${wsId}/s/${chatId}`);
        await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
        await send(page, 'write-doc _bmad-output/specs/spec-chat.md');
        await expect(page.getByTestId('message-agent').last()).toHaveText(/Wrote _bmad-output\/specs\/spec-chat\.md\./);
        await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
        await page.reload();
        await expect(page.getByTestId('message-agent')).toHaveCount(1);
        await expect(page.getByTestId('document-card')).toHaveCount(0);
      },
      { files: { ...SET_UP, ...SKILL_FILES }, extra: { bmadSource: verified.source } },
    );
  } finally {
    verified.remove();
  }
});
