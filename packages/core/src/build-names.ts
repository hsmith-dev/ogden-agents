/**
 * Names and rules the build use-cases share (story 5.10 split `builds.ts`): the
 * run's branch name, prerequisites, what a build's diff may not touch, the
 * checkpoint test and the intent-gap patch's path. No state.
 */
import { randomBytes } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { BUILD_RESULT_STATUSES, CHECKPOINT_BLOCKED_CODES, RunId, BUILD_BRANCH_PREFIX, TICKET_REF_PATTERN, type Run, type TicketRow, type TicketsResponse } from '@ogden-agents/shared';
import { ValidationError } from './errors.js';
import { isProtectedSegment } from './permission-matching.js';

/** Said when a re-check or Update and retry finds every run slot taken (the limits hold; nothing changed). */
export const NO_FREE_SLOT_MESSAGE = 'Other builds are using every free slot. Try again when one finishes.';

/** The BMad output folder whose uncommitted changes never block approve (user decision 2026-10-01). */
export const BMAD_OUTPUT_PREFIX = '_bmad-output/';

/** The project's agent instructions file at the repo root: Save the lessons (epic 7) commits it, and approve's clean-checkout check tolerates it uncommitted. */
export const AGENTS_FILE = 'AGENTS.md';

/** The plan status a ticket must have to be built. */
export const READY_STATUS = 'ready-for-dev';

/** The ticket states a prerequisite may be in: done, or in review (`in-review`, `built`). */
export const PREREQUISITE_MET_STATES: ReadonlySet<string> = new Set(['done', 'review']);

/** Empty protected folders made in a new worktree, so the sandbox's read-only binds exist (review loop 1). */
export const PRECREATED_FOLDERS = ['.claude', '.vscode', '.idea', '_bmad'];

/** The user's credential folders a build's commands may never read (review loop 1), under the home folder. */
export const CREDENTIAL_FOLDERS = [
  // Keys, cloud and registry credentials, and tool tokens.
  '.ssh', '.aws', '.gnupg', '.netrc', '.docker', '.kube', '.azure', '.npmrc', '.pypirc', '.git-credentials', '.password-store',
  // The whole config folder (gh, gcloud, browsers on Linux and more), not only gh's.
  '.config',
  // Other agents' homes and logins, and Claude Code's own settings and login (story 5.8 review: an unattended command reads none of them).
  '.claude', '.claude.json', '.codex', '.gemini', '.grok', '.antigravity', join('.local', 'share', 'keyrings'),
  // macOS: keychains, cookies and the browsers' profiles.
  join('Library', 'Keychains'), join('Library', 'Cookies'), join('Library', 'Safari'),
  join('Library', 'Application Support', 'Google', 'Chrome'), join('Library', 'Application Support', 'Firefox'), join('Library', 'Application Support', 'BraveSoftware'), join('Library', 'Application Support', 'Microsoft Edge'), join('Library', 'Application Support', 'Arc'),
  // Linux browsers' profiles outside `.config`.
  '.mozilla', join('snap', 'firefox'),
];

/**
 * The paths a build's commands may not read under `home`: each credential folder as listed and, when it is
 * a link or `home` itself is one, where it really leads (a fence on the link alone is bypassed by the real path).
 */
export function credentialReadFences(home: string, realpath: (path: string) => string | undefined): string[] {
  const fences: string[] = [];
  const add = (path: string) => {
    if (!fences.includes(path)) fences.push(path);
  };
  for (const folder of CREDENTIAL_FOLDERS) {
    const listed = join(home, folder);
    add(listed);
    const real = realpath(listed);
    if (real !== undefined) add(real);
    else {
      // Not there yet: the folder under the home's real path still fences it.
      const realHome = realpath(home);
      if (realHome !== undefined) add(join(realHome, folder));
    }
  }
  return fences;
}


/** `ref` as the store takes it, or {@link ValidationError}. */
export function checkedRef(ref: unknown): string {
  if (typeof ref !== 'string' || !TICKET_REF_PATTERN.test(ref)) {
    throw new ValidationError('That is not a ticket reference.', [{ path: ['ref'], message: 'That is not a ticket reference.' }]);
  }
  return ref;
}

/** A git-safe branch name for run `runId` (8 characters) of ticket `ref` titled `title`: `ogden/<run8>/<ref>-<slug>`, unique per run. */
export function buildBranchName(runId: string, ref: string, title: string): string {
  const safeRef = ref.replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '') || 'ticket';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const name = `${BUILD_BRANCH_PREFIX}${runId}/${safeRef}${slug === '' ? '' : `-${slug}`}`;
  return name.endsWith('.lock') ? `${name}-1` : name;
}

/** Whether `name` is a branch name Ogden made (checked before every use). */
export function isBuildBranch(name: string): boolean {
  return /^ogden\/[a-z2-7]{8}\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..') && !name.endsWith('.lock') && !name.endsWith('.');
}

/**
 * Whether every prerequisite `row` names is met: a ticket done or in review
 * (a sibling's id `2` in epic `1` is `1.2`), or an epic, named by its slug,
 * that is done (the board's rule; review loop 1).
 */
export function prerequisitesMet(row: Pick<TicketRow, 'ref' | 'after'>, tree: Pick<TicketsResponse, 'tickets' | 'epics'>): boolean {
  const dot = row.ref.lastIndexOf('.');
  const epic = dot === -1 ? undefined : row.ref.slice(0, dot);
  return row.after.every((link) => {
    const text = String(link);
    const named = tree.epics.find((each) => each.slug === text);
    if (named !== undefined) return named.status === 'done';
    const ref = text.includes('.') || epic === undefined ? text : `${epic}.${text}`;
    const found = tree.tickets.find((each) => each.ref === ref);
    return found !== undefined && PREREQUISITE_MET_STATES.has(found.state);
  });
}

/** An 8-character lowercase id for a run's worktree folder and branch. */
export const runShortId = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return [...randomBytes(8)].map((byte) => alphabet[byte % 32]).join('');
};

/** Whether the build's diff touches what it may not (review loop 1): a protected name, any `tickets.toml`, another ticket's plan. */
export function forbiddenChanges(files: readonly string[], ownPlan: string | null): string[] {
  return files.filter((file) => {
    const segments = file.split('/');
    if (segments.some((segment) => isProtectedSegment(segment))) return true;
    const base = segments.at(-1) ?? '';
    if (base.toLowerCase() === 'tickets.toml') return true;
    return file.startsWith(BMAD_OUTPUT_PREFIX) && base.endsWith('-plan.md') && file !== ownPlan;
  });
}

/** A run id as core takes it, or {@link ValidationError}. */
export function checkedRunId(runId: unknown): RunId {
  const parsed = RunId.safeParse(runId);
  if (!parsed.success) throw new ValidationError('That is not a run.', [{ path: ['runId'], message: 'That is not a run.' }]);
  return parsed.data;
}

/** Whether `run` is paused at a checkpoint (story 5.4). */
export function atCheckpoint(run: Pick<Run, 'outcome' | 'blockedCode' | 'decision'>): boolean {
  return run.outcome === 'blocked' && run.decision === null && run.blockedCode !== null && CHECKPOINT_BLOCKED_CODES.includes(run.blockedCode);
}

/**
 * The intent-gap patch beside `plan` in `worktree` (the skill saves it named
 * after the plan, `.patch` for `.md`), repo-relative, when it is a regular
 * file whose real path is under the worktree's own `_bmad-output/` (never
 * through a link out of it); else `null`.
 */
export function intentGapPatchOf(worktree: string, plan: string | null): string | null {
  if (plan === null || !plan.startsWith(BMAD_OUTPUT_PREFIX) || !plan.endsWith('.md')) return null;
  const patch = `${plan.slice(0, -'.md'.length)}.patch`;
  if (patch.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) return null;
  try {
    const file = join(worktree, ...patch.split('/'));
    if (!lstatSync(file).isFile()) return null;
    const output = realpathSync.native(join(worktree, BMAD_OUTPUT_PREFIX));
    const real = realpathSync.native(file);
    const rel = relative(output, real);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && realpathSync.native(worktree) === dirname(output) ? patch : null;
  } catch {
    return null;
  }
}

/** The plan statuses a per-run result may name. */
export const RESULT_STATUSES: ReadonlySet<string> = new Set(BUILD_RESULT_STATUSES);

/** At most this many characters of a reason go into a per-run result (its schema's bound). */
export const MAX_RESULT_TEXT = 2000;
