/// <reference lib="dom" />
/**
 * Captures the screenshots in `docs/share/screenshots/` (the sharing kit).
 * Re-run it after the UI changes:
 *
 *   pnpm build
 *   pnpm exec playwright test --config tests/share-screenshots/playwright.config.ts
 *
 * It is a test runner on purpose: the server's test hooks (`testHooksAllowed`)
 * work only for a test run on a data folder inside the OS temp folder, which
 * this is. Everything runs on fake pieces and nothing leaves the computer: a
 * temp data folder, the fake ACP agent (with a plainer Markdown reply), an
 * in-memory API-key store, an in-memory BMad Method source, a stub ticket
 * store and a stub BMad Method setup. No real agent, keychain or network.
 *
 * Each screen is saved four times, `<name>-<light|dark>-<desktop|phone>.png`:
 * desktop is 1440x900, phone is 390x844.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, FAKE_AGENT, makeDataDir, removeDataDir, ROOT, serverModule, startServer } from '../support.js';
import { composer, send } from '../e2e/chat-server.js';
import { storedToken } from '../e2e/tab.js';

const OUT = join(ROOT, 'docs', 'share', 'screenshots');
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;
const SCHEMES = ['light', 'dark'] as const;

const SKILL = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;
const SET_UP = {
  '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n',
  '.claude/skills/bmad-product-brief/SKILL.md': SKILL('bmad-product-brief', 'Create a product brief.'),
  '.claude/skills/bmad-prd/SKILL.md': SKILL('bmad-prd', 'Create a PRD.'),
  '.claude/skills/bmad-spec/SKILL.md': SKILL('bmad-spec', 'Condense any input into a short spec.'),
  '.claude/skills/bmad-architecture/SKILL.md': SKILL('bmad-architecture', 'Record the architecture decisions.'),
  '.claude/skills/bmad-ticket/SKILL.md': SKILL('bmad-ticket', 'Create and manage tickets.'),
  '.claude/skills/bmad-code-review/SKILL.md': SKILL('bmad-code-review', 'Review code changes.'),
};

const ROW = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' };
const ticket = (id: number, epic: string, title: string, status: string, state: string, extra: Record<string, unknown> = {}) => ({
  ...ROW,
  ref: `${epic === 'epic-checkout' ? 1 : 2}.${id}`,
  id,
  epic,
  title,
  type: 'story',
  status,
  state,
  blocked_reason: '',
  ...extra,
});
const TICKETS = [
  ticket(1, 'epic-checkout', 'Add a cart summary to the checkout page', 'done', 'done'),
  ticket(2, 'epic-checkout', 'Validate card numbers before submitting', 'in-review', 'review'),
  ticket(3, 'epic-checkout', 'Send a receipt email after payment', 'in-progress', 'in_progress'),
  ticket(4, 'epic-checkout', 'Handle a declined card with a clear message', '', 'planned', { after: ['1.3'] }),
  ticket(1, 'epic-invoices', 'List invoices for a customer', 'ready-for-dev', 'planned'),
  ticket(2, 'epic-invoices', 'Download an invoice as PDF', '', 'planned'),
  ticket(3, 'epic-invoices', 'Export invoices to CSV', 'blocked', 'planned', { blocked_at: '2026-10-01', blocked_reason: 'Waiting for the finance team to confirm the column list' }),
  ticket(4, 'epic-invoices', 'Show overdue invoices first', 'built', 'review'),
];
function stubTicketStore() {
  return {
    tree: async () => ({ tickets: TICKETS.map((t) => ({ ...t })), problems: [], folder: 'initiative-billing', epics: [] }),
    find: () => Promise.reject(new Error('not used')),
    mark: () => Promise.reject(new Error('not used')),
    watch: async () => ({ close() {} }),
  };
}

/** The fake ACP agent with its Markdown reply swapped for a plain, realistic one (the stock one carries test traps). */
function writeDemoAgent(): string {
  const source = readFileSync(FAKE_AGENT, 'utf8');
  const start = source.indexOf("if (text === 'markdown') {");
  const end = source.indexOf("if (text === 'crash') {");
  if (start < 0 || end < start) throw new Error('the fake agent changed: update writeDemoAgent');
  const reply = `if (text === 'markdown') {
      const chunks = [
        'I looked at the checkout flow. Here is what I found.\\n\\n## What needs to change\\n\\n',
        '- The **card form** accepts any number; it should check the length and the Luhn digit\\n- The receipt email is sent before the payment is confirmed\\n- A declined card shows a raw error code\\n\\n',
        '### Proposed fix\\n\\n\`\`\`ts\\nexport function isValidCard(number: string): boolean {\\n  return luhn(number.replace(/\\\\s/g, ""));\\n}\\n\`\`\`\\n\\n',
        '| Step | Files | Effort |\\n| --- | --- | ---: |\\n| Validate the card | checkout/card.ts | 1 hour |\\n| Move the receipt | checkout/receipt.ts | 2 hours |\\n\\nShall I start with the validation? I will ask before running the tests.\\n',
      ];
      for (const chunk of chunks) {
        await say(client, params.sessionId, chunk);
        await sleep(CHUNK_DELAY_MS);
      }
      return { stopReason: 'end_turn' };
    }
    `;
  const file = join(ROOT, 'tests', 'share-screenshots', '.demo-agent.mjs');
  writeFileSync(file, source.slice(0, start) + reply + source.slice(end));
  return file;
}

async function api(page: Page, method: string, path: string, body: unknown): Promise<any> {
  const origin = new URL(page.url()).origin;
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${(await storedToken(page))!}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

/** Opens `url` at every size and scheme and saves `<name>-<scheme>-<size>.png`. */
async function shoot(page: Page, name: string, url: string, ready: () => Promise<void>, prepare?: () => Promise<void>) {
  for (const scheme of SCHEMES) {
    for (const [size, viewport] of Object.entries(SIZES)) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(url);
      await ready();
      if (prepare) await prepare();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${name}-${scheme}-${size}.png`), animations: 'disabled' });
    }
  }
}

test('share-kit screenshots', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const folders: string[] = [];
  const temp = (prefix: string) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    folders.push(dir);
    return dir;
  };
  const demoAgent = writeDemoAgent();
  try {
    // 1. Welcome: a first run on its own server (signed out, as a fresh install).
    const welcomeData = temp('ogden-share-welcome-');
    const welcome = await startServer(welcomeData, 0, { firstRun: true });
    try {
      await page.goto(welcome.launchUrl);
      await expect(page.getByTestId('welcome-headline')).toBeVisible();
      const url = page.url();
      await shoot(page, '01-welcome', url, () => expect(page.getByTestId('welcome-headline')).toBeVisible(), () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()));
    } finally {
      await welcome.close();
    }

    // 2. Everything else on one server with four projects.
    const dataDir = makeDataDir('ogden-share-');
    folders.push(dataDir);
    const projects = temp('ogden-share-projects-');
    const folder = (name: string, files: Record<string, string> = {}) => {
      const dir = join(projects, name);
      mkdirSync(dir, { recursive: true });
      for (const [path, content] of Object.entries(files)) {
        const file = join(dir, ...path.split('/'));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      return dir;
    };
    const { createMemoryBmadCatalog, createMemoryBmadSource } = await serverModule();
    const bmadSource = createMemoryBmadSource({ ready: true });
    const acmeDir = folder('acme-website');
    const billingDir = folder('billing-api', SET_UP);
    const mobileDir = folder('mobile-app');
    const notesDir = folder('team-notes');
    // billing-api already has BMad Method; its skills come with Ogden Agents' plain labels and groups.
    const real = realpathSync(billingDir);
    const skill = (name: string, description: string, label: string, group: string) => ({ name, description, label, group, module: 'bmm', installedAt: null, next: null });
    const bmadCatalog = createMemoryBmadCatalog(
      { [real]: { hasBmad: true, hasOutput: true } },
      {
        [real]: [
          skill('bmad-product-brief', 'Write a short brief for a product idea.', 'Write a product brief', 'planning'),
          skill('bmad-prd', 'Create a PRD.', 'Write the requirements', 'planning'),
          skill('bmad-spec', 'Condense any input into a short spec.', 'Turn notes into a spec', 'planning'),
          skill('bmad-architecture', 'Record the architecture decisions.', 'Decide how it is built', 'planning'),
          skill('bmad-ticket', 'Create and manage tickets.', 'Break the work into tickets', 'building'),
          skill('bmad-code-review', 'Several reviewers read the change.', 'Review the code', 'checking'),
        ],
      },
      {
        catalogs: { [real]: { entryAction: 'bmad-product-brief' } },
        setup: { [real]: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '6.0.0', installedVersion: '6.0.0', problems: [] } },
        scripts: { [real]: 'demo-fingerprint' },
      },
    );
    const server = await startServer(dataDir, 0, {
      bmadCatalog,
      claudeAdapterPath: demoAgent,
      ticketStore: stubTicketStore(),
      bmadSource,
      extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '5' },
    });
    try {
      await page.setViewportSize(SIZES.desktop);
      await page.goto(server.launchUrl);
      await expect(page).toHaveURL(`${new URL(server.launchUrl).origin}/`);
      await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const base = new URL(page.url()).origin;
      // The app-shortcut offer is a first-run banner; the kit's shots show the app without it.
      await page.getByRole('button', { name: 'Not now' }).click();

      const add = async (path: string): Promise<string> => (await api(page, 'POST', API_ROUTES.workspaces, { path })).workspace.id;
      const acme = await add(acmeDir);
      const billing = await add(billingDir);
      await add(mobileDir);
      const notes = await add(notesDir);
      await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: billing }), { bmadPieces: ['planning', 'board'] });

      // Empty project: "Start a chat".
      await shoot(page, '02-empty-project', `${base}/w/${notes}`, () => expect(page.getByTestId('chats-empty')).toBeVisible());

      // A chat with a formatted reply and a waiting permission card, in acme-website.
      const sesId = (await api(page, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: acme }), { kind: 'chat' })).session.id;
      const chatUrl = `${base}/w/${acme}/s/${sesId}`;
      await api(page, 'PUT', apiPath(API_ROUTES.sessionTitle, { wsId: acme, sesId }), { title: 'Fix the checkout flow' });
      await page.goto(chatUrl);
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
      await send(page, 'markdown');
      await expect(page.getByTestId('message-agent')).toContainText('Shall I start with the validation?');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
      await send(page, 'permission npm test');
      await expect(page.getByTestId('permission-card')).toBeVisible();
      await expect(composer(page)).toBeVisible();
      await shoot(page, '03-chat-permission', chatUrl, () => expect(page.getByTestId('permission-card')).toBeVisible());

      // Sidebar with several projects (and the chat waiting on you).
      await shoot(page, '04-sidebar-projects', `${base}/w/${acme}`, () => expect(page.getByTestId('workspace-group').first()).toBeAttached(), async () => {
        if (page.viewportSize()!.width < 500) {
          await page.getByTestId('sidebar-trigger').click();
          await page.waitForTimeout(300);
        }
      });

      // Settings: Agents and Notifications.
      await shoot(page, '05-settings-agents', `${base}/settings/agents`, () => expect(page.getByTestId('agents-settings-page')).toBeVisible());
      await shoot(page, '06-settings-notifications', `${base}/settings/notifications`, () => expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible());

      // BMad Settings for the billing project, trusted once through the Board's prompt.
      await page.goto(`${base}/w/${billing}/board`);
      await expect(page.getByTestId('script-trust-prompt')).toBeVisible();
      await page.getByTestId('script-trust-allow').click();
      await expect(page.getByTestId('ticket-card').first()).toBeVisible();
      await shoot(page, '07-bmad-settings', `${base}/w/${billing}/settings`, () => expect(page.getByRole('switch', { name: 'Board', exact: true })).toBeVisible(), async () => {
        // The BMad Method section sits below the caution level and models: scroll it to the top.
        await page.getByRole('heading', { name: 'BMad Method', exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      });
      await shoot(page, '08-plan', `${base}/w/${billing}/plan`, () => expect(page.getByTestId('skill-row').first()).toBeVisible());
      await shoot(page, '09-board', `${base}/w/${billing}/board`, () => expect(page.getByTestId('ticket-card').first()).toBeVisible());
    } finally {
      await server.close();
    }
  } finally {
    rmSync(join(ROOT, 'tests', 'share-screenshots', '.demo-agent.mjs'), { force: true });
    for (const dir of folders) removeDataDir(dir);
  }
});
