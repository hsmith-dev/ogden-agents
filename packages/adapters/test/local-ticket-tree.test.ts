/**
 * Writing a Jira board's issues into BMad's real on-disk ticket tree (epic
 * 18 stories 5-6; AD-28, AD-27). No test reaches the network: most write
 * to a fresh temp directory with an unreachable `jira` credential that is
 * never actually called; the reconciliation push/apply tests use the fake
 * Jira server fixture on loopback instead.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeJiraServer, type FakeJiraServer } from '../../../tests/fixtures/fake-jira-server.mjs';
import { parseFrontmatterBlock } from '../src/tickets-jira/bmad-frontmatter.js';
import { pullJiraIssuesIntoLocalTree, UNASSIGNED_EPIC_TRACKER_ID, type JiraSyncRecord } from '../src/tickets-jira/local-ticket-tree.js';
import type { JiraIssue } from '../src/tickets-jira/jira-issue-mapping.js';

const dirs: string[] = [];
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const close of closers.splice(0)) await close();
});

async function fakeServer(options: Parameters<typeof startFakeJiraServer>[0] = {}): Promise<FakeJiraServer> {
  const server = await startFakeJiraServer(options);
  closers.push(() => server.close());
  return server;
}

function tempInitiative(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-jira-tree-'));
  dirs.push(dir);
  return join(dir, 'initiative-example');
}

const epic = (key: string, summary: string): JiraIssue => ({ key, fields: { summary, status: { name: 'In Progress' }, issuetype: { name: 'Epic' } } });
const story = (key: string, summary: string, parentKey: string | undefined, status = 'To Do'): JiraIssue => ({
  key,
  fields: { summary, status: { name: status }, issuetype: { name: 'Story' }, ...(parentKey === undefined ? {} : { parent: { key: parentKey } }) },
});
const bug = (key: string, summary: string, parentKey: string, priority: string): JiraIssue => ({
  key,
  fields: { summary, status: { name: 'To Do' }, issuetype: { name: 'Bug' }, parent: { key: parentKey }, priority: { name: priority } },
});

async function read(initiativeDir: string, ...segments: string[]): Promise<string> {
  return readFile(join(initiativeDir, ...segments), 'utf8');
}

/** A `jira` call option that must never actually be reached: any fetch through it fails the test loudly rather than silently reaching the network. Used by tests whose reconciliation outcome never calls out (first sync, idempotent re-sync, or a genuine conflict that stays a conflict). */
const UNREACHABLE_JIRA = {
  baseUrl: 'https://unreachable.invalid',
  email: 'dev@example.com',
  token: 'unused',
  fetch: (() => {
    throw new Error('this test should never make a real Jira call');
  }) as unknown as typeof fetch,
};

describe('pullJiraIssuesIntoLocalTree', () => {
  it('creates an epic folder and a leaf + plan + sync record for a story under it', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const result = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://my-team.atlassian.net', jira: UNREACHABLE_JIRA });

    expect(result.epics).toEqual([{ slug: 'epic-checkout-rewrite', issueKey: 'ENG-1', created: true }]);
    expect(result.leaves).toHaveLength(1);
    const { epicSlug, file, id } = result.leaves[0]!;
    expect(epicSlug).toBe('epic-checkout-rewrite');

    const epicEnvelope = await read(initiativeDir, 'epic-checkout-rewrite', 'epic-checkout-rewrite.md');
    expect(parseFrontmatterBlock(epicEnvelope)).toMatchObject({ type: 'epic', title: 'Checkout rewrite', tracker_id: 'ENG-1' });

    const leaf = await read(initiativeDir, 'epic-checkout-rewrite', file);
    const leafFm = parseFrontmatterBlock(leaf);
    expect(leafFm).toMatchObject({ id, type: 'story', title: 'Add a cart', parent: 'epic-checkout-rewrite', tracker_id: 'ENG-2', remote: 'https://my-team.atlassian.net/browse/ENG-2' });

    const plan = await read(initiativeDir, 'epic-checkout-rewrite', file.replace(/\.md$/, '-plan.md'));
    expect(parseFrontmatterBlock(plan)).toEqual({ title: 'Add a cart', ticket: id, status: 'draft' }); // "To Do" -> draft

    const record = JSON.parse(await read(initiativeDir, 'epic-checkout-rewrite', file.replace(/\.md$/, '.jira-sync.json'))) as JiraSyncRecord;
    expect(record).toMatchObject({ issueKey: 'ENG-2', remote: 'https://my-team.atlassian.net/browse/ENG-2', baseline: { title: 'Add a cart', status: 'To Do' } });
  });

  it('maps a currently in-progress Jira story to the in-progress plan status on first sync', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-3', 'Apply a coupon', 'ENG-1', 'In Progress')];
    const result = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const plan = await read(initiativeDir, result.leaves[0]!.epicSlug, result.leaves[0]!.file.replace(/\.md$/, '-plan.md'));
    expect(parseFrontmatterBlock(plan)).toMatchObject({ status: 'in-progress' });
  });

  it('routes an issue with no parent, or whose parent was not fetched, into the unassigned bucket rather than dropping it', async () => {
    const initiativeDir = tempInitiative();
    const orphan = story('ENG-9', 'A stray task', undefined);
    const orphanedByMissingEpic = story('ENG-10', 'Parent epic not pulled', 'ENG-999');
    const result = await pullJiraIssuesIntoLocalTree([orphan, orphanedByMissingEpic], { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    expect(result.leaves.map((l) => l.epicSlug)).toEqual(['epic-unassigned-jira-issues', 'epic-unassigned-jira-issues']);
    const envelope = await read(initiativeDir, 'epic-unassigned-jira-issues', 'epic-unassigned-jira-issues.md');
    expect(parseFrontmatterBlock(envelope)).toMatchObject({ tracker_id: UNASSIGNED_EPIC_TRACKER_ID });
  });

  it('maps a Bug issue to a bug leaf with severity from its Jira priority', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), bug('ENG-4', 'Cart total is wrong', 'ENG-1', 'Highest')];
    const result = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const leaf = await read(initiativeDir, result.leaves[0]!.epicSlug, result.leaves[0]!.file);
    expect(result.leaves[0]!.file).toMatch(/^bug-/);
    expect(parseFrontmatterBlock(leaf)).toMatchObject({ type: 'bug', severity: 'P0' });
  });

  it('is idempotent: re-syncing the same issues creates nothing new, matched by tracker_id', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const second = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    expect(second.epics).toEqual([{ slug: first.epics[0]!.slug, issueKey: 'ENG-1', created: false }]);
    expect(second.leaves).toEqual([{ ...first.leaves[0]!, created: false }]);
  });

  it('keeps local when both sides changed to different statuses since the baseline, and records the conflict (AD-28; entry 6)', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'To Do')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const epicSlug = first.leaves[0]!.epicSlug;
    const leafFile = first.leaves[0]!.file;
    const planFile = leafFile.replace(/\.md$/, '-plan.md');
    // Simulate local build progress since the first sync (baseline was "To Do" / draft).
    const planText = await read(initiativeDir, epicSlug, planFile);
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, planFile), planText.replace('status: draft', 'status: built'), 'utf8');

    const changed = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'In Progress')];
    const second = await pullJiraIssuesIntoLocalTree(changed, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });

    const planAfter = await read(initiativeDir, epicSlug, planFile);
    expect(parseFrontmatterBlock(planAfter)).toMatchObject({ status: 'built' }); // local wins; UNREACHABLE_JIRA was never actually called
    expect(second.leaves[0]!.conflicts).toEqual(['status']);
    const record = JSON.parse(await read(initiativeDir, epicSlug, leafFile.replace(/\.md$/, '.jira-sync.json'))) as JiraSyncRecord;
    expect(record.conflicts).toEqual([{ field: 'status', local: 'built', jira: 'In Progress', detectedAt: expect.any(String) }]);
    expect(record.baseline.status).toBe('To Do'); // frozen while the conflict is unresolved, not moved to either side
  });

  it('resolves a status conflict to Jira\'s value on an explicit Refresh, when that move is itself forward', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'To Do')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const epicSlug = first.leaves[0]!.epicSlug;
    const planFile = first.leaves[0]!.file.replace(/\.md$/, '-plan.md');
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, planFile), (await read(initiativeDir, epicSlug, planFile)).replace('status: draft', 'status: in-progress'), 'utf8');

    const changed = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'In Review')];
    const second = await pullJiraIssuesIntoLocalTree(changed, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA, isExplicitRefresh: true });

    expect(parseFrontmatterBlock(await read(initiativeDir, epicSlug, planFile))).toMatchObject({ status: 'in-review' });
    expect(second.leaves[0]!.conflicts).toEqual([]);
  });

  it('updates an existing bug\'s severity when Jira\'s priority changes, without touching its id or title', async () => {
    const initiativeDir = tempInitiative();
    const first = [epic('ENG-1', 'Checkout rewrite'), bug('ENG-4', 'Cart total is wrong', 'ENG-1', 'Low')];
    const before = await pullJiraIssuesIntoLocalTree(first, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const changed = [epic('ENG-1', 'Checkout rewrite'), bug('ENG-4', 'Cart total is wrong', 'ENG-1', 'Highest')];
    await pullJiraIssuesIntoLocalTree(changed, { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const leaf = await read(initiativeDir, before.leaves[0]!.epicSlug, before.leaves[0]!.file);
    expect(parseFrontmatterBlock(leaf)).toMatchObject({ id: before.leaves[0]!.id, title: 'Cart total is wrong', severity: 'P0' });
  });

  it('assigns increasing, never-reused ids within one epic as more issues are pulled in over separate syncs', async () => {
    const initiativeDir = tempInitiative();
    await pullJiraIssuesIntoLocalTree([epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'First', 'ENG-1')], { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const second = await pullJiraIssuesIntoLocalTree([epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'First', 'ENG-1'), story('ENG-5', 'Second', 'ENG-1')], { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    const ids = second.leaves.map((l) => l.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
  });

  it('handles an empty issue list without creating anything', async () => {
    const initiativeDir = tempInitiative();
    const result = await pullJiraIssuesIntoLocalTree([], { initiativeDir, siteUrl: 'https://x.atlassian.net', jira: UNREACHABLE_JIRA });
    expect(result).toEqual({ epics: [], leaves: [] });
  });
});

describe('pullJiraIssuesIntoLocalTree: reconciliation pushes and applies against the real fake Jira server', () => {
  it('pushes a local-only title edit to Jira, and updates the baseline to it', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const leafFile = first.leaves[0]!.file;
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, leafFile), (await read(initiativeDir, epicSlug, leafFile)).replace('title: "Add a cart"', 'title: "Add a cart and checkout"'), 'utf8');

    await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira }); // Jira unchanged; local title edited
    expect(server.fieldUpdates).toEqual([{ issueKey: 'ENG-2', fields: { summary: 'Add a cart and checkout' }, at: expect.any(Number) }]);
    const record = JSON.parse(await read(initiativeDir, epicSlug, leafFile.replace(/\.md$/, '.jira-sync.json'))) as JiraSyncRecord;
    expect(record.baseline.title).toBe('Add a cart and checkout');
  });

  it('applies a Jira-only title change locally', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const leafFile = first.leaves[0]!.file;

    server.setIssueField('ENG-2', { summary: 'Renamed directly in Jira' });
    await pullJiraIssuesIntoLocalTree([epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Renamed directly in Jira', 'ENG-1')], { initiativeDir, siteUrl: server.url, jira });
    expect(parseFrontmatterBlock(await read(initiativeDir, epicSlug, leafFile))).toMatchObject({ title: 'Renamed directly in Jira' });
    expect(server.fieldUpdates).toEqual([]); // nothing pushed: Jira alone changed
  });

  it('pushes a local status change to Jira, choosing the matching transition', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const planFile = first.leaves[0]!.file.replace(/\.md$/, '-plan.md');
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, planFile), (await read(initiativeDir, epicSlug, planFile)).replace('status: draft', 'status: in-progress'), 'utf8');

    await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira }); // Jira still "To Do"; local moved to in-progress
    expect(server.transitions).toEqual([{ issueKey: 'ENG-2', transitionId: '11', at: expect.any(Number) }]); // "Start Progress" -> In Progress
  });

  it('applies a Jira-only status change locally', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const planFile = first.leaves[0]!.file.replace(/\.md$/, '-plan.md');

    const changed = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'In Progress')];
    await pullJiraIssuesIntoLocalTree(changed, { initiativeDir, siteUrl: server.url, jira });
    expect(parseFrontmatterBlock(await read(initiativeDir, epicSlug, planFile))).toMatchObject({ status: 'in-progress' });
    expect(server.transitions).toEqual([]); // nothing pushed: Jira alone changed
  });

  it('never pulls a Jira done-equivalent status automatically, even via this full sync path (AD-28\'s exception)', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'In Progress' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'In Progress')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const planFile = first.leaves[0]!.file.replace(/\.md$/, '-plan.md');

    const done = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'Done')];
    const second = await pullJiraIssuesIntoLocalTree(done, { initiativeDir, siteUrl: server.url, jira, isExplicitRefresh: true }); // even on explicit Refresh
    expect(parseFrontmatterBlock(await read(initiativeDir, epicSlug, planFile))).toMatchObject({ status: 'in-progress' });
    expect(second.leaves[0]!.conflicts).toEqual(['status']);
  });

  it('converges quietly with no push when both sides land on the same new title independently', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const leafFile = first.leaves[0]!.file;
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, leafFile), (await read(initiativeDir, epicSlug, leafFile)).replace('title: "Add a cart"', 'title: "Add a cart, matching Jira"'), 'utf8');

    const second = await pullJiraIssuesIntoLocalTree([epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart, matching Jira', 'ENG-1')], { initiativeDir, siteUrl: server.url, jira });
    expect(server.fieldUpdates).toEqual([]);
    expect(second.leaves[0]!.conflicts).toEqual([]);
  });
});

describe('pullJiraIssuesIntoLocalTree: after -> Jira Issue Links, one-way (AD-28)', () => {
  it('pushes a new sibling after entry as an "is blocked by" link, once, never re-pushing it', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({
      issues: [
        { key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } },
        { key: 'ENG-2', fields: { summary: 'Scaffold', status: { name: 'Done' } } },
        { key: 'ENG-3', fields: { summary: 'Build on the scaffold', status: { name: 'To Do' } } },
      ],
    });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Scaffold', 'ENG-1'), story('ENG-3', 'Build on the scaffold', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const scaffoldId = first.leaves.find((l) => l.issueKey === 'ENG-2')!.id;
    const dependentFile = first.leaves.find((l) => l.issueKey === 'ENG-3')!.file;

    // A human or an agent adds the local prerequisite after first sync.
    const text = await read(initiativeDir, epicSlug, dependentFile);
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, dependentFile), text.replace('after: []', `after: [${scaffoldId}]`), 'utf8');

    await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    expect(server.issueLinks).toEqual([{ type: 'Blocks', inward: 'ENG-3', outward: 'ENG-2', at: expect.any(Number) }]);

    // A second sync with nothing new in `after` never re-pushes the same link.
    await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    expect(server.issueLinks).toHaveLength(1);
  });

  it('skips a prerequisite that is not itself Jira-sourced, rather than guessing', async () => {
    const initiativeDir = tempInitiative();
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'Checkout rewrite', status: { name: 'In Progress' } } }, { key: 'ENG-2', fields: { summary: 'Add a cart', status: { name: 'To Do' } } }] });
    const jira = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    const epicSlug = first.leaves[0]!.epicSlug;
    const leafFile = first.leaves[0]!.file;
    const text = await read(initiativeDir, epicSlug, leafFile);
    // Prerequisite id 99 names no leaf in this folder at all (a local-only ticket, or simply made up).
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, epicSlug, leafFile), text.replace('after: []', 'after: [99]'), 'utf8');

    await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: server.url, jira });
    expect(server.issueLinks).toEqual([]);
  });
});
