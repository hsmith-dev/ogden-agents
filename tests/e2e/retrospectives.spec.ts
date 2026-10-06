/// <reference lib="dom" />
/**
 * Look back on an epic in a real browser (stories 7.1 and 7.4): with Board
 * and Retrospectives on and the project trusted, a finished epic offers
 * "Look back on it?" with Not now (kept across a reload), each epic header
 * has the catalog's Look back on this epic, which opens a planning session
 * whose first message invokes the retrospective skill on the epic's folder;
 * the fake agent writes the retrospective, and the board then shows its
 * verdict chip (read from the file's frontmatter by the real catalog). With
 * Retrospectives off the board shows none of it. Story 7.5: the retrospective's
 * card offers the lessons and action-item steps and Save the lessons for
 * later builds, which makes one local commit of AGENTS.md and the
 * retrospective on a real git repo. The skill is the verified
 * pinned copy's, so the real catalog gives it its epic scope. The ticket
 * store is a stub with one epic (no `uv`, no `tickets.py`); no real
 * `claude` runs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, verifiedCopySource } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const SKILL = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

const ROW = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' };
const TICKETS = [{ ...ROW, ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'done', state: 'done', blocked_reason: '' }];

/** A ticket store with one epic, without `uv` or `tickets.py`. */
function stubTicketStore() {
  return {
    tree: async () => ({
      tickets: TICKETS.map((ticket) => ({ ...ticket })),
      problems: [],
      folder: 'initiative-demo',
      epics: [{ slug: 'epic-first', id: 1, status: 'active', after: [], blocks: [], retrospective: null }],
    }),
    find: () => Promise.reject(new Error('not used in this test')),
    mark: () => Promise.reject(new Error('not used in this test')),
    watch: async () => ({ close() {} }),
  };
}

const SET_UP = { '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n' };

const SKILL_FILES = {
  '.claude/skills/bmad-retrospective/SKILL.md': SKILL('bmad-retrospective', 'Look back on a finished epic.'),
  '.claude/skills/bmad-project-context/SKILL.md': SKILL('bmad-project-context', 'Keep AGENTS.md current.'),
  '.claude/skills/bmad-ticket/SKILL.md': SKILL('bmad-ticket', 'Plan the work in tickets.'),
};

test('a finished epic offers a look back (Not now is kept), Look back opens the session, and the verdict chip shows once the retrospective is written; none of it with Retrospectives off', async ({ page }) => {
  const verified = await verifiedCopySource(SKILL_FILES);
  try {
    await withChatServer(
      page,
      async ({ server, repo }) => {
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
        await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] });
        await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));

        // Retrospectives off: the board lists the epic and shows none of it.
        await page.goto(`${server.url}/w/${wsId}/board`);
        await expect(page.getByTestId('board-epic')).toHaveCount(1);
        await expect(page.getByTestId('board-look-back')).toHaveCount(0);
        await expect(page.getByTestId('board-look-back-offer')).toHaveCount(0);

        await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'retrospectives'] });
        await page.goto(`${server.url}/w/${wsId}/board`);
        await expect(page.getByTestId('board-look-back')).toHaveText('Look back on this epic');
        const offer = page.getByTestId('board-look-back-offer');
        await expect(offer).toContainText('Every ticket in this epic is done. Look back on it?');
        // Not now hides the offer, kept across a reload; the header action stays.
        await page.getByTestId('board-look-back-dismiss').click();
        await expect(offer).toHaveCount(0);
        await page.reload();
        await expect(page.getByTestId('board-look-back')).toBeVisible();
        await expect(page.getByTestId('board-look-back-offer')).toHaveCount(0);
        await expect(page.getByTestId('board-retrospective-verdict')).toHaveCount(0);

        await page.getByTestId('board-look-back').click();
        await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
        await expect(page.getByTestId('message-user')).toHaveText('/bmad-retrospective _bmad-output/initiative-demo/epic-first');
        await expect(page.getByTestId('message-agent').first()).toContainText('command=/bmad-retrospective');
        // The fake agent wrote the retrospective: a card in the transcript.
        await expect(page.getByTestId('document-card')).toHaveAttribute('data-path', '_bmad-output/initiative-demo/epic-first/epic-first-retrospective.md');

        // Back on the board its verdict shows as a chip, from the file's frontmatter.
        await page.goto(`${server.url}/w/${wsId}/board`);
        await expect(page.getByTestId('board-retrospective-verdict')).toHaveText('Accepted with open items, 2026-10-05');
      },
      {
        extra: { ticketStore: stubTicketStore(), bmadSource: verified.source },
        files: { ...SET_UP, ...SKILL_FILES },
      },
    );
  } finally {
    verified.remove();
  }
});

test('the retrospective\'s card adds the lessons to AGENTS.md in a new session, and Save the lessons commits exactly AGENTS.md and the retrospective', async ({ page }) => {
  const verified = await verifiedCopySource(SKILL_FILES);
  try {
    await withChatServer(
      page,
      async ({ server, repo }) => {
        const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
        git('init', '--quiet', '--initial-branch=main');
        git('config', 'user.name', 'Fixture');
        git('config', 'user.email', 'fixture@example.com');
        git('config', 'core.autocrlf', 'false');
        git('add', '-A');
        git('commit', '--quiet', '--no-verify', '-m', 'The fixture');
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
        await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'retrospectives'] });
        await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));

        await page.goto(`${server.url}/w/${wsId}/board`);
        await page.getByTestId('board-look-back').click();
        await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
        const lookBackUrl = page.url();
        const card = page.getByTestId('document-card');
        await expect(card).toBeVisible();
        await expect(card.getByTestId('retrospective-step')).toHaveText(['Add the lessons to AGENTS.md', 'Turn the action items into tickets']);
        await expect(card.getByTestId('retrospective-save-note')).toHaveText('Later builds will follow these lessons.');

        // The lessons: a new session, in which the fake agent writes the pitfall into AGENTS.md.
        await card.getByTestId('retrospective-step').first().click();
        await expect(page).not.toHaveURL(lookBackUrl);
        await expect(page.getByTestId('message-user')).toHaveText('/bmad-project-context _bmad-output/initiative-demo/epic-first/epic-first-retrospective.md');
        await expect.poll(() => { try { return readFileSync(join(repo, 'AGENTS.md'), 'utf8'); } catch { return ''; } }).toContain('Run the fake check before you say a fake change is done.');
        expect(git('status', '--porcelain').split('\n').filter(Boolean).map((line) => line.slice(3)).sort()).toEqual(['AGENTS.md', '_bmad-output/'].sort());

        // Save the lessons: back on the retrospective's card, one local commit of exactly the two paths.
        const before = git('rev-parse', 'HEAD').trim();
        await page.goto(lookBackUrl);
        await page.getByTestId('retrospective-save').click();
        await expect(page.getByTestId('retrospective-save-note')).toHaveText('Saved. Later builds will follow these lessons.');
        expect(git('rev-list', '--count', `${before}..HEAD`).trim()).toBe('1');
        expect(git('show', '--name-only', '--pretty=format:', 'HEAD').split('\n').filter(Boolean).sort()).toEqual(['AGENTS.md', '_bmad-output/initiative-demo/epic-first/epic-first-retrospective.md'].sort());
        expect(git('status', '--porcelain').trim()).toBe('');
        // Nothing left to save.
        await page.getByTestId('retrospective-save').click();
        await expect(page.getByTestId('retrospective-error')).toHaveText('There is nothing new to save: the lessons are already saved.');
      },
      {
        extra: { ticketStore: stubTicketStore(), bmadSource: verified.source },
        files: { ...SET_UP, ...SKILL_FILES },
      },
    );
  } finally {
    verified.remove();
  }
});
