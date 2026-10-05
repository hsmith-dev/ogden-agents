/**
 * A ticket store for the build tests (story 5.2) that reads and writes the
 * plan files themselves, in whatever folder it is given: the main checkout
 * or a run's worktree. So a build's status lives in the files, as with
 * `tickets.py`, without uv, Python or BMad Method's scripts. Each ticket is
 * declared with its plan's repo-relative path; its status is the plan's
 * `status:` frontmatter line (none when the plan is missing).
 *
 * `mark` rewrites that line (refusing `done` unless `approve` is set, as the
 * real store does) and records each call. Plain Node only (no core import),
 * so the server tests and the Playwright specs can both use it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PlanFileTicket {
  ref: string;
  title: string;
  /** The plan's path relative to the repo, `/`-separated. */
  plan: string;
  /** The tickets it waits for (sibling ids or full refs). */
  after?: Array<string | number>;
  /** Its entry's checkpoint flags (story 5.4), as `tickets.toml` would hold them. */
  planCheckpoint?: boolean;
  doneCheckpoint?: boolean;
}

/** The state `tickets.py` derives from a plan status. */
const STATE_OF: Readonly<Record<string, string>> = {
  draft: 'backlog',
  'ready-for-dev': 'backlog',
  'in-progress': 'in-progress',
  blocked: 'in-progress',
  'in-review': 'review',
  built: 'review',
  done: 'done',
  dropped: 'dropped',
};

const ROW_DEFAULTS = { tracker_id: '', assignee: '', hitl: false, covers: [] as string[], blocks: [] as Array<string | number> };

export function createPlanFileTicketStore(tickets: readonly PlanFileTicket[]) {
  const marks: Array<{ repoPath: string; ref: string; status: string; approve: boolean }> = [];
  const read = (repoPath: string, ticket: PlanFileTicket) => {
    const file = join(repoPath, ...ticket.plan.split('/'));
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const status = /^status:\s*['"]?([a-z-]+)['"]?\s*$/m.exec(text)?.[1] ?? '';
    const blockedReason = /^blocked_reason:\s*"?(.*?)"?\s*$/m.exec(text)?.[1] ?? '';
    const [epicId = '1', id = ticket.ref] = ticket.ref.split('.');
    return {
      ...ROW_DEFAULTS,
      ref: ticket.ref,
      id: Number(id),
      epic: `epic-${epicId}`,
      title: ticket.title,
      type: 'story',
      status,
      state: status === '' ? 'planned' : (STATE_OF[status] ?? 'backlog'),
      blocked_reason: blockedReason,
      blocked_at: status === 'blocked' ? '2026-10-04' : '',
      file: ticket.plan.split('/').at(-1) ?? null,
      after: ticket.after ?? [],
      hasPlan: text !== '',
      plan: text === '' ? null : ticket.plan,
    };
  };
  const find = (ref: string) => {
    const ticket = tickets.find((each) => each.ref === ref);
    if (ticket === undefined) throw Object.assign(new Error(`ticket ${ref} does not exist`), { code: 'not_found' });
    return ticket;
  };
  return {
    marks,
    async tree(repoPath: string) {
      return { tickets: tickets.map((ticket) => read(repoPath, ticket)).map(({ hasPlan: _hasPlan, plan: _plan, ...row }) => row), problems: [], folder: 'initiative-demo', epics: [] };
    },
    async find(repoPath: string, ref: string) {
      const ticket = find(ref);
      return {
        ...read(repoPath, ticket),
        description: '',
        verify: '',
        references: [],
        notes: [],
        unknown: '',
        plan_checkpoint: ticket.planCheckpoint === true,
        done_checkpoint: ticket.doneCheckpoint === true,
      };
    },
    async mark(repoPath: string, ref: string, status: string, _guard: unknown, options: { approve?: boolean } = {}) {
      if (status === 'done' && options.approve !== true) throw new Error('only approve writes done');
      const ticket = find(ref);
      marks.push({ repoPath, ref, status, approve: options.approve === true });
      const file = join(repoPath, ...ticket.plan.split('/'));
      writeFileSync(file, readFileSync(file, 'utf8').replace(/^status:.*$/m, `status: ${status}`));
      return { ref, status };
    },
    async watch() {
      return { close() {} };
    },
  };
}
