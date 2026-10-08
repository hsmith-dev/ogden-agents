/**
 * Writing a Jira board's issues into BMad's real on-disk ticket tree (epic
 * 18 story 5; AD-28, AD-27). No test reaches the network; everything
 * writes to a fresh temp directory removed after each test.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseFrontmatterBlock } from '../src/tickets-jira/bmad-frontmatter.js';
import { pullJiraIssuesIntoLocalTree, UNASSIGNED_EPIC_TRACKER_ID, type JiraSyncRecord } from '../src/tickets-jira/local-ticket-tree.js';
import type { JiraIssue } from '../src/tickets-jira/jira-issue-mapping.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

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

describe('pullJiraIssuesIntoLocalTree', () => {
  it('creates an epic folder and a leaf + plan + sync record for a story under it', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const result = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://my-team.atlassian.net' });

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
    const result = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const plan = await read(initiativeDir, result.leaves[0]!.epicSlug, result.leaves[0]!.file.replace(/\.md$/, '-plan.md'));
    expect(parseFrontmatterBlock(plan)).toMatchObject({ status: 'in-progress' });
  });

  it('routes an issue with no parent, or whose parent was not fetched, into the unassigned bucket rather than dropping it', async () => {
    const initiativeDir = tempInitiative();
    const orphan = story('ENG-9', 'A stray task', undefined);
    const orphanedByMissingEpic = story('ENG-10', 'Parent epic not pulled', 'ENG-999');
    const result = await pullJiraIssuesIntoLocalTree([orphan, orphanedByMissingEpic], { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    expect(result.leaves.map((l) => l.epicSlug)).toEqual(['epic-unassigned-jira-issues', 'epic-unassigned-jira-issues']);
    const envelope = await read(initiativeDir, 'epic-unassigned-jira-issues', 'epic-unassigned-jira-issues.md');
    expect(parseFrontmatterBlock(envelope)).toMatchObject({ tracker_id: UNASSIGNED_EPIC_TRACKER_ID });
  });

  it('maps a Bug issue to a bug leaf with severity from its Jira priority', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), bug('ENG-4', 'Cart total is wrong', 'ENG-1', 'Highest')];
    const result = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const leaf = await read(initiativeDir, result.leaves[0]!.epicSlug, result.leaves[0]!.file);
    expect(result.leaves[0]!.file).toMatch(/^bug-/);
    expect(parseFrontmatterBlock(leaf)).toMatchObject({ type: 'bug', severity: 'P0' });
  });

  it('is idempotent: re-syncing the same issues creates nothing new, matched by tracker_id', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const second = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    expect(second.epics).toEqual([{ slug: first.epics[0]!.slug, issueKey: 'ENG-1', created: false }]);
    expect(second.leaves).toEqual([{ ...first.leaves[0]!, created: false }]);
  });

  it('never overwrites an existing ticket\'s status on re-sync, even if Jira\'s status changed (entry 6\'s job)', async () => {
    const initiativeDir = tempInitiative();
    const issues = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'To Do')];
    const first = await pullJiraIssuesIntoLocalTree(issues, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const planPath = ['', first.leaves[0]!.epicSlug, first.leaves[0]!.file.replace(/\.md$/, '-plan.md')] as const;
    // Simulate local build progress since the first sync.
    const planText = await read(initiativeDir, ...planPath.slice(1));
    await (await import('node:fs/promises')).writeFile(join(initiativeDir, ...planPath.slice(1)), planText.replace('status: draft', 'status: built'), 'utf8');

    const changed = [epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'Add a cart', 'ENG-1', 'In Progress')];
    await pullJiraIssuesIntoLocalTree(changed, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const planAfter = await read(initiativeDir, ...planPath.slice(1));
    expect(parseFrontmatterBlock(planAfter)).toMatchObject({ status: 'built' });
  });

  it('updates an existing bug\'s severity when Jira\'s priority changes, without touching its id or title', async () => {
    const initiativeDir = tempInitiative();
    const first = [epic('ENG-1', 'Checkout rewrite'), bug('ENG-4', 'Cart total is wrong', 'ENG-1', 'Low')];
    const before = await pullJiraIssuesIntoLocalTree(first, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const changed = [epic('ENG-1', 'Checkout rewrite'), bug('ENG-4', 'Cart total is wrong', 'ENG-1', 'Highest')];
    await pullJiraIssuesIntoLocalTree(changed, { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const leaf = await read(initiativeDir, before.leaves[0]!.epicSlug, before.leaves[0]!.file);
    expect(parseFrontmatterBlock(leaf)).toMatchObject({ id: before.leaves[0]!.id, title: 'Cart total is wrong', severity: 'P0' });
  });

  it('assigns increasing, never-reused ids within one epic as more issues are pulled in over separate syncs', async () => {
    const initiativeDir = tempInitiative();
    await pullJiraIssuesIntoLocalTree([epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'First', 'ENG-1')], { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const second = await pullJiraIssuesIntoLocalTree([epic('ENG-1', 'Checkout rewrite'), story('ENG-2', 'First', 'ENG-1'), story('ENG-5', 'Second', 'ENG-1')], { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    const ids = second.leaves.map((l) => l.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
  });

  it('handles an empty issue list without creating anything', async () => {
    const initiativeDir = tempInitiative();
    const result = await pullJiraIssuesIntoLocalTree([], { initiativeDir, siteUrl: 'https://x.atlassian.net' });
    expect(result).toEqual({ epics: [], leaves: [] });
  });
});
