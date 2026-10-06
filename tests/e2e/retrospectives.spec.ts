/// <reference lib="dom" />
/**
 * Look back on an epic in a real browser (story 7.1, epic 7's tracer): with
 * Board and Retrospectives on and the project trusted, each epic header on
 * the board has Look back on this epic; it opens a planning session whose
 * first message invokes the retrospective skill on the epic's folder, which
 * the fake agent answers. With Retrospectives off the board shows no such
 * button. The ticket store is a stub with one epic (no `uv`, no
 * `tickets.py`); no real `claude` runs.
 */
import { expect, test } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, serverModule } from '../support.js';
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
      epics: [{ slug: 'epic-first', id: 1, status: 'active', after: [], blocks: [] }],
    }),
    find: () => Promise.reject(new Error('not used in this test')),
    mark: () => Promise.reject(new Error('not used in this test')),
    watch: async () => ({ close() {} }),
  };
}

const SET_UP = { '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n' };

test('Look back on this epic opens a planning session on the retrospective skill, and only with Retrospectives on', async ({ page }) => {
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
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

      // Retrospectives off: the board lists the epic and offers no look-back.
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('board-epic')).toHaveCount(1);
      await expect(page.getByTestId('board-look-back')).toHaveCount(0);

      await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds', 'retrospectives'] });
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('board-look-back')).toHaveText('Look back on this epic');
      await page.getByTestId('board-look-back').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      await expect(page.getByTestId('message-user')).toHaveText('/bmad-retrospective _bmad-output/initiative-demo/epic-first');
      await expect(page.getByTestId('message-agent')).toContainText('command=/bmad-retrospective');
    },
    {
      extra: { ticketStore: stubTicketStore(), bmadSource },
      files: { ...SET_UP, '.claude/skills/bmad-retrospective/SKILL.md': SKILL('bmad-retrospective', 'Look back on a finished epic.') },
    },
  );
});
