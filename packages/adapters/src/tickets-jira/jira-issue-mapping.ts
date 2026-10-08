/**
 * AD-28's field mapping, the pure functions (epic 18 story 5): Jira's own
 * issue shape in, a BMad-shaped mapping out, with no local-file or REST
 * concerns here. Jira's vocabulary (Issue Type, Priority, Epic link) is
 * named only here and in `jira-client.ts`, never in `packages/core` or
 * `packages/shared` (AD-27, AD-12).
 */
import type { TicketStatus } from '@ogden-agents/shared';

/** One Jira issue, in the shape `GET /rest/api/3/search` returns (only the fields this adapter reads). */
export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    /** A plain string (this adapter's fake server) or Jira Cloud v3's Atlassian Document Format object — see {@link plainTextFromDescription}. */
    description?: string | Record<string, unknown> | null;
    status: { name: string };
    issuetype?: { name: string } | null;
    parent?: { key: string } | null;
    assignee?: { displayName: string } | null;
    priority?: { name: string } | null;
  };
}

/** Whether a Jira issue type name is BMad's `epic` container, as opposed to a leaf ticket. Case-insensitive; defaults to a leaf (false) for an unrecognized or missing type. */
export function isEpicIssueType(issueTypeName: string | null | undefined): boolean {
  return (issueTypeName ?? '').trim().toLowerCase() === 'epic';
}

/** The BMad leaf type (AD-28: `type`, Jira-to-local-only, set once at creation) a non-epic Jira issue type maps to. Bug-like names map to `bug`; everything else (Story, Task, Sub-task, an unrecognized or missing type) maps to `story`, the safe default — never silently dropped. */
export function mapIssueTypeToLeaf(issueTypeName: string | null | undefined): 'story' | 'bug' {
  const name = (issueTypeName ?? '').trim().toLowerCase();
  return name === 'bug' || name === 'defect' ? 'bug' : 'story';
}

/** One BMad status this adapter is willing to set, and whether the match was a recognized Jira workflow name (an unrecognized one still returns a safe default, `draft`, but `recognized: false` so the caller can record the raw name rather than pretending the mapping is confident). */
export interface MappedStatus {
  status: TicketStatus;
  recognized: boolean;
}

/** Jira status name (lower-cased, trimmed) to the BMad status it corresponds to, for every common default Jira Cloud and Jira Software workflow name this adapter recognizes. Not exhaustive by design (a custom workflow's own status names are exactly what `recognized: false` is for). */
const KNOWN_STATUS_MAP: Readonly<Record<string, TicketStatus>> = {
  backlog: 'draft',
  'to do': 'draft',
  todo: 'draft',
  open: 'draft',
  new: 'draft',
  'selected for development': 'draft',
  'in progress': 'in-progress',
  'in development': 'in-progress',
  'in review': 'in-review',
  'code review': 'in-review',
  'peer review': 'in-review',
  review: 'in-review',
  blocked: 'blocked',
  impeded: 'blocked',
  done: 'done',
  closed: 'done',
  resolved: 'done',
  complete: 'done',
  completed: 'done',
};

/**
 * Maps a Jira status name to the BMad status this adapter would set on a
 * *newly created* local ticket (AD-28, `status`/Status two-way). This is
 * the first-sync mapping only: once a ticket exists locally, applying a
 * pulled status against its current one (and the conflict rule) is
 * entry 6's job, not this function's — this one never looks at what a
 * ticket's status already is, because at first sync there isn't one yet.
 */
export function mapJiraStatusToBmad(statusName: string | null | undefined): MappedStatus {
  const key = (statusName ?? '').trim().toLowerCase();
  const mapped = KNOWN_STATUS_MAP[key];
  return mapped === undefined ? { status: 'draft', recognized: false } : { status: mapped, recognized: true };
}

/**
 * The reverse of {@link mapJiraStatusToBmad}: every recognized Jira status
 * name that maps to `status`, in a fixed, deterministic order (one real
 * Jira name per BMad status is the common case; this returns every one
 * this adapter knows, in case a board's workflow uses an alternate name
 * for the same BMad status, so pushing a local status change can find a
 * matching transition on whichever name this board's workflow actually
 * uses). `built`/`done` both look for "Done"-shaped names — a workflow's
 * own transitions decide what it actually accepts; this is a candidate
 * list to try, not a guarantee one exists.
 */
export function candidateJiraStatusNames(status: TicketStatus): string[] {
  const titleCase = (text: string): string => text.replace(/\b\w/g, (c) => c.toUpperCase());
  const names = Object.entries(KNOWN_STATUS_MAP)
    .filter(([, value]) => value === status || (status === 'built' && value === 'done'))
    .map(([name]) => titleCase(name));
  return [...new Set(names)];
}

export interface JiraTransitionLike {
  id: string;
  to: { name: string };
}

/**
 * The transition to apply, from `transitions` (an issue's currently
 * available ones), that would move it to `status` — matched by name
 * against {@link candidateJiraStatusNames}, case-insensitively.
 * `undefined` when none of this board's available transitions lead
 * there (a workflow that simply doesn't have that status, or the issue
 * is already in it): never guessed, never forced.
 */
export function chooseTransition(transitions: readonly JiraTransitionLike[], status: TicketStatus): JiraTransitionLike | undefined {
  const candidates = candidateJiraStatusNames(status).map((name) => name.toLowerCase());
  return transitions.find((t) => candidates.includes(t.to.name.trim().toLowerCase()));
}

/** The BMad `severity` (bugs only, AD-28: Ogden sets it once at creation, then Jira owns it) a Jira priority name maps to; `undefined` for an unrecognized or missing priority (left unset rather than guessed). */
export function mapPriorityToSeverity(priorityName: string | null | undefined): 'P0' | 'P1' | 'P2' | 'P3' | undefined {
  const key = (priorityName ?? '').trim().toLowerCase();
  if (key === 'highest' || key === 'blocker' || key === 'critical') return 'P0';
  if (key === 'high' || key === 'major') return 'P1';
  if (key === 'medium') return 'P2';
  if (key === 'low' || key === 'lowest' || key === 'minor' || key === 'trivial') return 'P3';
  return undefined;
}

/**
 * Jira Cloud's REST API v3 returns `description` as Atlassian Document
 * Format (ADF) — a nested JSON document, not plain text — unless the
 * caller asks for `renderedFields` or uses the older v2 API. This adapter
 * uses v3 (AD-29, AD-27 cite nothing to the contrary) and reads whichever
 * shape it's given: a plain string (this adapter's own fake server, and
 * what a future `renderedFields` request could supply) passes through
 * unchanged; an ADF document has its text content walked out, one blank
 * line between block-level nodes (`paragraph`, `heading`, list items),
 * so the body a synced ticket gets is readable, not a wall of JSON.
 */
export function plainTextFromDescription(description: string | null | undefined | Record<string, unknown>): string {
  if (description === null || description === undefined) return '';
  if (typeof description === 'string') return description;
  const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote']);
  const lines: string[] = [];
  let current = '';
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof n.text === 'string') current += n.text;
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
    if (typeof n.type === 'string' && BLOCK_NODES.has(n.type)) {
      lines.push(current);
      current = '';
    }
  };
  walk(description);
  if (current !== '') lines.push(current);
  return lines.filter((line) => line !== '').join('\n\n');
}

/** A filesystem- and tickets.toml-safe slug from a Jira issue's summary (title), matching `tickets.py`'s own `title_slug`: lower-cased, non-alphanumeric runs collapsed to one hyphen, trimmed, capped at 60 characters, never empty. */
export function titleSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? 'untitled' : slug;
}
