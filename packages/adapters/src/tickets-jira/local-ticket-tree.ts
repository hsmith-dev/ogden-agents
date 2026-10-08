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
 * For a ticket that already exists locally (story 6), this module
 * reconciles `title`, body (`## Description`), and `status` against the
 * stored baseline and the ticket's current local values
 * (`conflict-resolution.ts`'s `reconcileField`/`reconcileStatus`): a field
 * changed on exactly one side is applied (Jira changed) or pushed back to
 * Jira (local changed); a genuine two-sided conflict keeps local and is
 * recorded, resolving to Jira's value only on an explicit Refresh; `done`
 * is never pulled automatically regardless (AD-28's own exception).
 * `severity` stays Jira-to-local-only and conflict-free, as entry 5 built
 * it.
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
import type { TicketStatus } from '@ogden-agents/shared';
import { bodyAfterFrontmatter, parseFrontmatterBlock, setFrontmatterField, writeFrontmatterBlock } from './bmad-frontmatter.js';
import { type ConflictField, reconcileField, reconcileStatus } from './conflict-resolution.js';
import type { JiraCallOptions } from './jira-client.js';
import { linkIsBlockedBy, listTransitions, transitionIssue, updateIssueFields } from './jira-client.js';
import { candidateJiraStatusNames, chooseTransition, isEpicIssueType, mapIssueTypeToLeaf, mapJiraStatusToBmad, mapPriorityToSeverity, plainTextFromDescription, titleSlug, type JiraIssue } from './jira-issue-mapping.js';

/** The epic folder Jira issues with no recognized parent epic land in, so nothing is ever silently dropped. */
export const UNASSIGNED_EPIC_TRACKER_ID = '__jira-unassigned__';
const UNASSIGNED_EPIC_SLUG = 'epic-unassigned-jira-issues';
const UNASSIGNED_EPIC_TITLE = 'Unassigned Jira issues';

/** One active conflict on a synced ticket (AD-28): both sides changed a field to different values since the last successful sync. Kept in the sync record until the next sync resolves it (an explicit Refresh adopting Jira's value, or either side coming to match the other). */
export interface JiraConflict {
  field: ConflictField;
  local: string;
  jira: string;
  detectedAt: string;
}

/** The sync baseline kept beside a synced ticket (AD-28), as its own file — see this module's header comment for why not more plan frontmatter. */
export interface JiraSyncRecord {
  issueKey: string;
  remote: string;
  /** Each two-way field's value as of the last successful sync (AD-28's conflict rule compares against this). Frozen at whatever it was while a field is in conflict (see this module's reconciliation logic). */
  baseline: { title: string; body: string; status: string };
  syncedAt: string;
  /** Active conflicts, if any (AD-28): never auto-merged, shown to the user, cleared once resolved. */
  conflicts: JiraConflict[];
  /** Local `after` entries (as written in the leaf's own frontmatter) already pushed as "is blocked by" Issue Links (AD-28: local → Jira only, never read back, never re-pushed once sent). */
  pushedAfter: string[];
}

export interface PullOptions {
  /** Absolute path to the active initiative's folder (`_bmad-output/<initiative>`). */
  initiativeDir: string;
  /** The linked board's site URL, for building each issue's `remote` link (`<siteUrl>/browse/<key>`). */
  siteUrl: string;
  /** The board's resolved API base URL and credential (AD-29); needed to push a local-only change back to Jira (AD-28). Reusing the same shape `createTicketsJira` takes. */
  jira: JiraCallOptions;
  /**
   * Whether this sync was triggered by the user's explicit Refresh, as
   * opposed to the background poll (AD-27/AD-28): the one case a genuine
   * two-sided conflict resolves to Jira's value instead of staying a
   * conflict. Default `false` (treat as the background poll — the safer
   * default when a caller forgets to say).
   */
  isExplicitRefresh?: boolean;
  now?: () => Date;
}

export interface SyncedLeafResult {
  epicSlug: string;
  file: string;
  id: number;
  issueKey: string;
  created: boolean;
  /** Fields with an active conflict after this sync (empty for a newly created ticket, which has nothing to conflict with yet). */
  conflicts: ConflictField[];
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
  const record: JiraSyncRecord = { issueKey: issue.key, remote, baseline: { title: issue.fields.summary, body, status: issue.fields.status.name }, syncedAt: now.toISOString(), conflicts: [], pushedAfter: [] };
  await writeFile(join(epicDir, `${stem}.jira-sync.json`), JSON.stringify(record, null, 2), 'utf8');

  return { epicSlug, file, id, issueKey: issue.key, created: true, conflicts: [] };
}

function syncRecordPath(epicDir: string, leafFile: string): string {
  return join(epicDir, `${leafFile.slice(0, -3)}.jira-sync.json`);
}

/** The existing sync record for a leaf, or `undefined` if none exists yet (a ticket synced before this adapter tracked baselines, or one whose record was lost) — never thrown: the caller treats a missing record as "nothing to compare against yet". */
async function readSyncRecord(epicDir: string, leafFile: string): Promise<JiraSyncRecord | undefined> {
  try {
    const text = await readFile(syncRecordPath(epicDir, leafFile), 'utf8');
    const parsed = JSON.parse(text) as Partial<JiraSyncRecord>;
    return { issueKey: parsed.issueKey ?? '', remote: parsed.remote ?? '', baseline: parsed.baseline ?? { title: '', body: '', status: '' }, syncedAt: parsed.syncedAt ?? '', conflicts: parsed.conflicts ?? [], pushedAfter: parsed.pushedAfter ?? [] };
  } catch {
    return undefined;
  }
}

/** The leaf's current title and plan status, and the description section's current plain text, read fresh (never from a cache) so reconciliation always compares against what's on disk right now. */
async function readCurrentLocal(epicDir: string, leafFile: string): Promise<{ title: string; body: string; status: TicketStatus }> {
  const leafText = await readFile(join(epicDir, leafFile), 'utf8');
  const leafFm = parseFrontmatterBlock(leafText);
  const title = typeof leafFm.title === 'string' ? leafFm.title : '';
  const descriptionMatch = /## Description\n\n([\s\S]*?)\n\n## /.exec(bodyAfterFrontmatter(leafText));
  const body = descriptionMatch?.[1] === '(No description in Jira.)' ? '' : (descriptionMatch?.[1] ?? '');
  const planText = await readFile(join(epicDir, `${leafFile.slice(0, -3)}-plan.md`), 'utf8').catch(() => '');
  const planFm = parseFrontmatterBlock(planText);
  const status = (typeof planFm.status === 'string' ? planFm.status : 'draft') as TicketStatus;
  return { title, body, status };
}

/** Pushes `status` to Jira, matching one of the board's own available transitions (never forced, AD-28); silent (not an error) when none matches. */
async function pushStatusToJira(jira: JiraCallOptions, issueKey: string, status: TicketStatus): Promise<void> {
  const transitions = await listTransitions(jira, issueKey);
  const transition = chooseTransition(transitions, status);
  if (transition !== undefined) await transitionIssue(jira, issueKey, transition.id);
}

/** Refreshes the Jira-to-local-only, "Jira owns it after creation" display field (`severity`, bugs only) on an already-existing leaf. Writing a field in the frontmatter block without disturbing the body or any other field. */
async function refreshSeverity(epicDir: string, leaf: { file: string; id: number }, issue: JiraIssue): Promise<void> {
  const leafType = mapIssueTypeToLeaf(issue.fields.issuetype?.name);
  const severity = leafType === 'bug' ? mapPriorityToSeverity(issue.fields.priority?.name) : undefined;
  if (severity === undefined) return;
  const path = join(epicDir, leaf.file);
  const text = await readFile(path, 'utf8');
  const fm = parseFrontmatterBlock(text);
  if (fm.severity === severity) return; // AD-28: Jira owns severity after creation, but only writing on an actual change
  await writeFile(path, setFrontmatterField(text, 'severity', severity), 'utf8');
}

/** Replaces the leaf's `## Description` section body with `newBody`, touching nothing else in the file. */
async function writeDescriptionSection(epicDir: string, leafFile: string, newBody: string): Promise<void> {
  const path = join(epicDir, leafFile);
  const text = await readFile(path, 'utf8');
  const replaced = text.replace(/(## Description\n\n)[\s\S]*?(\n\n## )/, `$1${newBody || '(No description in Jira.)'}$2`);
  await writeFile(path, replaced, 'utf8');
}

/**
 * Pushes any of the leaf's current `after` entries not yet sent as an
 * Issue Link (AD-28: `after` flows local → Jira only, never read back,
 * and once pushed is never un-pushed or re-read). Only a plain sibling
 * id (a number, resolved within the same epic folder) is resolved to a
 * Jira key; a cross-epic reference (`"<epic>.<id>"`) or a prerequisite
 * that is not itself Jira-sourced has nothing to link and is skipped —
 * stated as a known limitation, not silently guessed around. Returns the
 * full, updated set of pushed `after` entries (as strings, to match the
 * leaf's own frontmatter representation).
 */
async function trackerIdOfLocalId(epicDir: string, id: number): Promise<string | undefined> {
  for (const file of await listFiles(epicDir)) {
    if (!LEAF_NAME_RE.test(file)) continue;
    const text = await readFile(join(epicDir, file), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const fm = parseFrontmatterBlock(text);
    if (fm.id === id) return typeof fm.tracker_id === 'string' && fm.tracker_id !== '' ? fm.tracker_id : undefined;
  }
  return undefined;
}

async function pushNewAfterLinks(epicDir: string, issue: JiraIssue, currentAfter: readonly (string | number)[], alreadyPushed: readonly string[], jira: JiraCallOptions): Promise<string[]> {
  const pushed = new Set(alreadyPushed);
  for (const entry of currentAfter) {
    const key = String(entry);
    if (pushed.has(key)) continue;
    if (typeof entry !== 'number') continue; // a cross-epic "<epic>.<id>" ref: not resolved here, see this function's doc comment
    const prerequisiteTrackerId = await trackerIdOfLocalId(epicDir, entry);
    if (prerequisiteTrackerId === undefined) continue; // the prerequisite isn't Jira-sourced: nothing to link
    await linkIsBlockedBy(jira, issue.key, prerequisiteTrackerId);
    pushed.add(key);
  }
  return [...pushed];
}

/**
 * Reconciles an already-known ticket against this sync's fresh Jira read
 * (AD-28; entry 6, on top of entry 5's creation-only path): compares
 * title, body, and status against the stored baseline and the ticket's
 * current local values, applying, pushing, or recording a conflict per
 * field exactly as {@link reconcileField}/{@link reconcileStatus} decide,
 * then writes the new baseline. `severity` stays Jira-to-local-only and
 * conflict-free, unchanged from entry 5. Never touches `type` (set once
 * at creation, AD-28) or reparents across epics (this adapter never
 * does, by design).
 */
async function reconcileExistingLeaf(epicDir: string, leaf: { file: string; id: number }, issue: JiraIssue, options: PullOptions): Promise<ConflictField[]> {
  await refreshSeverity(epicDir, leaf, issue);

  const record = await readSyncRecord(epicDir, leaf.file);
  const current = await readCurrentLocal(epicDir, leaf.file);
  const jiraTitle = issue.fields.summary;
  const jiraBody = plainTextFromDescription(issue.fields.description);
  const jiraStatusName = issue.fields.status.name;
  const isExplicitRefresh = options.isExplicitRefresh ?? false;

  // No prior record (a ticket synced before this adapter tracked baselines, or a lost file): treat Jira's current
  // values as the starting baseline rather than forcing a conflict against nothing, and leave local untouched this once.
  const baseline = record?.baseline ?? { title: jiraTitle, body: jiraBody, status: jiraStatusName };

  const titleOutcome = reconcileField(baseline.title, current.title, jiraTitle, isExplicitRefresh);
  const bodyOutcome = reconcileField(baseline.body, current.body, jiraBody, isExplicitRefresh);
  const statusOutcome = reconcileStatus(baseline.status, current.status, jiraStatusName, isExplicitRefresh);

  const leafPath = join(epicDir, leaf.file);
  if (titleOutcome.action === 'apply') await writeFile(leafPath, setFrontmatterField(await readFile(leafPath, 'utf8'), 'title', titleOutcome.value), 'utf8');
  else if (titleOutcome.action === 'push') await updateIssueFields(options.jira, issue.key, { summary: titleOutcome.value });

  if (bodyOutcome.action === 'apply') await writeDescriptionSection(epicDir, leaf.file, bodyOutcome.value);
  else if (bodyOutcome.action === 'push') await updateIssueFields(options.jira, issue.key, { description: bodyOutcome.value });

  const planPath = join(epicDir, `${leaf.file.slice(0, -3)}-plan.md`);
  if (statusOutcome.action === 'apply') await writeFile(planPath, setFrontmatterField(await readFile(planPath, 'utf8'), 'status', statusOutcome.value), 'utf8');
  else if (statusOutcome.action === 'push') await pushStatusToJira(options.jira, issue.key, statusOutcome.value);

  // after/prerequisites: local -> Jira only, never read back (AD-28). Whatever the leaf's frontmatter has now that
  // was not already pushed goes out as an "is blocked by" Issue Link; already-pushed entries are never re-sent.
  const currentAfter = (parseFrontmatterBlock(await readFile(leafPath, 'utf8')).after as (string | number)[] | undefined) ?? [];
  const pushedAfter = await pushNewAfterLinks(epicDir, issue, currentAfter, record?.pushedAfter ?? [], options.jira);

  const conflicts: JiraConflict[] = [];
  const now = (options.now ?? (() => new Date()))().toISOString();
  if (titleOutcome.action === 'conflict' && titleOutcome.conflict) conflicts.push({ field: 'title', local: titleOutcome.conflict.local, jira: titleOutcome.conflict.jira, detectedAt: now });
  if (bodyOutcome.action === 'conflict' && bodyOutcome.conflict) conflicts.push({ field: 'body', local: bodyOutcome.conflict.local, jira: bodyOutcome.conflict.jira, detectedAt: now });
  if (statusOutcome.action === 'conflict' && statusOutcome.conflict) conflicts.push({ field: 'status', local: statusOutcome.conflict.local, jira: statusOutcome.conflict.jira, detectedAt: now });

  // The baseline moves to this sync's resulting value for every field that was actually resolved (apply/push/keep);
  // a field left in conflict keeps its old baseline, so the same divergence is still detected next time (AD-28).
  // Status is baselined in Jira's own raw vocabulary: `apply` already has Jira's exact current text; `push` has none
  // (the push just sent local's status over, so a representative Jira name for it is close enough -- the next sync's
  // own fresh read decides everything from Jira's actual text anyway, this is only this round's bookkeeping).
  const statusBaseline = statusOutcome.action === 'conflict' ? baseline.status : statusOutcome.action === 'apply' ? jiraStatusName : statusOutcome.action === 'push' ? (candidateJiraStatusNames(current.status)[0] ?? baseline.status) : baseline.status;
  const newBaseline = {
    title: titleOutcome.action === 'conflict' ? baseline.title : titleOutcome.value,
    body: bodyOutcome.action === 'conflict' ? baseline.body : bodyOutcome.value,
    status: statusBaseline,
  };
  const newRecord: JiraSyncRecord = { issueKey: issue.key, remote: record?.remote ?? remoteLinkOf(options.siteUrl, issue.key), baseline: newBaseline, syncedAt: now, conflicts, pushedAfter };
  await writeFile(syncRecordPath(epicDir, leaf.file), JSON.stringify(newRecord, null, 2), 'utf8');

  return conflicts.map((c) => c.field);
}

/**
 * Pulls `issues` into `options.initiativeDir`'s real BMad ticket tree:
 * every Jira "Epic" issue gets (or already has) its own `epic-*` folder;
 * every other issue gets (or already has) a leaf + plan file under its
 * epic's folder (or the unassigned bucket). A brand-new ticket is created
 * with Jira's current title/body/status mapped straight across; an
 * already-known one (matched by `tracker_id`) goes through
 * {@link reconcileExistingLeaf}'s conflict-aware reconciliation instead.
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
      const conflicts = await reconcileExistingLeaf(epicDir, existing, issue, options);
      leaves.push({ epicSlug, file: existing.file, id: existing.id, issueKey: issue.key, created: false, conflicts });
    }
  }

  return { epics, leaves };
}
