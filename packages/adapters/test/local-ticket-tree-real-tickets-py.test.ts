/**
 * The real interop proof for epic 18 story 5: `_bmad/method/scripts/tickets.py`
 * — the actual script, run through real `uv` with its own managed Python,
 * never a fake — reads a tree `pullJiraIssuesIntoLocalTree` wrote, with no
 * `problems`, correct ids/types/status/tracker_id, and a ticket resolves by
 * its Jira key through `find`; then `mark` (a human or another skill
 * running it directly) writes only the field it is told to, preserving the
 * file as this adapter's own future re-sync still expects to read it.
 * Matching this repo's existing real-uv test convention
 * (`packages/server/test/build-real-uv.test.ts`); skipped without uv and
 * its managed Python (CI always provisions both).
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { realUvMissing, TEST_PYTHON } from '../../../tests/fixtures/bmad-upstream-source.js';
import { pullJiraIssuesIntoLocalTree } from '../src/tickets-jira/local-ticket-tree.js';
import type { JiraIssue } from '../src/tickets-jira/jira-issue-mapping.js';

const execFileAsync = promisify(execFile);
const TICKETS_PY = resolve(import.meta.dirname, '../../../_bmad/method/scripts/tickets.py');

async function runTicketsPy(args: readonly string[], uvCache: string): Promise<unknown> {
  const { stdout } = await execFileAsync('uv', ['run', '--python', TEST_PYTHON, TICKETS_PY, ...args], { env: { ...process.env, UV_CACHE_DIR: uvCache }, timeout: 60_000 });
  return JSON.parse(stdout);
}

describe.skipIf(realUvMissing())('tickets.py reads and marks a tree pullJiraIssuesIntoLocalTree wrote (real uv)', () => {
  it('status reports both tickets correctly, with no problems, and find resolves one by its Jira key', async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-jira-uv-cache-'));
    const root = mkdtempSync(join(tmpdir(), 'ogden-agents-jira-tree-'));
    try {
      const initiativeDir = join(root, 'initiative-example');
      const epic: JiraIssue = { key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' }, issuetype: { name: 'Epic' } } };
      const story: JiraIssue = { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' }, issuetype: { name: 'Story' }, parent: { key: 'ENG-1' } } };
      const bug: JiraIssue = { key: 'ENG-4', fields: { summary: 'Cart total is wrong', status: { name: 'In Review' }, issuetype: { name: 'Bug' }, parent: { key: 'ENG-1' }, priority: { name: 'High' } } };
      await pullJiraIssuesIntoLocalTree([epic, story, bug], { initiativeDir, siteUrl: 'https://x.atlassian.net' });

      const status = (await runTicketsPy(['--project-root', initiativeDir, 'status', initiativeDir], uvCache)) as { tickets: Array<Record<string, unknown>>; epics: Array<Record<string, unknown>>; unpinned_after: unknown[] };
      expect(status.unpinned_after).toEqual([]);
      expect(status.epics).toEqual([{ slug: 'epic-checkout-rewrite', id: null, status: '', after: [], blocks: [] }]);
      const byKey = Object.fromEntries(status.tickets.map((t) => [t.tracker_id, t]));
      expect(byKey['ENG-2']).toMatchObject({ type: 'story', title: 'Add a cart', status: 'draft', state: 'backlog' });
      expect(byKey['ENG-4']).toMatchObject({ type: 'bug', title: 'Cart total is wrong', status: 'in-review', state: 'review' });

      const found = (await runTicketsPy(['--project-root', initiativeDir, 'find', initiativeDir, 'ENG-4'], uvCache)) as { tracker_id: string; file: string };
      expect(found.tracker_id).toBe('ENG-4');
      expect(found.file).toBe('bug-cart-total-is-wrong.md');

      // mark (a human or another skill running tickets.py directly) touches only the field it is told to.
      const marked = (await runTicketsPy(['--project-root', initiativeDir, 'mark', initiativeDir, 'ENG-4', 'blocked', '--blocked', 'waiting on design'], uvCache)) as { status: string; blocked_reason: string };
      expect(marked).toMatchObject({ status: 'blocked', blocked_reason: 'waiting on design' });

      const after = (await runTicketsPy(['--project-root', initiativeDir, 'find', initiativeDir, 'ENG-4'], uvCache)) as { status: string; title: string };
      expect(after).toMatchObject({ status: 'blocked', title: 'Cart total is wrong' }); // the leaf's own fields are untouched by mark
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(uvCache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 60_000);
});
