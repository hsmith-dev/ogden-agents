/// <reference lib="dom" />
/**
 * Plan and Board in a real browser (story 4.1, epic 4's tracer): with
 * Planning and Board on, the project's tabs show both; the Plan page lists
 * the repo's installed skills and Start opens the planning session, where
 * the fake agent answers the skill's invocation; the Board page lists the
 * tickets a stub ticket store reports. With Planning off and Board on, only
 * the Board tab shows. No real `claude` or `uv` runs.
 */
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const SKILL = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

/** A ticket store that answers two tickets, without `uv` or `tickets.py` (the server test runs the real one). */
const ticketStore = {
  status: async () => ({
    tickets: [
      { ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
      { ref: '1.2', id: 2, epic: 'epic-first', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '' },
    ],
    problems: [],
  }),
};

test('Plan Start opens the planning session, and Board lists the tickets', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const origin = new URL(page.url()).origin;
      const token = await storedToken(page);
      const call = async (method: string, path: string, body: unknown) => {
        const response = await fetch(`${origin}${path}`, {
          method,
          headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${await response.text()}`);
        return response.json() as Promise<{ workspace: { id: string } }>;
      };
      const wsId = (await call('POST', API_ROUTES.workspaces, { path: repo })).workspace.id;
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning', 'board'] });

      await page.goto(`${server.url}/w/${wsId}`);
      await expect(page.getByTestId('workspace-tab-plan')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-board')).toBeVisible();

      await page.getByTestId('workspace-tab-plan').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/plan$`));
      await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
      await expect(page.getByTestId('skill-row')).toHaveCount(2);
      await page.getByRole('button', { name: 'Start bmad-spec' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      await expect(page.getByTestId('message-user')).toHaveText('/bmad-spec');
      await expect(page.getByTestId('message-agent')).toContainText('command=/bmad-spec primed=0');

      await page.getByTestId('workspace-tab-board').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));
      await expect(page.getByRole('heading', { name: 'Board', level: 1 })).toBeVisible();
      const rows = page.getByTestId('ticket-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('1.1');
      await expect(rows.nth(0)).toContainText('Build the first thing');
      await expect(rows.nth(0).getByTestId('ticket-state')).toHaveText('review');
      await expect(rows.nth(1).getByTestId('ticket-state')).toHaveText('planned');

      // Planning off, Board on: only Board's tab shows, and Plan's page refuses.
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await page.goto(`${server.url}/w/${wsId}`);
      await expect(page.getByTestId('workspace-tab-board')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-plan')).toHaveCount(0);
      await page.goto(`${server.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('plan-error')).toContainText('off in this project');
    },
    {
      extra: { availableBmadPieces: ['planning', 'board'], ticketStore },
      files: {
        '.claude/skills/bmad-spec/SKILL.md': SKILL('bmad-spec', 'Condense any input into a short spec.'),
        '.claude/skills/bmad-ticket/SKILL.md': SKILL('bmad-ticket', 'Create and manage tickets.'),
      },
    },
  );
});
