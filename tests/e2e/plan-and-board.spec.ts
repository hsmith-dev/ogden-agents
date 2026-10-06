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
 * the tickets show (an in-memory source: nothing is downloaded). Story 4.3: a project
 * without `_bmad/` shows the setup panel on Plan, whose Set up shows each
 * step and then "Ready to plan."; turning Planning on in the settings starts
 * the setup and shows its progress inline; a failed setup says why in plain
 * words and a chat still opens. Setup is `stubSetupCatalog`'s, on the
 * real read-only catalog. Story 4.6: on catalog-memory, the Plan home
 * shows the tabs and their `g` shortcuts with Planning and Board on and
 * neither Plan nor `g p` with Planning off, the groups in order, no skill
 * names until Developer mode is on, a New tag on a recent module, and an
 * idea with Enter opens a planning session on the entry action whose first
 * message carries the idea. On the real catalog (story 4.4), the Plan home
 * shows the label mapping's labels and groups, Start from an idea uses the
 * mapping's entry action, and a module copied in while the server runs shows
 * on the next visit with the New tag (the modules there at the first read
 * don't carry it); the mapped skills are the server's verified pinned
 * copy's (entry 4.12: only those get labels). Story 4.9: against the in-memory ticket store, the
 * board puts each card in its column, shows "Waits for 1.2" and the blocked
 * reason, highlights a card its `ticket.changed` names, opens the detail
 * sheet from a card and from its URL (Esc returns to the card), and below
 * `md` stacks each epic's columns. Story 4.10: a keyboard-only user moves
 * 1.2 to Ready from its card's menu (Tab, Enter, ArrowDown, Enter): the card
 * sits in Ready with focus on it, and the menu never shows Done; the sheet's
 * menu changes a status too; a store that fails shows its message. No real
 * `claude` or `uv` runs.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, serverModule, stubSetupCatalog, verifiedCopySource, waitUntil } from '../support.js';
import { startChat, withChatServer } from './chat-server.js';
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
    // The server's ticket watcher calls it once BMad Method's setup names an output folder (entry 4.3's status);
    // a no-op watch keeps it harmless here.
    watch: async () => ({ close() {} }),
  };
  return store;
}

/** BMad Method's `_bmad/` as a set-up project has it (the tests before 4.3 open Plan and Board in one). */
const SET_UP = { '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n' };

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
      // On the real catalog with the pinned BMad Method not downloaded yet, no skill is verified (entry 4.12):
      // each shows its own SKILL.md description, and still starts.
      await expect(page.getByTestId('skill-text')).toHaveText(['Condense any input into a short spec.', 'Create and manage tickets.']);
      await page.getByRole('button', { name: 'Start Condense any input into a short spec.' }).click();
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
      // Story 4.9: the tickets are cards in their status columns.
      const cards = page.getByTestId('ticket-card');
      await expect(cards).toHaveCount(2);
      const first = page.locator('[data-testid="ticket-card"][data-ref="1.1"]');
      await expect(first).toContainText('Build the first thing');
      await expect(first).toHaveAttribute('data-column', 'in_review');
      await expect(page.locator('[data-testid="ticket-card"][data-ref="1.2"]')).toHaveAttribute('data-column', 'draft');
      await expect(page.getByTestId('bmad-download-prompt')).toHaveCount(0);
      expect(bmadSource.downloads).toBe(1);

      // Planning off, Board on: only Board's tab shows, and Plan's page says the feature is off (story 4.6).
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await page.goto(`${server.url}/w/${wsId}`);
      await expect(page.getByTestId('workspace-tab-board')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-plan')).toHaveCount(0);
      await page.goto(`${server.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('plan-feature-off')).toContainText('off in this project');
      await expect(page.getByTestId('bmad-setup-panel')).toHaveCount(0);
    },
    {
      extra: { ticketStore, bmadSource },
      files: {
        ...SET_UP,
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
      // Shown at once; enabled again once the save landed (leaving before that aborts it).
      await expect(board).toBeEnabled();

      // Trusted once for the project: the Board lists the tickets with no prompt.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('ticket-card')).toHaveCount(2);
      await expect(page.getByTestId('script-trust-prompt')).toHaveCount(0);
    },
    { extra: { ticketStore, bmadSource }, files: SET_UP },
  );
});

/** Opens the project at `repo` through the REST API with the page's tab token; returns its id and a caller for more requests. */
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
    return response.json() as Promise<{ workspace: { id: string } }>;
  };
  const wsId = (await call('POST', API_ROUTES.workspaces, { path: repo })).workspace.id;
  return { wsId, call };
}

test('a project without _bmad/: Plan shows the setup panel, and Set up downloads BMad Method, shows each step, then Ready to plan.', async ({ page }) => {
  const bmadSource = (await serverModule()).createMemoryBmadSource();
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning'] });
      await page.goto(`${server.url}/w/${wsId}/plan`);
      const panel = page.getByTestId('bmad-setup-panel');
      await expect(panel).toContainText("BMad Method isn't set up in this project yet.");
      await expect(page.getByTestId('skill-list')).toHaveCount(0);
      expect(bmadSource.downloads).toBe(0);
      await page.getByTestId('bmad-set-up').click();
      const steps = page.getByTestId('bmad-setup-step');
      await expect(steps).toHaveCount(4);
      await expect(steps.nth(0)).toContainText('Checking the project');
      await expect(page.locator('[data-testid="bmad-setup-step"][data-state="current"]')).toHaveCount(1);
      await expect(page.getByTestId('bmad-setup-done')).toHaveText('Ready to plan.');
      // Set up now: the panel gives way to the page. The user's Set up downloaded the pinned copy, once (S1).
      await expect(page.getByTestId('bmad-setup-panel')).toHaveCount(0);
      expect(bmadSource.downloads).toBe(1);
    },
    { extra: { bmadSource } },
  );
});

test('turning Planning on in the settings sets BMad Method up, showing the progress inline, then Ready to plan.', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId } = await openProject(page, repo);
      await page.goto(`${server.url}/w/${wsId}/settings`);
      const planning = page.getByRole('switch', { name: 'Planning', exact: true });
      await planning.click();
      await expect(planning).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('bmad-setup-steps')).toBeVisible();
      await expect(page.getByTestId('bmad-setup-done')).toHaveText('Ready to plan.');
    },
  );
});

test('a failed setup says why in plain words, with no path, and a chat still opens', async ({ page }) => {
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId } = await openProject(page, repo);
      await page.goto(`${server.url}/w/${wsId}/settings`);
      await page.getByRole('switch', { name: 'Planning', exact: true }).click();
      const failed = page.getByTestId('bmad-setup-failed');
      await expect(failed).toContainText("Ogden Agents couldn't set up BMad Method in this project. Try again.");
      await expect(failed).not.toContainText(repo);
      await expect(page.getByTestId('bmad-set-up-again')).toBeVisible();
      await startChat(page, repo);
    },
    { extra: { bmadCatalog: await stubSetupCatalog({ fail: true }) } },
  );
});

/**
 * A catalog port bound once the test knows its project folder: the memory
 * catalog is keyed by the project's real path, which `withChatServer` makes
 * after the server's options are set.
 */
function lateCatalog(initial: object) {
  let inner = initial as Record<string, unknown>;
  const port = new Proxy(
    {},
    {
      get: (_target, key) => {
        const value = inner[key as string];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inner) : value;
      },
    },
  ) as NonNullable<NonNullable<Parameters<typeof withChatServer>[2]>['extra']>['bmadCatalog'];
  return { port, bind: (catalog: object) => void (inner = catalog as Record<string, unknown>) };
}

test('the Plan home (story 4.6): tabs and g shortcuts, groups in order, names in Developer mode only, New, and an idea starts a planning session', async ({ page }) => {
  const { createMemoryBmadCatalog } = await serverModule();
  // Until bound, an empty memory catalog: no repo has BMad Method.
  const catalog = lateCatalog(createMemoryBmadCatalog());
  const day = 24 * 60 * 60 * 1000;
  const recent = new Date(Date.now() - 2 * day).toISOString();
  const older = new Date(Date.now() - 10 * day).toISOString();
  const idea = 'A booking page for my pottery classes';
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const real = realpathSync(repo);
      catalog.bind(
        createMemoryBmadCatalog(
          { [real]: { hasBmad: true, hasOutput: true } },
          {
            [real]: [
              { name: 'bmad-product-brief', description: 'Write a short brief for a product idea.', label: 'Write a product brief', group: 'planning', module: 'bmm', installedAt: older, next: null },
              { name: 'bmad-code-review', description: 'Several reviewers read the change.', label: 'Review the code', group: 'checking', module: 'fresh', installedAt: recent, next: null },
              { name: 'bmad-odd-one', description: 'A skill with no group.', label: null, group: null, module: null, installedAt: null, next: null },
            ],
          },
          { catalogs: { [real]: { entryAction: 'bmad-product-brief' } } },
        ),
      );
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning', 'board'] });

      // Planning and Board on: the tabs, and g b / g p / g c move between them.
      // (Chats focuses its composer, where g types; so the round starts on Plan and ends on Chats.)
      await page.goto(`${server.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('workspace-tabs').getByRole('link')).toHaveText(['Chats', 'Plan', 'Board']);
      await page.keyboard.press('g');
      await page.keyboard.press('b');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));
      // The shortcuts listen from the page's header: wait for the new page before the next keys (the URL changes first).
      await expect(page.getByRole('heading', { name: 'Board', level: 1 })).toBeVisible();
      await page.keyboard.press('g');
      await page.keyboard.press('p');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/plan$`));
      await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
      await page.keyboard.press('g');
      await page.keyboard.press('c');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}$`));
      await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
      await page.goto(`${server.url}/w/${wsId}/plan`);

      // The groups in the UX order, Other last; plain text, no skill names; New on the recent module only.
      const groups = page.getByTestId('plan-group');
      await expect(groups.locator('h2')).toHaveText(['Planning', 'Checking work', 'Other']);
      await expect(page.getByTestId('skill-text')).toHaveText(['Write a product brief', 'Review the code', 'A skill with no group.']);
      await expect(page.getByTestId('skill-name')).toHaveCount(0);
      await expect(page.getByTestId('workspace-plan-page')).not.toContainText('bmad-');
      await expect(page.getByTestId('skill-new')).toHaveCount(1);
      await expect(page.locator('[data-skill="bmad-code-review"]').getByTestId('skill-new')).toHaveText('New');

      // Developer mode on: each name in mono beside its text.
      await page.goto(`${server.url}/settings/appearance`);
      await page.getByRole('switch', { name: 'Developer mode' }).click();
      await expect(page.getByRole('switch', { name: 'Developer mode' })).toHaveAttribute('aria-checked', 'true');
      await page.goto(`${server.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('skill-name')).toHaveText(['bmad-product-brief', 'bmad-code-review', 'bmad-odd-one']);

      // An idea and Enter: a planning session on the entry action, its first message carrying the idea.
      const input = page.getByLabel('Your idea');
      await input.press('Enter');
      await expect(page.getByTestId('plan-idea-error')).toHaveText('Write your idea first.');
      await input.fill(idea);
      await input.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      await expect(page.getByTestId('message-user')).toHaveText(`/bmad-product-brief ${idea}`);
      await expect(page.getByTestId('message-agent')).toContainText(`command=/bmad-product-brief ${idea} primed=0`);
      // Typing "gp" in the composer types it; it opens nothing.
      const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
      await composer.click();
      await composer.pressSequentially('gp');
      await expect(composer).toHaveValue('gp');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));

      // Planning off: no Plan tab, and g p does nothing.
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('workspace-tabs').getByRole('link')).toHaveText(['Chats', 'Board', 'Terminals']);
      await page.keyboard.press('g');
      await page.keyboard.press('p');
      // A shortcut navigates in its own keydown; give a wrong one a moment to show, then check g p did nothing.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));
      await page.keyboard.press('g');
      await page.keyboard.press('c');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}$`));
    },
    { extra: { bmadCatalog: catalog.port } },
  );
});

/** A module record as BMad Method's installer leaves it (`bmod.toml` in its own skill folder), with a `SKILL.md` per skill it lists. */
function moduleFiles(code: string, skills: readonly [name: string, description: string][]): Record<string, string> {
  const files: Record<string, string> = {
    [`.claude/skills/bmod-${code}/bmod.toml`]: `[bmod]\ncode = "${code}"\nversion = "7.0.0"\nskills = [${skills.map(([name]) => `"${name}"`).join(', ')}]\n`,
    [`.claude/skills/bmod-${code}/SKILL.md`]: SKILL(`bmod-${code}`, `The ${code} module.`),
  };
  for (const [name, description] of skills) files[`.claude/skills/${name}/SKILL.md`] = SKILL(name, description);
  return files;
}

test('the Plan home on the real catalog (stories 4.4 and 4.6): mapped labels and groups, the mapped entry action, and New on a module copied in later', async ({ page }) => {
  const idea = 'A newsletter for my bakery';
  const method = moduleFiles('method', [
    ['bmad-product-brief', 'Brief from SKILL.md.'],
    ['bmad-code-review', 'Review from SKILL.md.'],
  ]);
  const coreTools = moduleFiles('core-tools', [['bmad-brainstorming', 'Brainstorm from SKILL.md.']]);
  // The pinned copy has the module copied in later too; the user's own skill isn't in it.
  const verified = await verifiedCopySource({ ...method, ...coreTools });
  try {
    await withChatServer(
      page,
      async ({ server, repo }) => {
        const { wsId, call } = await openProject(page, repo);
        await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning'] });

        // The first read is the baseline: the modules already installed carry no New tag.
        await page.goto(`${server.url}/w/${wsId}/plan`);
        await expect(page.getByTestId('plan-group').locator('h2')).toHaveText(['Planning', 'Checking work', 'Other']);
        await expect(page.getByTestId('skill-text')).toHaveText(['Describe your idea', 'Review code changes', 'My own skill.']);
        await expect(page.getByTestId('skill-new')).toHaveCount(0);

        // A module copied in while the server runs: shown on the next visit, with New on its skills only.
        for (const [path, content] of Object.entries(coreTools)) {
          const file = join(repo, ...path.split('/'));
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, content);
        }
        await page.goto(`${server.url}/w/${wsId}/plan`);
        await expect(page.getByTestId('plan-group').locator('h2')).toHaveText(['Planning', 'Checking work', 'Ideas and research', 'Other']);
        await expect(page.getByTestId('skill-new')).toHaveCount(1);
        await expect(page.locator('[data-skill="bmad-brainstorming"]').getByTestId('skill-new')).toHaveText('New');

        // Start from an idea runs the mapping's entry action with the idea (exact: "Start Describe your idea" also has the words).
        const input = page.getByLabel('Your idea', { exact: true });
        await input.fill(idea);
        await input.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
        await expect(page.getByTestId('message-user')).toHaveText(`/bmad-product-brief ${idea}`);
        await expect(page.getByTestId('message-agent')).toContainText(`command=/bmad-product-brief ${idea} primed=0`);
      },
      {
        files: { ...SET_UP, ...method, '.claude/skills/my-own/SKILL.md': SKILL('my-own', 'My own skill.') },
        extra: { bmadSource: verified.source },
      },
    );
  } finally {
    verified.remove();
  }
});

/** Four tickets of one epic for the in-memory store: in review, planned, ready but waiting for 1.2, and blocked. */
const BOARD_TICKETS = [
  { ...ROW, ref: '1.1', id: 1, epic: 'epic-planning-and-board', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
  { ...ROW, ref: '1.2', id: 2, epic: 'epic-planning-and-board', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '' },
  { ...ROW, ref: '1.3', id: 3, epic: 'epic-planning-and-board', title: 'Build the third thing', type: 'story', status: 'ready-for-dev', state: 'backlog', blocked_reason: '', after: [2] },
  {
    ...ROW,
    ref: '1.4',
    id: 4,
    epic: 'epic-planning-and-board',
    title: 'Build the fourth thing',
    type: 'story',
    status: 'blocked',
    state: 'in-progress',
    blocked_reason: 'Needs the payment key',
    blocked_at: '2026-10-01',
  },
];

test('the board: cards in their columns, Waits for and the blocked reason, a live change highlights, the detail sheet, and stacked columns below md', async ({ page }) => {
  const server = await serverModule();
  // The project folder is made by withChatServer, so the store is built once its real path is known; until then it has none.
  type MemoryStore = ReturnType<typeof server.createMemoryTicketStore>;
  let inner: MemoryStore = server.createMemoryTicketStore();
  const ticketStore: MemoryStore = {
    get calls() {
      return inner.calls;
    },
    tree: (...args) => inner.tree(...args),
    find: (...args) => inner.find(...args),
    mark: (...args) => inner.mark(...args),
    watch: (...args) => inner.watch(...args),
    watching: (...args) => inner.watching(...args),
    emit: (...args) => inner.emit(...args),
    emitRetrospective: (...args) => inner.emitRetrospective(...args),
    fail: (...args) => inner.fail(...args),
  };
  const bmadSource = server.createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server: running, repo }) => {
      const realPath = realpathSync.native(repo);
      inner = server.createMemoryTicketStore({
        repos: { [realPath]: { tickets: BOARD_TICKETS, folder: 'initiative-demo' } },
        text: { '1.2': { description: 'Show the second thing.', verify: 'The board shows it.', references: ['packages/web/src/x.ts'] } },
      });
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));
      // Board on, trusted and set up: the server's ticket watcher watches the project (story 4.8).
      await waitUntil(() => ticketStore.watching(realPath) === 1, 'the ticket watch');

      await page.goto(`${running.url}/w/${wsId}/board`);
      const card = (ref: string) => page.locator(`[data-testid="ticket-card"][data-ref="${ref}"]`);
      await expect(page.getByTestId('ticket-card')).toHaveCount(4);
      await expect(card('1.1')).toHaveAttribute('data-column', 'in_review');
      await expect(card('1.2')).toHaveAttribute('data-column', 'draft');
      await expect(card('1.3')).toHaveAttribute('data-column', 'ready');
      await expect(card('1.4')).toHaveAttribute('data-column', 'blocked');
      await expect(card('1.3')).toContainText('Waits for 1.2');
      await expect(card('1.4')).toContainText('Needs the payment key');
      await expect(card('1.3')).toHaveAccessibleName('1.3 Build the third thing, Waits for 1.2');

      // An agent's write: the store tells the watch, the server appends ticket.changed, the card highlights and moves.
      await ticketStore.mark(realPath, '1.2', 'in-progress', { scripts: 'none' });
      ticketStore.emit(realPath, ['1.2']);
      await expect(card('1.2')).toHaveAttribute('data-highlighted', 'true');
      await expect(card('1.2')).toHaveAttribute('data-column', 'in_progress');
      await expect(card('1.2')).not.toHaveAttribute('data-highlighted', 'true', { timeout: 5_000 });

      // The detail sheet from a card, then Esc back to the board with focus on the card.
      await card('1.2').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board/1\\.2$`));
      const sheet = page.getByRole('dialog', { name: 'Build the second thing' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('ticket-sheet-summary')).toContainText('Show the second thing.');
      await expect(sheet.getByTestId('ticket-sheet-verify')).toContainText('The board shows it.');
      await expect(sheet.getByTestId('ticket-sheet-references')).toContainText('packages/web/src/x.ts');
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(card('1.2')).toBeFocused();

      // The detail sheet from its URL, over the board; an unknown ref says so.
      await page.goto(`${running.url}/w/${wsId}/board/1.3`);
      await expect(page.getByRole('dialog', { name: 'Build the third thing' })).toBeVisible();
      await expect(page.getByTestId('ticket-sheet-prerequisite')).toContainText('1.2');
      await page.goto(`${running.url}/w/${wsId}/board/9.9`);
      await expect(page.getByTestId('ticket-sheet-error')).toHaveText('No ticket 9.9 in this project.');
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));

      // Below md, the epic's columns stack as lists.
      await page.setViewportSize({ width: 600, height: 900 });
      const review = page.locator('[data-testid="board-column"][data-column="in_review"]');
      const blocked = page.locator('[data-testid="board-column"][data-column="blocked"]');
      await expect(blocked).toBeVisible();
      await expect(page.locator('[data-testid="board-column"][data-column="done"]')).toBeHidden();
      const top = (await review.boundingBox())!;
      const bottom = (await blocked.boundingBox())!;
      expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height);
    },
    { extra: { ticketStore, bmadSource }, files: SET_UP },
  );
});

test('changing a status from the board (story 4.10): keyboard only, focus on the moved card, no Done, the sheet menu, and a failure', async ({ page }) => {
  const server = await serverModule();
  type MemoryStore = ReturnType<typeof server.createMemoryTicketStore>;
  let inner: MemoryStore = server.createMemoryTicketStore();
  const ticketStore: MemoryStore = {
    get calls() {
      return inner.calls;
    },
    tree: (...args) => inner.tree(...args),
    find: (...args) => inner.find(...args),
    mark: (...args) => inner.mark(...args),
    watch: (...args) => inner.watch(...args),
    watching: (...args) => inner.watching(...args),
    emit: (...args) => inner.emit(...args),
    emitRetrospective: (...args) => inner.emitRetrospective(...args),
    fail: (...args) => inner.fail(...args),
  };
  const bmadSource = server.createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server: running, repo }) => {
      const realPath = realpathSync.native(repo);
      inner = server.createMemoryTicketStore({ repos: { [realPath]: { tickets: BOARD_TICKETS, folder: 'initiative-demo' } } });
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));
      await waitUntil(() => ticketStore.watching(realPath) === 1, 'the ticket watch');

      await page.goto(`${running.url}/w/${wsId}/board`);
      const card = (ref: string) => page.locator(`[data-testid="ticket-card"][data-ref="${ref}"]`);
      await expect(card('1.2')).toHaveAttribute('data-column', 'draft');

      // Keyboard only: from the card's link, Tab reaches its status button (the next stop), named by the ticket.
      await card('1.2').focus();
      await page.keyboard.press('Tab');
      const trigger = page.getByRole('button', { name: 'Change status of 1.2 Build the second thing' });
      await expect(trigger).toBeFocused();
      // ArrowDown opens the menu on its first item; a planned ticket already shows in Draft, so no Move to Draft.
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['Move to Ready', 'Move to In progress', 'Move to In review', 'Move to Built', 'Move to Blocked', 'Drop this ticket']);
      await expect(menu.getByRole('menuitem', { name: 'Move to Done' })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: 'Move to Ready' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(card('1.2')).toHaveAttribute('data-column', 'ready');
      await expect(card('1.2')).toBeFocused();
      await expect(page.getByTestId('board-announcement')).toHaveText('1.2 moved to Ready');
      expect(ticketStore.calls.filter((each) => each[0] === 'mark')).toEqual([['mark', realPath, '1.2', 'ready-for-dev', undefined]]);
      // A ticket in Ready no longer offers Ready, and never Done.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Move to Ready' })).toHaveCount(0);
      await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Move to Done' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      // Esc closes the menu and focus goes back to its button.
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Change status of 1.2 Build the second thing' })).toBeFocused();

      // Blocked, keyboard only, on 1.1: Cancel puts focus back on its status button; Save blocks it and focus lands on the card.
      const pointerEvents = () => page.evaluate(() => document.body.style.pointerEvents);
      const statusButton = page.getByRole('button', { name: 'Change status of 1.1 Build the first thing' });
      const toBlocked = async () => {
        await card('1.1').focus();
        await page.keyboard.press('Tab');
        await expect(statusButton).toBeFocused();
        await page.keyboard.press('Enter');
        const blockedItem = page.getByRole('menuitem', { name: 'Move to Blocked' });
        const items = page.getByRole('menu').getByRole('menuitem');
        await expect(items.first()).toBeFocused();
        const steps = (await items.allTextContents()).indexOf('Move to Blocked');
        // One step at a time: Radix moves focus on the next tick.
        for (let i = 0; i < steps; i++) {
          await page.keyboard.press('ArrowDown');
          await expect(items.nth(i + 1)).toBeFocused();
        }
        await expect(blockedItem).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Why is 1.1 blocked?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel('Reason')).toBeFocused();
        return dialog;
      };
      let dialog = await toBlocked();
      // An empty reason doesn't save: the error shows and focus stays in the field.
      await dialog.getByRole('button', { name: 'Save' }).press('Enter');
      await expect(dialog.getByRole('alert')).toHaveText('Say why it is blocked.');
      await expect(dialog.getByLabel('Reason')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(statusButton).toBeFocused();
      expect(await pointerEvents()).not.toBe('none');
      dialog = await toBlocked();
      await page.keyboard.type('Needs the API key');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Save' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(card('1.1')).toHaveAttribute('data-column', 'blocked');
      await expect(card('1.1')).toContainText('Needs the API key');
      await expect(card('1.1')).toBeFocused();
      await expect(page.getByTestId('board-announcement')).toHaveText('1.1 moved to Blocked');
      expect(await pointerEvents()).not.toBe('none');
      expect(ticketStore.calls.filter((each) => each[0] === 'mark').at(-1)).toEqual(['mark', realPath, '1.1', 'blocked', 'Needs the API key']);

      // A store that fails: its plain message, and the card stays.
      ticketStore.fail('failed');
      await page.getByRole('button', { name: 'Change status of 1.3 Build the third thing' }).click();
      await page.getByRole('menuitem', { name: 'Move to In progress' }).click();
      await expect(page.getByTestId('board-mark-error')).toContainText("Couldn't change 1.3's status. Ogden Agents couldn't read this project's tickets");
      ticketStore.fail(undefined);
      await expect(card('1.3')).toHaveAttribute('data-column', 'ready');

      // The detail sheet's menu.
      await card('1.3').click();
      const sheet = page.getByRole('dialog', { name: 'Build the third thing' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Change status of 1.3 Build the third thing' }).click();
      await expect(page.getByRole('menuitem', { name: 'Move to Done' })).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'Move to In progress' }).click();
      await expect(sheet.getByTestId('ticket-sheet-status')).toContainText('In progress');
      await expect(sheet.getByTestId('ticket-sheet-announcement')).toHaveText('1.3 moved to In progress');
      await page.keyboard.press('Escape');
      await expect(card('1.3')).toHaveAttribute('data-column', 'in_progress');
    },
    { extra: { ticketStore, bmadSource }, files: SET_UP },
  );
});

test('reopening a Done ticket from the board (story 4.10, user decision 2026-10-02): confirm first, keyboard only; Esc sends nothing; the API refuses an unconfirmed reopen', async ({ page }) => {
  const server = await serverModule();
  const DONE = { ...ROW, ref: '1.9', id: 9, epic: 'epic-planning-and-board', title: 'Build the done thing', type: 'story', status: 'done', state: 'done', blocked_reason: '' };
  let ticketStore = server.createMemoryTicketStore();
  const bmadSource = server.createMemoryBmadSource({ ready: true });
  const store = {
    get calls() {
      return ticketStore.calls;
    },
    tree: (...args: Parameters<typeof ticketStore.tree>) => ticketStore.tree(...args),
    find: (...args: Parameters<typeof ticketStore.find>) => ticketStore.find(...args),
    mark: (...args: Parameters<typeof ticketStore.mark>) => ticketStore.mark(...args),
    watch: (...args: Parameters<typeof ticketStore.watch>) => ticketStore.watch(...args),
  };
  await withChatServer(
    page,
    async ({ server: running, repo }) => {
      const realPath = realpathSync.native(repo);
      ticketStore = server.createMemoryTicketStore({ repos: { [realPath]: { tickets: [...BOARD_TICKETS, DONE], folder: 'initiative-demo' } } });
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
      await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));
      const marks = () => store.calls.filter((each) => each[0] === 'mark');

      // The API: out of Done without the confirmation is refused, and nothing runs.
      await expect(call('PUT', apiPath(API_ROUTES.workspaceTicketStatus, { wsId, ref: '1.9' }), { status: 'draft', expectedStatus: 'done' })).rejects.toThrow(/409: .*reopen_not_confirmed/);
      expect(marks()).toEqual([]);

      await page.goto(`${running.url}/w/${wsId}/board`);
      const card = page.locator('[data-testid="ticket-card"][data-ref="1.9"]');
      await expect(card).toHaveAttribute('data-column', 'done');
      const trigger = page.getByRole('button', { name: 'Change status of 1.9 Build the done thing' });
      const pointerEvents = () => page.evaluate(() => document.body.style.pointerEvents);

      // Keyboard only: Tab to the status button, Enter, the first item asks to reopen; focus starts on Cancel; Esc sends nothing.
      await card.focus();
      await page.keyboard.press('Tab');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      const items = page.getByRole('menu').getByRole('menuitem');
      await expect(items.first()).toBeFocused();
      await expect(page.getByRole('menuitem', { name: 'Move to Done' })).toHaveCount(0);
      await page.keyboard.press('Enter');
      const confirm = page.getByRole('alertdialog', { name: 'Reopen this ticket?' });
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('1.9 is done. It moves to Draft and needs approving again to be done.');
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await pointerEvents()).not.toBe('none');
      expect(marks()).toEqual([]);
      await expect(card).toHaveAttribute('data-column', 'done');

      // Reopen to Ready: the move lands, focus on the moved card.
      await page.keyboard.press('Enter');
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Move to Ready' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(confirm).toBeVisible();
      await expect(confirm).toContainText('It moves to Ready');
      await page.keyboard.press('Tab');
      await expect(confirm.getByRole('button', { name: 'Reopen' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(card).toHaveAttribute('data-column', 'ready');
      await expect(card).toBeFocused();
      await expect(page.getByTestId('board-announcement')).toHaveText('1.9 moved to Ready');
      expect(await pointerEvents()).not.toBe('none');
      expect(marks()).toEqual([['mark', realPath, '1.9', 'ready-for-dev', undefined]]);
    },
    { extra: { ticketStore: store, bmadSource }, files: SET_UP },
  );
});

test('reduced mode (entry 4.11): Plan, Board and Settings explain what is missing, and Upgrade this project ends with the notices gone and the tickets shown', async ({ page }) => {
  const server = await serverModule();
  // Until bound, an empty memory catalog and ticket store: no repo has BMad Method.
  const catalog = lateCatalog(server.createMemoryBmadCatalog());
  type MemoryStore = ReturnType<typeof server.createMemoryTicketStore>;
  let inner: MemoryStore = server.createMemoryTicketStore();
  const ticketStore: MemoryStore = {
    get calls() {
      return inner.calls;
    },
    tree: (...args) => inner.tree(...args),
    find: (...args) => inner.find(...args),
    mark: (...args) => inner.mark(...args),
    watch: (...args) => inner.watch(...args),
    watching: (...args) => inner.watching(...args),
    emit: (...args) => inner.emit(...args),
    emitRetrospective: (...args) => inner.emitRetrospective(...args),
    fail: (...args) => inner.fail(...args),
  };
  const bmadSource = server.createMemoryBmadSource({ ready: true });
  const PLAIN_LABELS_TEXT = "This project's BMad Method has actions Ogden Agents doesn't know, so starting from an idea isn't available and its actions show without plain names or groups.";
  const TICKET_TREE_TEXT = "This project's BMad Method doesn't keep tickets the way Ogden Agents reads them, so the board isn't available.";
  await withChatServer(
    page,
    async ({ server: running, repo }) => {
      const real = realpathSync.native(repo);
      const memory = server.createMemoryBmadCatalog(
        { [real]: { hasBmad: true, hasOutput: true } },
        { [real]: [{ name: 'bmad-help', description: 'Get help with BMad Method in this project.' }] },
        {
          setup: { [real]: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } },
          missing: { [real]: ['plain_labels', 'ticket_tree'] },
          afterUpgrade: { [real]: { entryAction: 'bmad-help' } },
        },
      );
      // The upgrade's steps arrive a little apart, as the real setup's do, so the progress list can be seen.
      catalog.bind({
        ...memory,
        setup: async (repoPath: string, onProgress: (progress: { step: string; label: string }) => void, options?: { upgrade?: boolean }) => {
          for (const [step, label] of [
            ['checking', 'Checking the project'],
            ['copying_skills', 'Copying the BMad Method skills'],
            ['writing_config', "Writing the project's BMad Method settings"],
            ['verifying', 'Checking the setup'],
          ] as const) {
            onProgress({ step, label });
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          return memory.setup(repoPath, () => {}, options);
        },
      });
      inner = server.createMemoryTicketStore({ repos: { [real]: { tickets: BOARD_TICKETS, folder: 'initiative-demo' } } });
      const { wsId, call } = await openProject(page, repo);
      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['planning', 'board'] });
      await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));

      // Plan: the notice where "Start from an idea" was; the skills still list and start.
      await page.goto(`${running.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('reduced-mode-notice')).toContainText(PLAIN_LABELS_TEXT);
      await expect(page.getByTestId('plan-idea')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Start Get help with BMad Method in this project.' })).toBeVisible();

      // Board: the notice instead of the board, so no card menu; the store never ran.
      await page.goto(`${running.url}/w/${wsId}/board`);
      await expect(page.getByTestId('reduced-mode-notice')).toContainText(TICKET_TREE_TEXT);
      await expect(page.getByTestId('ticket-card')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Change status/ })).toHaveCount(0);
      expect(ticketStore.calls.filter((each) => each[0] === 'tree')).toEqual([]);

      // Workspace settings: the status line, one notice with a sentence per missing capability, one Upgrade.
      await page.goto(`${running.url}/w/${wsId}/settings`);
      await expect(page.getByTestId('reduced-mode-text')).toHaveText([PLAIN_LABELS_TEXT, TICKET_TREE_TEXT]);
      await expect(page.getByRole('button', { name: 'Upgrade this project' })).toHaveCount(1);

      // Upgrade from the Board: confirm, the progress, then the tickets.
      await page.goto(`${running.url}/w/${wsId}/board`);
      await page.getByRole('button', { name: 'Upgrade this project' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'Upgrade this project?' });
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await confirm.getByRole('button', { name: 'Upgrade', exact: true }).click();
      await expect(page.getByTestId('bmad-setup-steps')).toBeVisible();
      await expect(page.getByTestId('ticket-card')).toHaveCount(4, { timeout: 15_000 });
      await expect(page.getByTestId('reduced-mode-notice')).toHaveCount(0);
      // The upgrade's done line stays above the board.
      await expect(page.getByTestId('bmad-upgrade-done')).toBeVisible();
      expect(memory.setupOptions).toEqual([{ upgrade: true }]);

      // The notices are gone everywhere: Plan has its idea prompt, Settings no notice.
      await page.goto(`${running.url}/w/${wsId}/plan`);
      await expect(page.getByTestId('plan-idea')).toBeVisible();
      await expect(page.getByTestId('reduced-mode-notice')).toHaveCount(0);
      await page.goto(`${running.url}/w/${wsId}/settings`);
      await expect(page.getByTestId('bmad-setup-status')).toBeVisible();
      await expect(page.getByTestId('reduced-mode-notice')).toHaveCount(0);
    },
    { extra: { bmadCatalog: catalog.port, ticketStore, bmadSource } },
  );
});
