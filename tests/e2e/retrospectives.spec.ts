/// <reference lib="dom" />
/**
 * Look back on an epic in a real browser (stories 7.1 and 7.4): with Board
 * and Retrospectives on and the project trusted, a finished epic offers
 * "Look back on it?" with Not now (kept across a reload), each epic header
 * has the catalog's Look back on this epic, which opens a planning session
 * whose first message invokes the retrospective skill on the epic's folder;
 * the fake agent writes the retrospective, and the board then shows its
 * verdict chip (read from the file's frontmatter by the real catalog). With
 * Retrospectives off the board shows none of it. The skill is the verified
 * pinned copy's, so the real catalog gives it its epic scope. The ticket
 * store is a stub with one epic (no `uv`, no `tickets.py`); no real
 * `claude` runs.
 */
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

const SKILL_FILES = { '.claude/skills/bmad-retrospective/SKILL.md': SKILL('bmad-retrospective', 'Look back on a finished epic.') };

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
