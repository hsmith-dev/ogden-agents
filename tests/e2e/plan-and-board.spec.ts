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
 * don't carry it). No real `claude` or `uv` runs.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, serverModule, stubSetupCatalog } from '../support.js';
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
      // On the real catalog (story 4.4), each skill shows the label mapping's plain label.
      await page.getByRole('button', { name: 'Start Write the spec' }).click();
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

      // Trusted once for the project: the Board lists the tickets with no prompt.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('ticket-row')).toHaveCount(2);
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
      await expect(page.getByTestId('workspace-tabs').getByRole('link')).toHaveText(['Chats', 'Board']);
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
      for (const [path, content] of Object.entries(moduleFiles('core-tools', [['bmad-brainstorming', 'Brainstorm from SKILL.md.']]))) {
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
      files: {
        ...SET_UP,
        ...moduleFiles('method', [
          ['bmad-product-brief', 'Brief from SKILL.md.'],
          ['bmad-code-review', 'Review from SKILL.md.'],
        ]),
        '.claude/skills/my-own/SKILL.md': SKILL('my-own', 'My own skill.'),
      },
    },
  );
});
