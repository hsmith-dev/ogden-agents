/// <reference lib="dom" />
/**
 * Plan and Board in a real browser (story 4.1, epic 4's tracer): with
 * Planning and Board on, the project's tabs show both; the Plan page lists
 * the repo's installed skills and Start opens the planning session, where
 * the fake agent answers the skill's invocation; the Board page lists the
 * tickets a stub ticket store reports. With Planning off and Board on, only
 * the Board tab shows. Story 4.2: an untrusted project's Board shows the
 * trust prompt, and Allow trusts it and shows the tickets; turning Board on
 * in the settings opens the trust dialog first. Story 4.14: a Board with the
 * pinned BMad Method not downloaded offers Download BMad Method, and after it
 * the tickets show (an in-memory source: nothing is downloaded). No real
 * `claude` or `uv` runs.
 */
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const SKILL = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

/** The trust prompt's and dialog's title says what runs (`SCRIPT_TRUST_TITLE`; `planning.ts` has imports this runner can't load). */
const TRUST_TITLE = /Run this project's BMad Method scripts\?/;

/** The fields story 4.2 added to a ticket row, as `tickets.py status` gives them for a repo-store entry. */
const ROW = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' };
/** Two tickets as `tickets.py status` reports them. */
const TICKETS = [
  { ...ROW, ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
  { ...ROW, ref: '1.2', id: 2, epic: 'epic-first', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '' },
];

/**
 * A ticket store that answers two tickets, without `uv` or `tickets.py` (the
 * server test runs the real one), and counts its reads: the trust check
 * must keep an untrusted project's reads at zero.
 */
function stubTicketStore() {
  const store = {
    reads: 0,
    tree: async () => {
      store.reads++;
      return { tickets: TICKETS.map((ticket) => ({ ...ticket })), problems: [], folder: 'initiative-demo', epics: [] };
    },
    find: () => Promise.reject(new Error('not used in this test')),
    mark: () => Promise.reject(new Error('not used in this test')),
    watch: () => Promise.reject(new Error('not used in this test')),
  };
  return store;
}

test('Plan Start opens the planning session, and Board asks for trust, then to download BMad Method, then lists the tickets', async ({ page }) => {
  const ticketStore = stubTicketStore();
  const bmadSource = (await serverModule()).createMemoryBmadSource({ delayMs: 200 });
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
      // Story 4.2: the project's BMad Method scripts aren't trusted yet, so nothing ran and the prompt asks.
      await expect(page.getByTestId('script-trust-prompt')).toContainText(TRUST_TITLE);
      expect(ticketStore.reads).toBe(0);
      await page.getByTestId('script-trust-allow').click();
      // Story 4.14: trusted, but the pinned BMad Method isn't downloaded yet, so still nothing ran.
      await expect(page.getByTestId('bmad-download-prompt')).toBeVisible();
      expect(ticketStore.reads).toBe(0);
      expect(bmadSource.downloads).toBe(0);
      await page.getByTestId('bmad-download').click();
      await expect(page.getByTestId('bmad-downloading')).toBeVisible();
      const rows = page.getByTestId('ticket-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('1.1');
      await expect(rows.nth(0)).toContainText('Build the first thing');
      await expect(rows.nth(0).getByTestId('ticket-state')).toHaveText('review');
      await expect(rows.nth(1).getByTestId('ticket-state')).toHaveText('planned');
      await expect(page.getByTestId('bmad-download-prompt')).toHaveCount(0);
      expect(bmadSource.downloads).toBe(1);

      // Planning off, Board on: only Board's tab shows, and Plan's page refuses.
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await page.goto(`${server.url}/w/${wsId}`);
      await expect(page.getByTestId('workspace-tab-board')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-plan')).toHaveCount(0);
      await page.goto(`${server.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('plan-error')).toContainText('off in this project');
    },
    {
      extra: { ticketStore, bmadSource },
      files: {
        '.claude/skills/bmad-spec/SKILL.md': SKILL('bmad-spec', 'Condense any input into a short spec.'),
        '.claude/skills/bmad-ticket/SKILL.md': SKILL('bmad-ticket', 'Create and manage tickets.'),
      },
    },
  );
});

test('turning Board on in the settings asks for the trust first: Cancel changes nothing, Allow turns it on', async ({ page }) => {
  const ticketStore = stubTicketStore();
  // Already downloaded (story 4.14): this test is about the trust.
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const origin = new URL(page.url()).origin;
      const token = await storedToken(page);
      const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ path: repo }),
      });
      const wsId = ((await response.json()) as { workspace: { id: string } }).workspace.id;

      await page.goto(`${server.url}/w/${wsId}/settings`);
      const board = page.getByRole('switch', { name: 'Board', exact: true });
      await expect(board).toHaveAttribute('aria-checked', 'false');
      await board.click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(TRUST_TITLE);
      await page.getByTestId('script-trust-cancel').click();
      await expect(dialog).toHaveCount(0);
      await expect(board).toHaveAttribute('aria-checked', 'false');

      await board.click();
      await page.getByTestId('script-trust-confirm').click();
      await expect(dialog).toHaveCount(0);
      await expect(board).toHaveAttribute('aria-checked', 'true');

      // Trusted once for the project: the Board lists the tickets with no prompt.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('ticket-row')).toHaveCount(2);
      await expect(page.getByTestId('script-trust-prompt')).toHaveCount(0);
    },
    { extra: { ticketStore, bmadSource } },
  );
});
