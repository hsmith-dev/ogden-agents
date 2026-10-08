/**
 * Writes a Jira board's issues into BMad's real on-disk ticket tree (epic
 * 18 story 5; AD-28, AD-27's "a tracker-known ticket not yet in the tree
 * gets its file at first query" convention). No `tickets.toml` entry is
 * needed for a Jira-sourced ticket: `tickets.py`'s own `load_folder` already
 * treats a leaf `.md` file with no breakdown entry as an "unlisted" ticket
 * and reads it just the same (confirmed against `_bmad/method/scripts/tickets.py`
 * directly), so this module only ever creates epic envelopes and leaf +
 * plan files, never a breakdown table — one entire layer of bookkeeping
 * this epic's early design assumed turns out not to be needed.
 *
 * A ticket is matched across syncs by `tracker_id` in its frontmatter
 * (BMad's own existing tracker convention), never by title or slug, so a
 * renamed Jira issue updates in place rather than duplicating.
 *
 * This module only ever *creates* local files or refreshes the
 * Jira-owns-this-after-creation display fields (`parent`, assignee,
 * severity) on an existing one. It never touches an existing ticket's
 * `status` — reconciling a pulled status against a ticket that already
 * has one, including the conflict rule and the `done` exception, is
 * entry 6's job, so first-sync creation (where there is no existing
 * status to protect) is the only place this module sets one.
 *
 * The sync baseline (AD-28: "kept beside the ticket's own plan file") is a
 * separate `<leaf stem>.jira-sync.json` file, deliberately not more
 * frontmatter fields on the plan: `tickets.py mark` and a human-run
 * `bmad-build` both only ever touch the plan's own known fields (title,
 * ticket, status, assignee, blocked_at, blocked_reason) when one already
 * exists, but `bmad-build`'s *own* plan template, if someone runs it
 * against one of these tickets, would happily overwrite the whole file
 * with its own richer shape — a separate file avoids that collision
 * entirely rather than hoping it never happens.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bodyAfterFrontmatter, parseFrontmatterBlock, writeFrontmatterBlock } from './bmad-frontmatter.js';
import { isEpicIssueType, mapIssueTypeToLeaf, mapJiraStatusToBmad, mapPriorityToSeverity, plainTextFromDescription, titleSlug, type JiraIssue } from './jira-issue-mapping.js';

/** The epic folder Jira issues with no recognized parent epic land in, so nothing is ever silently dropped. */
export const UNASSIGNED_EPIC_TRACKER_ID = '__jira-unassigned__';
const UNASSIGNED_EPIC_SLUG = 'epic-unassigned-jira-issues';
const UNASSIGNED_EPIC_TITLE = 'Unassigned Jira issues';

/** The sync baseline kept beside a synced ticket (AD-28), as its own file — see this module's header comment for why not more plan frontmatter. */
export interface JiraSyncRecord {
  issueKey: string;
  remote: string;
  /** Each two-way field's value as of the last successful sync (AD-28's conflict rule compares against this). */
  baseline: { title: string; body: string; status: string };
  syncedAt: string;
}

export interface PullOptions {
  /** Absolute path to the active initiative's folder (`_bmad-output/<initiative>`). */
  initiativeDir: string;
  /** The linked board's site URL, for building each issue's `remote` link (`<siteUrl>/browse/<key>`). */
  siteUrl: string;
  now?: () => Date;
}

export interface SyncedLeafResult {
  epicSlug: string;
  file: string;
  id: number;
  issueKey: string;
  created: boolean;
}

export interface SyncedEpicResult {
  slug: string;
  issueKey: string;
  created: boolean;
}

export interface PullResult {
  epics: SyncedEpicResult[];
  leaves: SyncedLeafResult[];
}

async function listDirs(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function readTrackerIdOf(filePath: string): Promise<string | undefined> {
  try {
    const text = await readFile(filePath, 'utf8');
    const fm = parseFrontmatterBlock(text);
    const trackerId = fm.tracker_id;
    return typeof trackerId === 'string' && trackerId !== '' ? trackerId : undefined;
  } catch {
    return undefined;
  }
}

/** Every `epic-*` folder in the initiative that has its own envelope file. */
async function epicFolders(initiativeDir: string): Promise<string[]> {
  const dirs = await listDirs(initiativeDir);
  const out: string[] = [];
  for (const slug of dirs) {
    if (!slug.startsWith('epic-')) continue;
    try {
      await readFile(join(initiativeDir, slug, `${slug}.md`), 'utf8');
      out.push(slug);
    } catch {
      // not an epic folder (no envelope yet) - skip
    }
  }
  return out;
}

/** The epic folder whose envelope's `tracker_id` matches, or `undefined`. */
async function findEpicFolderByTrackerId(initiativeDir: string, trackerId: string): Promise<string | undefined> {
  for (const slug of await epicFolders(initiativeDir)) {
    const found = await readTrackerIdOf(join(initiativeDir, slug, `${slug}.md`));
    if (found === trackerId) return slug;
  }
  return undefined;
}

/** A slug for a new epic folder that does not already exist, from the issue's title; falls back to a key-suffixed slug on collision (a different epic already took the plain title slug). */
async function freeEpicSlug(initiativeDir: string, title: string, issueKey: string): Promise<string> {
  const base = `epic-${titleSlug(title)}`;
  const existing = new Set(await listDirs(initiativeDir));
  if (!existing.has(base)) return base;
  return `${base}-${titleSlug(issueKey)}`;
}

async function writeEpicEnvelope(initiativeDir: string, slug: string, issue: JiraIssue): Promise<void> {
  const epicDir = join(initiativeDir, slug);
  await mkdir(epicDir, { recursive: true });
  const frontmatter = writeFrontmatterBlock([
    ['type', 'epic'],
    ['title', issue.fields.summary],
    ['parent', initiativeDir.split(/[/\\]/).pop() ?? ''],
    ['tracker_id', issue.key],
    ['covers', []],
  ]);
  const body = `\n# ${issue.fields.summary}\n\n## Description\n\n${plainTextFromDescription(issue.fields.description) || '(No description in Jira.)'}\n`;
  await writeFile(join(epicDir, `${slug}.md`), frontmatter + body, 'utf8');
}

/** Finds, or creates, the local epic folder for `issue` (a Jira "Epic" issue). Resolves to its slug and whether it was just created. */
async function ensureEpicFolder(initiativeDir: string, issue: JiraIssue): Promise<SyncedEpicResult> {
  const existing = await findEpicFolderByTrackerId(initiativeDir, issue.key);
  if (existing !== undefined) return { slug: existing, issueKey: issue.key, created: false };
  const slug = await freeEpicSlug(initiativeDir, issue.fields.summary, issue.key);
  await writeEpicEnvelope(initiativeDir, slug, issue);
  return { slug, issueKey: issue.key, created: true };
}

/** The one default-bucket epic folder for issues with no recognized parent epic; created once, reused forever (matched by its own sentinel tracker id). */
async function ensureUnassignedEpicFolder(initiativeDir: string): Promise<string> {
  const existing = await findEpicFolderByTrackerId(initiativeDir, UNASSIGNED_EPIC_TRACKER_ID);
  if (existing !== undefined) return existing;
  const slug = (await listDirs(initiativeDir)).includes(UNASSIGNED_EPIC_SLUG) ? `${UNASSIGNED_EPIC_SLUG}-2` : UNASSIGNED_EPIC_SLUG;
  const epicDir = join(initiativeDir, slug);
  await mkdir(epicDir, { recursive: true });
  const frontmatter = writeFrontmatterBlock([
    ['type', 'epic'],
    ['title', UNASSIGNED_EPIC_TITLE],
    ['parent', initiativeDir.split(/[/\\]/).pop() ?? ''],
    ['tracker_id', UNASSIGNED_EPIC_TRACKER_ID],
    ['covers', []],
  ]);
  const body = `\n# ${UNASSIGNED_EPIC_TITLE}\n\n## Description\n\nIssues from the linked Jira board with no epic link, or whose epic was not itself pulled in yet.\n`;
  await writeFile(join(epicDir, `${slug}.md`), frontmatter + body, 'utf8');
  return slug;
}

const LEAF_NAME_RE = /^(story|spike|bug)-.+\.md$/;

/** The leaf file in `epicDir` whose `tracker_id` matches, and its `id`, or `undefined`. */
async function findLeafByTrackerId(epicDir: string, trackerId: string): Promise<{ file: string; id: number } | undefined> {
  for (const file of await listFiles(epicDir)) {
    if (!LEAF_NAME_RE.test(file)) continue;
    const text = await readFile(join(epicDir, file), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const fm = parseFrontmatterBlock(text);
    if (fm.tracker_id === trackerId) {
      const id = fm.id;
      return { file, id: typeof id === 'number' ? id : 0 };
    }
  }
  return undefined;
}

/** One past the highest `id` any leaf file in `epicDir` already uses (1 if there are none), so an id is never reused. */
async function nextLocalId(epicDir: string): Promise<number> {
  let highest = 0;
  for (const file of await listFiles(epicDir)) {
    if (!LEAF_NAME_RE.test(file)) continue;
    const text = await readFile(join(epicDir, file), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const id = parseFrontmatterBlock(text).id;
    if (typeof id === 'number' && id > highest) highest = id;
  }
  return highest + 1;
}

function remoteLinkOf(siteUrl: string, issueKey: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/browse/${issueKey}`;
}

/** A free leaf filename for `issue` in `epicDir`: `<type>-<slug>.md`, suffixed with the issue key on a name collision with an unrelated ticket. */
async function freeLeafFile(epicDir: string, leafType: 'story' | 'bug', title: string, issueKey: string): Promise<string> {
  const base = `${leafType}-${titleSlug(title)}.md`;
  const existing = new Set(await listFiles(epicDir));
  if (!existing.has(base)) return base;
  return `${leafType}-${titleSlug(title)}-${titleSlug(issueKey)}.md`;
}

async function writeNewLeafAndPlan(epicDir: string, epicSlug: string, issue: JiraIssue, options: PullOptions): Promise<SyncedLeafResult> {
  const leafType = mapIssueTypeToLeaf(issue.fields.issuetype?.name);
  const id = await nextLocalId(epicDir);
  const file = await freeLeafFile(epicDir, leafType, issue.fields.summary, issue.key);
  const remote = remoteLinkOf(options.siteUrl, issue.key);
  const body = plainTextFromDescription(issue.fields.description);
  const severity = leafType === 'bug' ? mapPriorityToSeverity(issue.fields.priority?.name) : undefined;
  const leafFrontmatter = writeFrontmatterBlock([
    ['id', id],
    ['type', leafType],
    ['title', issue.fields.summary],
    ['parent', epicSlug],
    ['tracker_id', issue.key],
    ['remote', remote],
    ['after', []],
    ['hitl', false],
    ...(severity === undefined ? [] : ([['severity', severity]] as const)),
  ]);
  const leafBody = `\n# ${issue.fields.summary}\n\n## Description\n\n${body || '(No description in Jira.)'}\n\n## Acceptance Criteria\n\nVerify: synced from Jira issue ${issue.key}; see ${remote} for the source of truth.\n\n## References\n\n- parent — ${epicSlug}\n`;
  await writeFile(join(epicDir, file), leafFrontmatter + leafBody, 'utf8');

  const { status } = mapJiraStatusToBmad(issue.fields.status.name);
  const stem = file.slice(0, -3);
  const assignee = issue.fields.assignee?.displayName ?? '';
  const planFrontmatter = writeFrontmatterBlock([
    ['title', issue.fields.summary],
    ['ticket', id],
    ['status', status],
    ...(assignee === '' ? [] : ([['assignee', assignee]] as const)),
  ]);
  await writeFile(join(epicDir, `${stem}-plan.md`), planFrontmatter, 'utf8');

  const now = (options.now ?? (() => new Date()))();
  const record: JiraSyncRecord = { issueKey: issue.key, remote, baseline: { title: issue.fields.summary, body, status: issue.fields.status.name }, syncedAt: now.toISOString() };
  await writeFile(join(epicDir, `${stem}.jira-sync.json`), JSON.stringify(record, null, 2), 'utf8');

  return { epicSlug, file, id, issueKey: issue.key, created: true };
}

/** Refreshes only the Jira-to-local-only, "Jira owns it after creation" display fields on an already-existing leaf (`parent`'s epic, if it moved; this adapter never reparents across epics per AD-28, so this is a no-op across epics in practice — only within-folder metadata). Never touches `status`, `title`, or `body`: that reconciliation, with the conflict rule, is entry 6's. */
async function refreshExistingLeaf(epicDir: string, leaf: { file: string; id: number }, issue: JiraIssue): Promise<void> {
  const leafType = mapIssueTypeToLeaf(issue.fields.issuetype?.name);
  const severity = leafType === 'bug' ? mapPriorityToSeverity(issue.fields.priority?.name) : undefined;
  if (severity === undefined) return;
  const path = join(epicDir, leaf.file);
  const text = await readFile(path, 'utf8');
  const fm = parseFrontmatterBlock(text);
  if (fm.severity === severity) return; // AD-28: Jira owns severity after creation, but only writing on an actual change
  const updated = writeFrontmatterBlock([
    ['id', leaf.id],
    ['type', fm.type as string],
    ['title', fm.title as string],
    ['parent', fm.parent as string],
    ['tracker_id', fm.tracker_id as string],
    ['remote', fm.remote as string],
    ['after', (fm.after as string[]) ?? []],
    ['hitl', Boolean(fm.hitl)],
    ['severity', severity],
  ]);
  await writeFile(path, updated + bodyAfterFrontmatter(text), 'utf8');
}

/**
 * Pulls `issues` into `options.initiativeDir`'s real BMad ticket tree:
 * every Jira "Epic" issue gets (or already has) its own `epic-*` folder;
 * every other issue gets (or already has) a leaf + plan file under its
 * epic's folder (or the unassigned bucket). A ticket already known
 * locally (matched by `tracker_id`) is left with its status untouched —
 * only a brand-new one gets one, mapped from Jira's current status.
 */
export async function pullJiraIssuesIntoLocalTree(issues: readonly JiraIssue[], options: PullOptions): Promise<PullResult> {
  const epicIssues = issues.filter((issue) => isEpicIssueType(issue.fields.issuetype?.name));
  const leafIssues = issues.filter((issue) => !isEpicIssueType(issue.fields.issuetype?.name));

  const epics: SyncedEpicResult[] = [];
  const epicSlugByKey = new Map<string, string>();
  for (const issue of epicIssues) {
    const result = await ensureEpicFolder(options.initiativeDir, issue);
    epics.push(result);
    epicSlugByKey.set(issue.key, result.slug);
  }

  let unassignedSlug: string | undefined;
  const leaves: SyncedLeafResult[] = [];
  for (const issue of leafIssues) {
    const parentKey = issue.fields.parent?.key;
    let epicSlug = parentKey === undefined ? undefined : epicSlugByKey.get(parentKey);
    if (epicSlug === undefined) {
      // The parent wasn't among the epics this sync fetched (not yet pulled, or genuinely has none): never dropped.
      unassignedSlug ??= await ensureUnassignedEpicFolder(options.initiativeDir);
      epicSlug = unassignedSlug;
    }
    const epicDir = join(options.initiativeDir, epicSlug);
    const existing = await findLeafByTrackerId(epicDir, issue.key);
    if (existing === undefined) {
      leaves.push(await writeNewLeafAndPlan(epicDir, epicSlug, issue, options));
    } else {
      await refreshExistingLeaf(epicDir, existing, issue);
      leaves.push({ epicSlug, file: existing.file, id: existing.id, issueKey: issue.key, created: false });
    }
  }

  return { epics, leaves };
}
